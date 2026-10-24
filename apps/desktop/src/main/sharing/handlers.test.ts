import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  identityCard,
  identityCodeOf,
  identityHex,
  identityOf,
} from '@nod/core/crypto';
import { startMeeting, type MeetingFiles } from '@nod/core/meetings';
import { memoryFiles, plainCipher } from '@nod/core/meetings/testing';
import { createSharingSession } from '@nod/core/sharing';
import type { TeamInfo } from '../../shared/ipc.ts';
import { createDialogGate, type Question } from '../sync/dialog-gate.ts';
import type { SharedPlace } from './controller.ts';
import {
  createSharingHandlers,
  type SharingHandlersController,
} from './handlers.ts';

const bob = identityOf(new Uint8Array(32).fill(2));
const bobCard = identityCard(bob);
const longCard = `nod-id:v1:${'A'.repeat(400)}`;
const meeting = startMeeting('m-1', 'Planning', 1_000);

async function setUp(answers: boolean[]) {
  const asked: Question[] = [];
  const copied: string[] = [];
  const recorded: Array<[string, string, string, string]> = [];
  let clock = 0;
  const notes = new Map<string, MeetingFiles>();
  const shares = new Map<string, Uint8Array>();
  const controller = createSharingSession({
    sharesFileFor: (vaultId) => ({
      read: async () => shares.get(vaultId) ?? null,
      write: async (data) => {
        shares.set(vaultId, data);
      },
      setAside: async () => {
        shares.delete(vaultId);
      },
    }),
    noteFilesFor: (vaultId) => {
      const files = notes.get(vaultId) ?? memoryFiles();
      notes.set(vaultId, files);
      return files;
    },
    cipher: async () => plainCipher,
    newId: () => 'note-1',
    now: () => 5,
    onChange: () => {},
  });
  await controller.load({ key: new Uint8Array(32).fill(1), deviceId: 'd1' });
  const handlers = createSharingHandlers({
    controller,
    place: () => null,
    meeting: (id) => (id === meeting.id ? meeting : undefined),
    meetingName: (entry) => entry.title,
    recordShare: async (id, copy) => {
      recorded.push([id, copy.noteId, copy.target, copy.kind]);
    },
    gate: createDialogGate({
      confirm: async (question) => {
        asked.push(question);
        return answers.shift() ?? false;
      },
      now: () => clock,
    }),
    copyText: (text) => {
      copied.push(text);
    },
    syncSoon: () => {},
    syncRelay: () => null,
    now: () => clock,
  });
  return {
    handlers,
    controller,
    asked,
    copied,
    recorded,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('sharing handlers', () => {
  it('adds a person only after the user confirms their code, and refuses a card that is too long', async () => {
    const { handlers, controller, asked } = await setUp([false, true]);
    await assert.rejects(handlers.addSharingPeer(longCard), /identity card/);
    await assert.rejects(handlers.addSharingPeer(42), /identity card/);
    assert.equal(asked.length, 0);

    assert.equal(await handlers.addSharingPeer(bobCard), false);
    assert.equal(asked[0]?.confirmLabel, 'Share with them');
    assert.deepEqual(handlers.getSharingState(), {
      ...controller.snapshot(),
      peers: [],
    });

    await assert.rejects(
      handlers.addSharingPeer(bobCard),
      /Wait a moment before trying again/,
    );
    const { handlers: again, recorded } = await setUp([true]);
    assert.equal(await again.addSharingPeer(bobCard), true);
    const state = again.getSharingState();
    assert.equal(state.status === 'ready' && state.peers.length, 1);
    const shared = await again.shareMeeting('m-1', identityHex(bob.publicKey));
    assert.deepEqual(recorded, [
      ['m-1', shared.id, identityHex(bob.publicKey), 'person'],
    ]);
  });

  it('shares one meeting a second at most, so one click can’t send them all', async () => {
    const { handlers, recorded, advance } = await setUp([true]);
    await handlers.addSharingPeer(bobCard);
    const bobHex = identityHex(bob.publicKey);
    await handlers.shareMeeting('m-1', bobHex);
    advance(999);
    await assert.rejects(
      handlers.shareMeeting('m-1', bobHex),
      /Wait a moment before sharing again/,
    );
    assert.equal(recorded.length, 1);
    advance(1);
    await handlers.shareMeeting('m-1', bobHex);
    assert.equal(recorded.length, 2);
  });

  it('refuses identities, note ids and summaries of the wrong shape before reaching the session', async () => {
    const { handlers } = await setUp([true]);
    await handlers.addSharingPeer(bobCard);
    await assert.rejects(handlers.stopSharingPeer('not-hex'), /Unknown person/);
    await assert.rejects(
      handlers.shareMeeting('m-1', 'ABCD'),
      /Unknown share target/,
    );
    await assert.rejects(
      handlers.shareMeeting('missing', 'a'.repeat(64)),
      /Unknown meeting/,
    );
    await assert.rejects(
      handlers.getSharedNote('a'.repeat(64), 'bad id!'),
      /Unknown note/,
    );
    await assert.rejects(
      handlers.editSharedNote('a'.repeat(64), 'note-1', 'x'.repeat(200_001)),
      /too long/,
    );
  });

  it('copies the card only from its own dialog, and not again right away', async () => {
    const { handlers, controller, asked, copied, advance } = await setUp([
      false,
      true,
    ]);
    await handlers.showIdentityCard();
    assert.equal(asked[0]?.confirmLabel, 'Copy card');
    assert.deepEqual(copied, []);
    await assert.rejects(handlers.showIdentityCard(), /Wait a moment/);
    advance(10_000);
    await handlers.showIdentityCard();
    assert.deepEqual(copied, [controller.identityCard()]);
  });
});

const vaultId = 'c'.repeat(32);
const sam = identityOf(new Uint8Array(32).fill(3));
const samHex = identityHex(sam.publicKey);
const samCode = identityCodeOf(sam.publicKey);
const owner = identityOf(new Uint8Array(32).fill(1));
const ownerHex = identityHex(owner.publicKey);
const ownerCode = identityCodeOf(owner.publicKey);
const requestId = 'a'.repeat(64);
const inviteId = 'b'.repeat(64);
const openInviteId = 'd'.repeat(64);

function team(overrides: Partial<TeamInfo> = {}): TeamInfo {
  return {
    vaultId,
    name: 'Roadmap',
    host: 'https://relay.test/',
    role: 'owner',
    pending: false,
    members: [
      {
        identity: ownerHex,
        code: ownerCode,
        name: 'Olga',
        role: 'owner',
        leaving: false,
      },
      {
        identity: samHex,
        code: samCode,
        name: 'Sam',
        role: 'writer',
        leaving: false,
      },
    ],
    invites: [
      { id: inviteId, role: 'writer', approval: true },
      { id: openInviteId, role: 'reader', approval: false },
    ],
    requests: [
      {
        id: requestId,
        identity: samHex,
        code: samCode,
        name: 'Sam',
        role: 'writer',
      },
    ],
    error: null,
    ...overrides,
  };
}

// Records what reached the session, so a declined dialog shows as silence.
function fakeController(teams: TeamInfo[], approval = true) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const previews: string[] = [];
  const record =
    <T>(method: string, result: T) =>
    async (...args: unknown[]): Promise<T> => {
      calls.push({ method, args });
      return result;
    };
  const unexpected = (method: string) => () => {
    throw new Error(`${method} was not expected`);
  };
  const controller: SharingHandlersController = {
    snapshot: () => ({
      status: 'ready',
      code: ownerCode,
      peers: [],
      teams,
      notes: [],
      error: null,
    }),
    identityCard: () => identityCard(owner),
    identityCode: unexpected('identityCode'),
    previewPeer: (card) => {
      if (card !== bobCard) {
        throw new Error('That is not an identity card');
      }
      return {
        identity: identityHex(bob.publicKey),
        code: identityCodeOf(bob.publicKey),
      };
    },
    addPeer: unexpected('addPeer'),
    stopPeer: unexpected('stopPeer'),
    shareMeeting: unexpected('shareMeeting'),
    note: unexpected('note'),
    editNote: unexpected('editNote'),
    deleteNote: unexpected('deleteNote'),
    createTeam: record('createTeam', vaultId),
    previewJoin: async (link) => {
      previews.push(link);
      if (link === 'nod-join:v1:broken') {
        throw new Error('The host can’t be reached');
      }
      return {
        vaultId,
        team: 'Roadmap',
        inviterCode: ownerCode,
        role: 'writer',
        approval,
        host: 'https://relay.test/',
      };
    },
    join: record('join', { vaultId, pending: true }),
    inviteToTeam: record('inviteToTeam', 'nod-join:v1:link'),
    revokeInvite: record('revokeInvite', undefined),
    answerRequest: record('answerRequest', undefined),
    addTeamMembers: record('addTeamMembers', undefined),
    setMemberRole: record('setMemberRole', undefined),
    removeMembers: record('removeMembers', undefined),
    rotateTeamKey: record('rotateTeamKey', undefined),
    transferTeam: record('transferTeam', undefined),
    leaveTeam: record('leaveTeam', undefined),
    addKnownTeam: record('addKnownTeam', vaultId),
    renameTeam: record('renameTeam', undefined),
    nameTeamMember: record('nameTeamMember', undefined),
  };
  return { controller, calls, previews };
}

const relayPlace: SharedPlace = {
  name: 'https://relay.test/',
  open: async () => {
    throw new Error('not opened in tests');
  },
};

function setUpTeams(
  answers: boolean[],
  teams: TeamInfo[] = [team()],
  syncRelay: string | null = 'https://relay.test/',
  approval = true,
) {
  const asked: Question[] = [];
  const copied: string[] = [];
  let synced = 0;
  let clock = 0;
  const { controller, calls, previews } = fakeController(teams, approval);
  const handlers = createSharingHandlers({
    controller,
    place: () => relayPlace,
    syncRelay: () => syncRelay,
    meeting: () => undefined,
    meetingName: () => '',
    recordShare: async () => {},
    gate: createDialogGate({
      confirm: async (question) => {
        asked.push(question);
        return answers.shift() ?? false;
      },
      now: () => clock,
    }),
    copyText: (text) => {
      copied.push(text);
    },
    syncSoon: () => {
      synced += 1;
    },
    now: () => clock,
  });
  return {
    handlers,
    calls,
    previews,
    asked,
    copied,
    synced: () => synced,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function sent(calls: Array<{ method: string; args: unknown[] }>) {
  return calls.map((call) => [call.method, ...call.args]);
}

describe('team handlers', () => {
  it('refuses team ids, roles, names and links of the wrong shape before reaching the session', async () => {
    const { handlers, calls, asked } = setUpTeams([true]);
    await assert.rejects(handlers.createTeam('', 'Olga', null), /short name/);
    await assert.rejects(
      handlers.createTeam('x'.repeat(121), 'Olga', null),
      /short name/,
    );
    await assert.rejects(
      handlers.createTeam('Roadmap', 'o'.repeat(121), null),
      /too long/,
    );
    await assert.rejects(
      handlers.showTeamInvite('abc', 'writer', true),
      /Unknown team/,
    );
    await assert.rejects(handlers.renameTeam('abc', 'Plans'), /Unknown team/);
    await assert.rejects(
      handlers.nameTeamMember(vaultId, 'not-hex', 'Sam'),
      /Unknown person/,
    );
    await assert.rejects(
      handlers.showTeamInvite(vaultId, 'owner', true),
      /Unknown role/,
    );
    await assert.rejects(
      handlers.showTeamInvite(vaultId, 'writer', 'yes'),
      /Unknown choice/,
    );
    await assert.rejects(
      handlers.revokeTeamInvite(vaultId, 'short'),
      /Unknown invite/,
    );
    await assert.rejects(
      handlers.revokeTeamInvite(vaultId, 'e'.repeat(64)),
      /Unknown invite/,
    );
    await assert.rejects(
      handlers.answerTeamRequest(vaultId, requestId, true, 'admin'),
      /at most a writer/,
    );
    await assert.rejects(
      handlers.answerTeamRequest(vaultId, 'e'.repeat(64), true, 'writer'),
      /Unknown request/,
    );
    await assert.rejects(
      handlers.setTeamMemberRole(vaultId, 'e'.repeat(64), 'reader'),
      /Nobody with that identity/,
    );
    await assert.rejects(
      handlers.transferTeam(vaultId, samHex, 'reader'),
      /admin or a writer/,
    );
    await assert.rejects(
      handlers.transferTeam(vaultId, ownerHex, 'admin'),
      /already own/,
    );
    await assert.rejects(
      handlers.removeTeamMember(vaultId, ownerHex),
      /Leave the team instead/,
    );
    await assert.rejects(
      handlers.joinTeam('x'.repeat(1_025), 'Sam'),
      /not a team link/,
    );
    await assert.rejects(
      handlers.addKnownTeam('nod-join:v1:abc'),
      /not a team link/,
    );
    await assert.rejects(
      handlers.shareMeeting('m-1', 'abc'),
      /Unknown share target/,
    );
    await assert.rejects(handlers.leaveTeam('d'.repeat(32)), /Unknown team/);
    assert.deepEqual(calls, []);
    assert.deepEqual(asked, []);
  });

  it('creates a team on the relay this device syncs through, without asking', async () => {
    const online = setUpTeams([], []);
    assert.equal(
      await online.handlers.createTeam(
        'Roadmap',
        ' Olga ',
        'https://elsewhere.test/',
      ),
      vaultId,
    );
    assert.deepEqual(sent(online.calls), [
      ['createTeam', 'Roadmap', 'Olga', 'https://relay.test/'],
    ]);
    assert.deepEqual(online.asked, []);
    assert.equal(online.synced(), 1);
  });

  it('creates a team elsewhere only on a relay the user agrees to, never in a folder', async () => {
    const folder = setUpTeams([false, true], [], null);
    await assert.rejects(
      folder.handlers.createTeam('Roadmap', 'Olga', null),
      /Teams need a relay/,
    );
    await assert.rejects(
      folder.handlers.createTeam('Roadmap', 'Olga', 'not a url'),
      /relay address/,
    );
    assert.equal(folder.asked.length, 0);
    assert.equal(
      await folder.handlers.createTeam('Roadmap', 'Olga', ' https://own.test '),
      null,
    );
    assert.equal(folder.asked[0]?.message, 'Keep the team on own.test?');
    assert.match(folder.asked[0]?.detail ?? '', /^https:\/\/own\.test\/\n\n/);
    assert.deepEqual(folder.calls, []);

    folder.advance(60_000);
    assert.equal(
      await folder.handlers.createTeam('Roadmap', 'Olga', 'https://own.test'),
      vaultId,
    );
    assert.deepEqual(sent(folder.calls), [
      ['createTeam', 'Roadmap', 'Olga', 'https://own.test/'],
    ]);
  });

  it('joins only after the dialog shows the team and the inviter and the user agrees', async () => {
    const { handlers, calls, asked, synced } = setUpTeams([false, true]);
    assert.equal(await handlers.joinTeam('nod-join:v1:x', 'Sam'), null);
    assert.equal(asked[0]?.message, 'Join “Roadmap”?');
    assert.deepEqual(asked[0]?.code, {
      label: 'Invited by',
      value: ownerCode,
    });
    assert.equal(asked[0]?.confirmLabel, 'Ask to join');
    assert.match(asked[0]?.detail ?? '', /accept your request first/);
    assert.deepEqual(calls, []);
    assert.equal(synced(), 0);

    const { handlers: again, calls: joined } = setUpTeams([true]);
    assert.deepEqual(await again.joinTeam('nod-join:v1:x', ' Sam '), {
      vaultId,
      pending: true,
    });
    assert.deepEqual(joined, [
      { method: 'join', args: ['nod-join:v1:x', 'Sam'] },
    ]);
  });

  it('reaches the link’s host for a preview only while the gate is free, and keeps it inside the gate', async () => {
    const { handlers, previews, asked, advance } = setUpTeams([false, false]);
    assert.equal(await handlers.joinTeam('nod-join:v1:x', 'Sam'), null);
    assert.deepEqual(previews, ['nod-join:v1:x']);
    await assert.rejects(
      handlers.joinTeam('nod-join:v1:y', 'Sam'),
      /Wait a moment before trying again/,
    );
    assert.deepEqual(previews, ['nod-join:v1:x']);

    advance(10_000);
    const first = handlers.joinTeam('nod-join:v1:z', 'Sam');
    await assert.rejects(
      handlers.joinTeam('nod-join:v1:w', 'Sam'),
      /Answer the open question first/,
    );
    assert.equal(await first, null);
    assert.deepEqual(previews, ['nod-join:v1:x', 'nod-join:v1:z']);
    assert.equal(asked.length, 2);
  });

  it('counts a preview that failed as a Cancel, so failures can’t probe host after host', async () => {
    const { handlers, previews, asked, advance } = setUpTeams([]);
    await assert.rejects(
      handlers.joinTeam('nod-join:v1:broken', 'Sam'),
      /host can’t be reached/,
    );
    await assert.rejects(
      handlers.joinTeam('nod-join:v1:x', 'Sam'),
      /Wait a moment before trying again/,
    );
    assert.deepEqual(previews, ['nod-join:v1:broken']);
    assert.equal(asked.length, 0);
    advance(10_000);
    assert.equal(await handlers.joinTeam('nod-join:v1:x', 'Sam'), null);
    assert.deepEqual(previews, ['nod-join:v1:broken', 'nod-join:v1:x']);
  });

  it('says an instant-join link works like a key, and how long the invite lasts', async () => {
    const { handlers, asked } = setUpTeams([false], [team()], null, false);
    await handlers.joinTeam('nod-join:v1:x', 'Sam');
    const detail = asked[0]?.detail ?? '';
    assert.equal(asked[0]?.confirmLabel, 'Join');
    assert.match(
      detail,
      /It works like a key: anyone who has it can join the team and read its notes until someone in the team revokes it\./,
    );
    assert.match(detail, /signed by the identity with this code/);
    assert.match(
      detail,
      /kept for 7 days, but the invite stays live until someone in the team revokes it\.$/,
    );
  });

  it('shows the code of the member to remove apart, and keeps their name out of the title', async () => {
    const named = team({
      members: [
        {
          identity: ownerHex,
          code: ownerCode,
          name: 'Olga',
          role: 'owner',
          leaving: false,
        },
        {
          identity: samHex,
          code: samCode,
          name: `Bob (${identityCodeOf(bob.publicKey)})`,
          role: 'writer',
          leaving: false,
        },
      ],
    });
    const { handlers, asked } = setUpTeams([false], [named]);
    await handlers.removeTeamMember(vaultId, samHex);
    assert.equal(asked[0]?.message, 'Remove this member from the team?');
    assert.deepEqual(asked[0]?.code, {
      label: 'Their identity code',
      value: samCode,
    });
    assert.equal(
      asked[0]?.detail.split('\n\n')[0],
      `They are named “Bob (${identityCodeOf(bob.publicKey)})” in “Roadmap”. Check the code is theirs before removing them.`,
    );
  });

  it('accepts a request only after the dialog shows the code, with a role the invite allows, and declines whatever the role', async () => {
    const { handlers, calls, asked } = setUpTeams([false]);
    assert.equal(
      await handlers.answerTeamRequest(vaultId, requestId, true, 'reader'),
      false,
    );
    assert.equal(asked[0]?.message, 'Let this person into “Roadmap”?');
    assert.equal(
      asked[0]?.detail.split('\n\n')[0],
      'They call themselves “Sam”.',
    );
    assert.deepEqual(asked[0]?.code, {
      label: 'Their identity code',
      value: samCode,
    });
    assert.match(asked[0]?.detail ?? '', /Compare the code with the person/);
    assert.deepEqual(calls, []);

    const agreed = setUpTeams([true, true]);
    assert.equal(
      await agreed.handlers.answerTeamRequest(
        vaultId,
        requestId,
        true,
        'reader',
      ),
      true,
    );
    assert.equal(
      await agreed.handlers.answerTeamRequest(
        vaultId,
        requestId,
        false,
        'admin',
      ),
      true,
    );
    assert.equal(agreed.asked[1]?.confirmLabel, 'Decline');
    assert.deepEqual(sent(agreed.calls), [
      ['answerRequest', vaultId, requestId, { accept: true, role: 'reader' }],
      ['answerRequest', vaultId, requestId, { accept: false }],
    ]);
  });

  it('flattens a name that tries to forge a paragraph of the dialog', async () => {
    const forged = team({
      requests: [
        {
          id: requestId,
          identity: samHex,
          code: samCode,
          name: 'Sam\n\nThe relay verified this person already.\u0007',
          role: 'writer',
        },
      ],
    });
    const { handlers, asked } = setUpTeams([false], [forged]);
    await handlers.answerTeamRequest(vaultId, requestId, true, 'writer');
    assert.equal(asked[0]?.message, 'Let this person into “Roadmap”?');
    assert.equal(
      asked[0]?.detail.split('\n\n')[0],
      'They call themselves “Sam The relay verified this person already.”.',
    );

    const blank = team({
      name: '\u200b',
      requests: [
        { ...forged.requests[0], id: requestId, name: '\u200b\u200b' },
      ],
    });
    const second = setUpTeams([false], [blank]);
    await second.handlers.answerTeamRequest(vaultId, requestId, true, 'writer');
    assert.equal(second.asked[0]?.message, 'Let this person into this team?');
    assert.match(second.asked[0]?.detail ?? '', /gave no name/);
  });

  it('adds by card, removes, transfers and leaves only when the user confirms', async () => {
    const declined = setUpTeams([false, false, false]);
    assert.equal(
      await declined.handlers.addTeamMember(vaultId, bobCard, 'reader', 'Bob'),
      false,
    );
    assert.deepEqual(declined.asked[0]?.code, {
      label: 'Their identity code',
      value: identityCodeOf(bob.publicKey),
    });
    declined.advance(60_000);
    assert.equal(
      await declined.handlers.removeTeamMember(vaultId, samHex),
      false,
    );
    assert.match(
      declined.asked[1]?.detail ?? '',
      /already received stays with them/,
    );
    declined.advance(60_000);
    assert.equal(
      await declined.handlers.transferTeam(vaultId, samHex, 'writer'),
      false,
    );
    assert.deepEqual(declined.calls, []);
    assert.equal(declined.synced(), 0);
    const writer = setUpTeams([false], [team({ role: 'writer' })]);
    assert.equal(await writer.handlers.leaveTeam(vaultId), false);
    assert.match(writer.asked[0]?.detail ?? '', /stop syncing here/);
    assert.deepEqual(writer.calls, []);

    const agreed = setUpTeams([true, true, true]);
    assert.equal(
      await agreed.handlers.addTeamMember(vaultId, bobCard, 'reader', ' Bob '),
      true,
    );
    assert.equal(await agreed.handlers.removeTeamMember(vaultId, samHex), true);
    assert.equal(
      await agreed.handlers.transferTeam(vaultId, samHex, 'writer'),
      true,
    );
    assert.deepEqual(sent(agreed.calls), [
      [
        'addTeamMembers',
        vaultId,
        [{ card: bobCard, role: 'reader', name: 'Bob' }],
      ],
      ['removeMembers', vaultId, [samHex]],
      ['transferTeam', vaultId, samHex, 'writer'],
    ]);
    assert.equal(agreed.synced(), 3);
  });

  it('keeps an owner with members from leaving, and lets a lone owner go', async () => {
    const { handlers, calls } = setUpTeams([true]);
    await assert.rejects(handlers.leaveTeam(vaultId), /Hand the team/);
    assert.deepEqual(calls, []);

    const lone = setUpTeams(
      [true],
      [team({ members: team().members.slice(0, 1) })],
    );
    assert.equal(await lone.handlers.leaveTeam(vaultId), true);
    assert.deepEqual(sent(lone.calls), [['leaveTeam', vaultId]]);
  });

  it('makes the invite inside its own dialog, copies the link only from there, and refuses while one was just shown', async () => {
    const { handlers, calls, asked, copied, advance } = setUpTeams([
      false,
      true,
      true,
    ]);
    await handlers.showTeamInvite(vaultId, 'writer', false);
    assert.deepEqual(sent(calls), [['inviteToTeam', vaultId, 'writer', false]]);
    assert.match(
      asked[0]?.detail ?? '',
      /Anyone who ever sees this link can join/,
    );
    assert.deepEqual(copied, []);
    await assert.rejects(
      handlers.showTeamInvite(vaultId, 'reader', true),
      /Wait a moment/,
    );
    await assert.rejects(handlers.showTeamLink(vaultId), /Wait a moment/);
    assert.equal(calls.length, 1);
    advance(10_000);
    await handlers.showTeamInvite(vaultId, 'reader', true);
    assert.match(asked[1]?.detail ?? '', /accept each request after checking/);
    assert.deepEqual(copied, ['nod-join:v1:link']);
    advance(10_000);
    await handlers.showTeamLink(vaultId);
    assert.deepEqual(copied, [
      'nod-join:v1:link',
      `nod-team:v1:${vaultId}:https://relay.test/`,
    ]);
  });

  it('asks before widening rights, revoking, changing the key or reaching a host, and skips nothing when declined', async () => {
    const declined = setUpTeams([false, false, false, false]);
    assert.equal(
      await declined.handlers.setTeamMemberRole(vaultId, samHex, 'admin'),
      false,
    );
    assert.equal(
      declined.asked[0]?.message,
      'Make this member an admin of “Roadmap”?',
    );
    assert.equal(
      declined.asked[0]?.detail.split('\n\n')[0],
      'They are named “Sam”.',
    );
    declined.advance(60_000);
    assert.equal(
      await declined.handlers.revokeTeamInvite(vaultId, openInviteId),
      false,
    );
    assert.match(declined.asked[1]?.detail ?? '', /key changes too/);
    declined.advance(60_000);
    assert.equal(await declined.handlers.rotateTeamKey(vaultId), false);
    declined.advance(60_000);
    assert.equal(
      await declined.handlers.addKnownTeam(
        `nod-team:v1:${vaultId}:https://other.test/`,
      ),
      null,
    );
    assert.match(
      declined.asked[3]?.detail ?? '',
      /reach https:\/\/other\.test\//,
    );
    assert.deepEqual(declined.calls, []);
    assert.equal(declined.synced(), 0);

    const agreed = setUpTeams([true, true, true, true]);
    assert.equal(
      await agreed.handlers.setTeamMemberRole(vaultId, samHex, 'admin'),
      true,
    );
    assert.equal(
      await agreed.handlers.revokeTeamInvite(vaultId, inviteId),
      true,
    );
    assert.match(agreed.asked[1]?.detail ?? '', /Requests already waiting/);
    assert.equal(await agreed.handlers.rotateTeamKey(vaultId), true);
    assert.equal(
      await agreed.handlers.addKnownTeam(
        `nod-team:v1:${vaultId}:https://relay.test/`,
      ),
      vaultId,
    );
    assert.deepEqual(
      agreed.calls.map((call) => call.method),
      ['setMemberRole', 'revokeInvite', 'rotateTeamKey', 'addKnownTeam'],
    );
    assert.deepEqual(agreed.calls[0]?.args.slice(0, 3), [
      vaultId,
      samHex,
      'admin',
    ]);
    assert.deepEqual(agreed.calls[3]?.args, [
      `nod-team:v1:${vaultId}:https://relay.test/`,
    ]);
    assert.equal(agreed.synced(), 4);
  });

  it('asks before a demotion, since it changes the key, and passes names straight through', async () => {
    const declined = setUpTeams([false]);
    assert.equal(
      await declined.handlers.setTeamMemberRole(vaultId, samHex, 'reader'),
      false,
    );
    assert.match(declined.asked[0]?.detail ?? '', /new key/);
    assert.deepEqual(declined.calls, []);

    const { handlers, calls, asked, synced } = setUpTeams([true]);
    assert.equal(
      await handlers.setTeamMemberRole(vaultId, samHex, 'reader'),
      true,
    );
    assert.equal(
      await handlers.setTeamMemberRole(vaultId, samHex, 'writer'),
      true,
      'the role the member already has needs no change',
    );
    await handlers.renameTeam(vaultId, ' Plans ');
    await handlers.nameTeamMember(vaultId, samHex, ' Samuel ');
    assert.deepEqual(sent(calls.slice(0, 1)), [
      ['setMemberRole', vaultId, samHex, 'reader'],
    ]);
    assert.deepEqual(
      calls.slice(1).map((call) => [call.method, ...call.args]),
      [
        ['renameTeam', vaultId, 'Plans'],
        ['nameTeamMember', vaultId, samHex, 'Samuel'],
      ],
    );
    assert.equal(asked.length, 1);
    assert.equal(synced(), 3);
  });

  it('tells the renderer whether a note lives with a person or in a team', async () => {
    const { controller } = fakeController([]);
    const handlers = createSharingHandlers({
      controller: {
        ...controller,
        snapshot: () => ({
          status: 'ready',
          code: ownerCode,
          peers: [],
          teams: [],
          notes: [
            {
              id: 'n1',
              title: 'A',
              sharedAt: 1,
              target: vaultId,
              kind: 'team',
              label: 'Roadmap',
            },
            {
              id: 'n2',
              title: 'B',
              sharedAt: 2,
              target: samHex,
              kind: 'person',
              label: samCode,
            },
          ],
          error: null,
        }),
      },
      place: () => null,
      syncRelay: () => null,
      meeting: () => undefined,
      meetingName: () => '',
      recordShare: async () => {},
      gate: createDialogGate({ confirm: async () => false, now: () => 0 }),
      copyText: () => {},
      syncSoon: () => {},
      now: () => 0,
    });
    const state = handlers.getSharingState();
    assert.deepEqual(
      state.status === 'ready' ? state.notes.map((note) => note.kind) : [],
      ['team', 'person'],
    );
  });
});
