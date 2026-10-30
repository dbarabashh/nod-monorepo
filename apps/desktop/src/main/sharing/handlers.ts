import {
  identityHex,
  isIdentityHex,
  parseIdentityCard,
} from '@nod/core/crypto';
import {
  isGrantedRole,
  isNoteId,
  isRecordId,
  isTeamName,
  isTeamVaultId,
  maxMemberNameLength,
  parseTeamLink,
  roleRank,
  teamLink,
} from '@nod/core/sharing';
import { relayBase } from '@nod/core/sync';
import type {
  JoinOutcome,
  SharedNoteDetail,
  SharedNoteInfo,
  SharingState,
  TeamInfo,
  TeamRole,
} from '../../shared/ipc.ts';
import type { Meeting, SharedCopy } from '@nod/core/meetings';
import { documentVersionOf } from '../meetings/document-version.ts';
import type { JoinPreview } from '@nod/core/sharing';
import type { DialogGate, Question } from '../sync/dialog-gate.ts';
import type { SharedPlace, SharingController } from './controller.ts';
import { shownName as shown } from './shown-name.ts';

const maxCardLength = 400;
const maxSummaryLength = 200_000;
const maxLinkLength = 1_024;
const maxRelayLength = 2_048;
// One share at a time, so a script that got one click can't send every
// meeting to everyone before the user sees anything happen.
const shareIntervalMs = 1_000;

function checked<T>(
  guard: (value: unknown) => value is T,
  message: string,
): (value: unknown) => T {
  return (value) => {
    if (!guard(value)) {
      throw new Error(message);
    }
    return value;
  };
}

function text(guard: (value: string) => boolean) {
  return (value: unknown): value is string =>
    typeof value === 'string' && guard(value);
}

function trimmed(guard: (value: string) => boolean, message: string) {
  const check = checked(text(guard), message);
  return (value: unknown): string => check(value).trim();
}

const cardOf = trimmed(
  (card) => card.length <= maxCardLength,
  'That is not an identity card',
);
const peerIdentityOf = checked(text(isIdentityHex), 'Unknown person');
const targetOf = checked(
  text((value) => isIdentityHex(value) || isTeamVaultId(value)),
  'Unknown share target',
);
const noteIdOf = checked(text(isNoteId), 'Unknown note');
const vaultIdOf = checked(isTeamVaultId, 'Unknown team');
const recordIdOf = (value: unknown, what: string) =>
  checked(isRecordId, `Unknown ${what}`)(value);
const grantedRoleOf = checked(isGrantedRole, 'Unknown role');
const keptRoleOf = checked(
  (value): value is 'admin' | 'writer' =>
    value === 'admin' || value === 'writer',
  'The old owner stays as an admin or a writer',
);
const teamNameOf = trimmed(isTeamName, 'Give the team a short name');
const displayNameOf = trimmed(
  (name) => name.length <= maxMemberNameLength,
  'That name is too long',
);
const linkOf = trimmed(
  (link) => link.length <= maxLinkLength,
  'That is not a team link',
);
const booleanOf = checked(
  (value): value is boolean => typeof value === 'boolean',
  'Unknown choice',
);

function relayOf(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxRelayLength) {
    throw new Error('That relay address is not valid');
  }
  if (!URL.canParse(value.trim())) {
    throw new Error('That relay address is not valid');
  }
  return relayBase(value.trim()).href;
}

function roleLabel(role: TeamRole): string {
  return role === 'owner' || role === 'admin' ? `an ${role}` : `a ${role}`;
}

function teamLabel(team: { name: string }): string {
  const name = shown(team.name);
  return name === '' ? 'this team' : `“${name}”`;
}

// A name is chosen by its holder, so it is quoted in a dialog's detail and
// never put in its title, where it could pass for a code.
function namedLine(member: { name: string | null }): string {
  const name = shown(member.name ?? '');
  return name === ''
    ? 'They have no name in the team.'
    : `They are named “${name}”.`;
}

function joinQuestion(preview: JoinPreview): Question {
  return {
    message: `Join ${teamLabel({ name: preview.team })}?`,
    code: { label: 'Invited by', value: preview.inviterCode },
    detail: [
      `You would join as ${roleLabel(preview.role)}. ${
        preview.approval
          ? 'An owner or admin of the team has to accept your request first; the name you entered travels to them encrypted.'
          : 'The link lets you in right away. It works like a key: anyone who has it can join the team and read its notes until someone in the team revokes it.'
      }`,
      'Compare the inviter’s code with the person who sent you the link, over a call or in person. The invite is signed by the identity with this code, and once you are in, Nod checks that the team’s list names that identity as the one who invited you.',
      `The team lives on ${preview.host}; its notes travel encrypted, and every member can read them. The invite file there is kept for 7 days, but the invite stays live until someone in the team revokes it.`,
    ].join('\n\n'),
    confirmLabel: preview.approval ? 'Ask to join' : 'Join',
    cancelLabel: 'Cancel',
  };
}

// What the handlers ask of the session, so a test can stand in for it:
// everything but the hooks the sync loop drives.
export type SharingHandlersController = Omit<
  SharingController,
  | 'load'
  | 'sharesEngine'
  | 'round'
  | 'leaveDevice'
  | 'unreachableTeams'
  | 'endIdentity'
>;

// Everything that shows an identity, adds a person, widens someone's rights,
// reaches a new host or stops a share runs through a dialog main draws, so a
// page script that got hold of a click can't swap the card it shows or add
// someone unseen.
export function createSharingHandlers(options: {
  controller: SharingHandlersController;
  place: () => SharedPlace | null;
  // The relay this device syncs through, where a new team lives; null when
  // it syncs through a folder or not at all.
  syncRelay: () => string | null;
  meeting: (id: string) => Meeting | undefined;
  meetingName: (meeting: Meeting) => string;
  // Writes on the meeting where its notes went, so the app can show it and
  // open the copy.
  recordShare: (meetingId: string, copy: SharedCopy) => Promise<void>;
  // The same gate the sync dialogs use, so one question is open at a time
  // across both, and a Cancel here slows a script down there too.
  gate: DialogGate;
  copyText: (text: string) => void;
  syncSoon: () => void;
  now: () => number;
}) {
  const { controller, place, gate, copyText, syncSoon, now } = options;
  let sharedAt = Number.NEGATIVE_INFINITY;

  function teamOf(vaultId: string): TeamInfo {
    const state = controller.snapshot();
    const team =
      state.status === 'ready'
        ? state.teams.find((candidate) => candidate.vaultId === vaultId)
        : undefined;
    if (!team) {
      throw new Error('Unknown team');
    }
    return team;
  }

  function myIdentity(): string | null {
    const me = parseIdentityCard(controller.identityCard());
    return me ? identityHex(me.publicKey) : null;
  }

  function memberOf(team: TeamInfo, identity: string) {
    const member = team.members.find(
      (candidate) => candidate.identity === identity,
    );
    if (!member) {
      throw new Error('Nobody with that identity is in the team');
    }
    return member;
  }

  // Shows something to copy from main's own dialog, holding the gate from
  // before `make` runs until the dialog closes, so nothing made on the way
  // is left behind by a gate check that fails afterwards. Nothing shown
  // comes back on the very next click.
  async function showToCopy(
    what: string,
    make: () => Promise<{ question: Question; text: string }>,
  ) {
    gate.assertNotJustShown(what);
    await gate.holding(
      async () => {
        const made = await make();
        gate.markShown();
        const copy = await gate.confirm(made.question);
        gate.markShown();
        if (copy) {
          copyText(made.text);
        }
      },
      () => 'neutral',
    );
  }

  async function confirmed(
    question: Question,
    act: () => Promise<unknown>,
  ): Promise<boolean> {
    if (!(await gate.ask(question))) {
      return false;
    }
    await act();
    syncSoon();
    return true;
  }

  return {
    getSharingState: (): SharingState => controller.snapshot(),
    // The card is public; the dialog exists so what the user copies is the
    // card main holds, with the code they can read out to the other person.
    showIdentityCard: () =>
      showToCopy('card', async () => ({
        question: {
          message: 'Your identity card',
          detail:
            'Send the card to the person you want to share notes with, in any app. They add it under Settings → People, and you add theirs; a team’s owner or admin can add you by it too. The card holds nothing secret; the code lets you both check you have the right one.',
          code: {
            label: 'Your identity code',
            value: controller.identityCode(),
          },
          confirmLabel: 'Copy card',
          cancelLabel: 'Close',
        },
        text: controller.identityCard(),
      })),
    addSharingPeer: async (value: unknown) => {
      const card = cardOf(value);
      const preview = controller.previewPeer(card);
      return confirmed(
        {
          message: 'Share notes with this person?',
          code: { label: 'Their identity code', value: preview.code },
          detail:
            'Check the code with the person over a call or in person. Notes you share with them travel encrypted through your folder or relay; only the two of you can read them, and neither of you can take a shared note back. If you shared with them before and stopped, those notes are shared again.',
          confirmLabel: 'Share with them',
          cancelLabel: 'Cancel',
        },
        () => controller.addPeer(card),
      );
    },
    stopSharingPeer: async (value: unknown) => {
      const identity = peerIdentityOf(value);
      const state = controller.snapshot();
      const peer =
        state.status === 'ready'
          ? state.peers.find((candidate) => candidate.identity === identity)
          : undefined;
      if (!peer) {
        throw new Error('Unknown person');
      }
      const at = place();
      await confirmed(
        {
          message: `Stop sharing with ${peer.code}?`,
          detail: [
            at
              ? 'The copies this device put in the shared vault are removed, and nothing new travels either way.'
              : 'No folder or relay is connected right now, so the copies this device put in the shared vault stay there; nothing new travels either way.',
            'The other person keeps what they already received, as they would a sent email. The notes stay on this device, and are shared again if you add this person back.',
          ].join('\n\n'),
          confirmLabel: 'Stop sharing',
          cancelLabel: 'Cancel',
        },
        () => controller.stopPeer(identity, at),
      );
    },
    shareMeeting: async (
      meetingId: unknown,
      target: unknown,
    ): Promise<SharedNoteInfo> => {
      const home = targetOf(target);
      const meeting =
        typeof meetingId === 'string' ? options.meeting(meetingId) : undefined;
      if (!meeting) {
        throw new Error('Unknown meeting');
      }
      if (now() - sharedAt < shareIntervalMs) {
        throw new Error('Wait a moment before sharing again');
      }
      sharedAt = now();
      const shared = await controller.shareMeeting(
        meeting,
        options.meetingName(meeting),
        home,
      );
      await options.recordShare(meeting.id, {
        noteId: shared.id,
        target: shared.target,
        kind: shared.kind,
        sharedAt: shared.sharedAt,
      });
      syncSoon();
      return shared;
    },
    getSharedNote: async (
      target: unknown,
      id: unknown,
    ): Promise<SharedNoteDetail> =>
      controller.note(targetOf(target), noteIdOf(id)),
    editSharedNote: async (
      target: unknown,
      id: unknown,
      summary: unknown,
      version: unknown,
    ) => {
      if (typeof summary !== 'string' || summary.length > maxSummaryLength) {
        throw new Error('That note is too long');
      }
      const saved = await controller.editNote(
        targetOf(target),
        noteIdOf(id),
        summary,
        documentVersionOf(version, 'note'),
      );
      syncSoon();
      return saved;
    },
    deleteSharedNote: async (target: unknown, id: unknown) => {
      await controller.deleteNote(targetOf(target), noteIdOf(id));
      syncSoon();
    },

    // Teams live on a relay only. One this device doesn't sync through is
    // a new host it would sign requests to on every sync, so the user
    // agrees to it in main's own dialog first.
    createTeam: async (
      name: unknown,
      myName: unknown,
      relay: unknown,
    ): Promise<string | null> => {
      const team = teamNameOf(name);
      const me = displayNameOf(myName);
      const syncing = options.syncRelay();
      let host = syncing;
      if (!host) {
        if (relay === null || relay === '') {
          throw new Error(
            'Teams need a relay in this version. Enter the address of a relay to keep the team on.',
          );
        }
        host = relayOf(relay);
        const shownHost = new URL(host).host;
        const yes = await gate.ask({
          message: `Keep the team on ${shownHost}?`,
          detail: [
            host,
            'Teams need a relay in this version. The team’s list and notes are kept there encrypted, and this device reaches it on every sync, signed with your identity. Use only a relay you run or trust.',
          ].join('\n\n'),
          confirmLabel: 'Create team',
          cancelLabel: 'Cancel',
        });
        if (!yes) {
          return null;
        }
      }
      const vaultId = await controller.createTeam(team, me, host);
      syncSoon();
      return vaultId;
    },
    // The person sees the team and who invited them, in a dialog main
    // draws, before anything about them reaches the relay. The preview
    // already reaches the link's host, so it runs inside the gate too.
    joinTeam: async (
      link: unknown,
      myName: unknown,
    ): Promise<JoinOutcome | null> => {
      const text = linkOf(link);
      const me = displayNameOf(myName);
      // A preview that fails still reached a host, so it counts as a Cancel:
      // a script can't probe one host after another without the wait growing.
      const answer = await gate.holding(
        async () => {
          try {
            const preview = await controller.previewJoin(text);
            return { yes: await gate.confirm(joinQuestion(preview)) };
          } catch (failure) {
            return { yes: false, failure };
          }
        },
        (outcome) => (outcome.yes ? 'confirmed' : 'declined'),
      );
      if ('failure' in answer) {
        throw answer.failure;
      }
      if (!answer.yes) {
        return null;
      }
      const joined = await controller.join(text, me);
      syncSoon();
      return joined;
    },
    // The invite record is made while the gate is held and shown from the
    // same dialog; a link the user closes without copying stays a live
    // invite they can revoke, and the dialog says so.
    showTeamInvite: async (
      vaultId: unknown,
      role: unknown,
      approval: unknown,
    ) => {
      const id = vaultIdOf(vaultId);
      const granted = grantedRoleOf(role);
      const approve = booleanOf(approval);
      const team = teamOf(id);
      await showToCopy('invite link', async () => {
        const link = await controller.inviteToTeam(id, granted, approve);
        syncSoon();
        return {
          question: {
            message: `Invite link for ${teamLabel(team)}`,
            detail: [
              approve
                ? `Whoever opens the link sees the team’s name and your identity code and can ask to join as ${roleLabel(granted)}. You or another owner or admin accept each request after checking their code.`
                : `Anyone who ever sees this link can join the team as ${roleLabel(granted)} until the invite is revoked, with nobody checking who they are. Send it only over a channel you trust, and revoke it when everyone is in.`,
              'The invite stays live until you revoke it under Settings → Teams, whether or not you copy the link now.',
            ].join('\n\n'),
            confirmLabel: 'Copy link',
            cancelLabel: 'Close',
          },
          text: link,
        };
      });
    },
    revokeTeamInvite: async (
      vaultId: unknown,
      inviteId: unknown,
    ): Promise<boolean> => {
      const id = vaultIdOf(vaultId);
      const invite = recordIdOf(inviteId, 'invite');
      const team = teamOf(id);
      const live = team.invites.find((entry) => entry.id === invite);
      if (!live) {
        throw new Error('Unknown invite');
      }
      return confirmed(
        {
          message: `Revoke this invite to ${teamLabel(team)}?`,
          detail: live.approval
            ? 'Nobody can ask to join through the link any more. Requests already waiting stay for you to answer.'
            : 'The team’s key changes too, so anyone who still has the link gets nothing from it, and every other link that joins at once stops working as well.',
          confirmLabel: 'Revoke',
          cancelLabel: 'Cancel',
        },
        () => controller.revokeInvite(id, invite),
      );
    },
    // Anyone who got hold of the link can ask, so the approver compares the
    // code with the person before letting them in.
    answerTeamRequest: async (
      vaultId: unknown,
      requestId: unknown,
      accept: unknown,
      role: unknown,
    ): Promise<boolean> => {
      const id = vaultIdOf(vaultId);
      const request = recordIdOf(requestId, 'request');
      const yesNo = booleanOf(accept);
      const team = teamOf(id);
      const asked = team.requests.find((entry) => entry.id === request);
      if (!asked) {
        throw new Error('Unknown request');
      }
      const name = shown(asked.name ?? '');
      if (!yesNo) {
        return confirmed(
          {
            message: `Decline this request to join ${teamLabel(team)}?`,
            code: { label: 'Their identity code', value: asked.code },
            detail: [
              name === ''
                ? 'They gave no name this device can read.'
                : `They call themselves “${name}”.`,
              'They are told the request was declined and receive nothing from the team.',
            ].join('\n\n'),
            confirmLabel: 'Decline',
            cancelLabel: 'Cancel',
          },
          () => controller.answerRequest(id, request, { accept: false }),
        );
      }
      const granted = grantedRoleOf(role);
      if (roleRank[granted] > roleRank[asked.role]) {
        throw new Error(`That invite grants at most ${roleLabel(asked.role)}`);
      }
      return confirmed(
        {
          message: `Let this person into ${teamLabel(team)}?`,
          code: { label: 'Their identity code', value: asked.code },
          detail: [
            name === ''
              ? 'They gave no name this device can read; ask them for one.'
              : `They call themselves “${name}”.`,
            `Compare the code with the person over a call or in person before accepting: anyone who got hold of the invite link can ask to join. They would join as ${roleLabel(granted)} and read every note in the team, including older ones.`,
          ].join('\n\n'),
          confirmLabel: 'Accept',
          cancelLabel: 'Cancel',
        },
        () =>
          controller.answerRequest(id, request, {
            accept: true,
            role: granted,
          }),
      );
    },
    addTeamMember: async (
      vaultId: unknown,
      card: unknown,
      role: unknown,
      name: unknown,
    ): Promise<boolean> => {
      const id = vaultIdOf(vaultId);
      const text = cardOf(card);
      const granted = grantedRoleOf(role);
      const label = displayNameOf(name);
      const named = shown(label);
      const team = teamOf(id);
      const preview = controller.previewPeer(text);
      return confirmed(
        {
          message: `Add this person to ${teamLabel(team)}?`,
          code: { label: 'Their identity code', value: preview.code },
          detail: [
            `Check the code with the person over a call or in person. They join as ${roleLabel(granted)}${named === '' ? '' : ` named “${named}”`} and can read every note in the team, including older ones.`,
            'Send them the team link afterwards (Copy team link), so their device knows where to find the team.',
          ].join('\n\n'),
          confirmLabel: 'Add to team',
          cancelLabel: 'Cancel',
        },
        () =>
          controller.addTeamMembers(id, [
            { card: text, role: granted, name: label },
          ]),
      );
    },
    // Taking rights away goes straight through; giving more asks first, since
    // an admin can do everything the other dialogs protect.
    setTeamMemberRole: async (
      vaultId: unknown,
      identity: unknown,
      role: unknown,
    ): Promise<boolean> => {
      const id = vaultIdOf(vaultId);
      const granted = grantedRoleOf(role);
      const team = teamOf(id);
      const member = memberOf(team, peerIdentityOf(identity));
      if (roleRank[granted] === roleRank[member.role]) {
        return true;
      }
      // A promotion hands out rights; a demotion that takes writing away
      // changes the team's key. Both are confirmed where a page script can't
      // reach.
      const rising = roleRank[granted] > roleRank[member.role];
      return confirmed(
        {
          message: `Make this member ${roleLabel(granted)} of ${teamLabel(team)}?`,
          code: { label: 'Their identity code', value: member.code },
          detail: [
            namedLine(member),
            rising
              ? granted === 'admin'
                ? 'An admin invites people, accepts requests, adds and removes members below them and changes the team’s key, with no further check from you.'
                : 'A writer shares notes into the team and edits or deletes any note in it.'
              : granted === 'reader'
                ? 'They keep reading the team’s notes but can no longer change them. The team gets a new key, and every instant-join link stops working.'
                : 'They can no longer manage members or invites, but still share and edit notes.',
          ].join('\n\n'),
          confirmLabel: 'Change role',
          cancelLabel: 'Cancel',
        },
        () => controller.setMemberRole(id, member.identity, granted),
      );
    },
    removeTeamMember: async (
      vaultId: unknown,
      identity: unknown,
    ): Promise<boolean> => {
      const id = vaultIdOf(vaultId);
      const team = teamOf(id);
      const member = memberOf(team, peerIdentityOf(identity));
      if (member.identity === myIdentity()) {
        throw new Error('Leave the team instead of removing yourself');
      }
      const name = shown(member.name ?? '');
      const teamName = shown(team.name);
      return confirmed(
        {
          message: 'Remove this member from the team?',
          code: { label: 'Their identity code', value: member.code },
          detail: [
            `${name === '' ? 'They have no name in the team' : `They are named “${name}”`}${teamName === '' ? '' : ` in “${teamName}”`}. Check the code is theirs before removing them.`,
            'The team’s key changes, so nothing new reaches them. What they already received stays with them, as a sent email would; nothing can take that back. The relay stops serving them the team from now on.',
          ].join('\n\n'),
          confirmLabel: 'Remove',
          cancelLabel: 'Cancel',
        },
        () => controller.removeMembers(id, [member.identity]),
      );
    },
    leaveTeam: async (vaultId: unknown): Promise<boolean> => {
      const id = vaultIdOf(vaultId);
      const team = teamOf(id);
      if (team.role === 'owner' && team.members.length > 1) {
        throw new Error('Hand the team to another member before leaving it');
      }
      return confirmed(
        {
          message: `Leave ${teamLabel(team)}?`,
          detail: [
            team.pending
              ? 'Your request to join is dropped on this device. The team still sees it until an owner or admin answers.'
              : 'The copies this device put in the team come off its relay, and the team’s notes stop syncing here. An owner or admin then takes you off the list.',
            'The shared notes already on this device stay here.',
          ].join('\n\n'),
          confirmLabel: 'Leave team',
          cancelLabel: 'Cancel',
        },
        () => controller.leaveTeam(id),
      );
    },
    transferTeam: async (
      vaultId: unknown,
      identity: unknown,
      role: unknown,
    ): Promise<boolean> => {
      const id = vaultIdOf(vaultId);
      const kept = keptRoleOf(role);
      const team = teamOf(id);
      if (team.role !== 'owner') {
        throw new Error('Only the owner hands the team over');
      }
      const member = memberOf(team, peerIdentityOf(identity));
      if (member.identity === myIdentity()) {
        throw new Error('You already own the team');
      }
      if (member.leaving) {
        throw new Error('That member asked to leave the team');
      }
      return confirmed(
        {
          message: `Make this member the owner of ${teamLabel(team)}?`,
          detail: [
            namedLine(member),
            `You stay in the team as ${roleLabel(kept)}. Only the owner hands the team over, and only the owner makes, demotes or removes admins.`,
            'Check the code with the person first; the team can’t be taken back.',
          ].join('\n\n'),
          code: { label: 'Their identity code', value: member.code },
          confirmLabel: 'Transfer ownership',
          cancelLabel: 'Cancel',
        },
        () => controller.transferTeam(id, member.identity, kept),
      );
    },
    rotateTeamKey: async (vaultId: unknown): Promise<boolean> => {
      const id = vaultIdOf(vaultId);
      const team = teamOf(id);
      return confirmed(
        {
          message: `Change the key of ${teamLabel(team)}?`,
          detail: [
            'Every member gets the new key on their next sync, and new notes are sealed under it. Invite links that join at once stop working and have to be made again.',
            'Do this when a link may have leaked, or when a key change by someone else left a member out.',
          ].join('\n\n'),
          confirmLabel: 'Change key',
          cancelLabel: 'Cancel',
        },
        () => controller.rotateTeamKey(id),
      );
    },
    // For a person added by card: where the team is, so their device can
    // start reading its list.
    showTeamLink: async (vaultId: unknown) => {
      const id = vaultIdOf(vaultId);
      const team = teamOf(id);
      await showToCopy('team link', async () => {
        const link = teamLink({ vaultId: id, host: team.host });
        return {
          question: {
            message: `Team link for ${teamLabel(team)}`,
            detail: [
              'Send it to a person you added by identity card, so their device knows where the team is. It holds nothing secret: someone the team’s list doesn’t name gets nothing from it.',
              link,
            ].join('\n\n'),
            confirmLabel: 'Copy link',
            cancelLabel: 'Close',
          },
          text: link,
        };
      });
    },
    // A team link names a host this device would then sign requests to on
    // every sync, so the user agrees to that host first.
    addKnownTeam: async (link: unknown): Promise<string | null> => {
      const text = linkOf(link);
      const parsed = parseTeamLink(text);
      if (!parsed) {
        throw new Error('That is not a team link');
      }
      const yes = await gate.ask({
        message: 'Add this team?',
        detail: [
          `This device will reach ${parsed.host} on every sync, signed with your identity, to read the team’s list and notes.`,
          'Add it only if someone you know added your identity card to the team there. Until they have, the team shows an error here.',
        ].join('\n\n'),
        confirmLabel: 'Add team',
        cancelLabel: 'Cancel',
      });
      if (!yes) {
        return null;
      }
      const vaultId = await controller.addKnownTeam(text);
      syncSoon();
      return vaultId;
    },
    renameTeam: async (vaultId: unknown, name: unknown) => {
      await controller.renameTeam(vaultIdOf(vaultId), teamNameOf(name));
      syncSoon();
    },
    nameTeamMember: async (
      vaultId: unknown,
      identity: unknown,
      name: unknown,
    ) => {
      await controller.nameTeamMember(
        vaultIdOf(vaultId),
        peerIdentityOf(identity),
        displayNameOf(name),
      );
      syncSoon();
    },
  };
}
