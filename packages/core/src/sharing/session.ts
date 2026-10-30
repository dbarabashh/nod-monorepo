import {
  blindedDeviceId,
  fromHex,
  identityCard,
  identityCodeOf,
  identityHex,
  identityOf,
  isIdentityHex,
  parseIdentityCard,
  toHex,
  vaultIdOf,
  type Identity,
} from '../crypto/index.ts';
import type { Cipher, Meeting } from '../meetings/index.ts';
import {
  composeEngines,
  createDocumentSyncEngine,
  messageOf,
  type PublishedLog,
  type SyncEngine,
} from '../sync/engine.ts';
import { devicesPrefix, membersPath, notePath } from '../sync/layout.ts';
import { relayBase } from '../sync/relay.ts';
import { RequestRefused, type Transport } from '../sync/transport.ts';
import {
  decodeAccessList,
  encodeAccessList,
  extendsKnown,
  isTeamVaultId,
  teamVaultIdOf,
  type GrantedRole,
  type Role,
  type SignedAccessRecord,
} from './access-list.ts';
import {
  applyRecord,
  canManage,
  canWrite,
  liveInvites,
  pendingRequests,
  replayAccessList,
  roleOf,
  startAccessList,
  type AccessState,
} from './access-list-validator.ts';
import {
  inviteFileIdOf,
  joinLink,
  openInviteFile,
  parseJoinLink,
  parseTeamLink,
  sealInviteFile,
  signInviteFile,
  teamLink,
  type InviteFile,
  type JoinLink,
} from './invite.ts';
import { createMembersStore, type MembersStore } from './members-store.ts';
import {
  createNoteStore,
  type NoteFiles,
  type NoteStore,
} from './note-store.ts';
import { editNoteSummary, noteFromMeeting, type SharedNote } from './note.ts';
import type { Peer, Team, TeamEntry } from './shares-document.ts';
import {
  createSharesStore,
  type SharesFile,
  type SharesStore,
} from './shares-store.ts';
import type { SingleFile } from './single-document-store.ts';
import { openJoinName, recoverTeamKeys } from './team-keys.ts';
import { HeadMoved, NotAMember, type TeamPlace } from './team-place.ts';
import {
  accountsAddRecord,
  accountsRemoveRecord,
  inviteJoinRecord,
  inviteRecord,
  inviteRevokeRecord,
  keyChangeRecord,
  ownerChangeRecord,
  permissionChangesRecord,
  requestAcceptRecord,
  requestDeclineRecord,
  requestJoinRecord,
  requestRemoveRecord,
  rootRecord,
  type CurrentKey,
} from './team-records.ts';
import {
  membersDocuments,
  oneToOneKeys,
  oneToOneVault,
  sharedNoteDocuments,
  sharesDocuments,
  teamKeys,
  type OneToOneVault,
  type TeamView,
} from './vaults.ts';

// Where one-to-one vaults' files live and how to reach them: the app knows
// its folder or relay, the session knows the vaults. A place is named so a
// published log can be scoped to it. Teams live on a relay only, reached by
// its host through `TeamRelays`: a folder has no server to keep one list.
export type SharedPlace = {
  name: string;
  open: (vault: { id: string; token: string }) => Promise<Transport>;
};

// What only a relay does for teams: a team reached by the host its list
// lives on, and the invite file anyone with the link may fetch.
export type TeamRelays = {
  open: (
    host: string,
    vaultId: string,
    identity: Identity,
  ) => Promise<TeamPlace>;
  fetchInvite: (link: JoinLink) => Promise<Uint8Array | null>;
};

export type TeamFiles = {
  notes: NoteFiles;
  members: SingleFile;
  list: SingleFile;
};

export type SharingPeerInfo = {
  identity: string;
  code: string;
  stoppedAt: number | null;
};

export type TeamMemberInfo = {
  identity: string;
  code: string;
  name: string | null;
  role: Role;
  leaving: boolean;
};

export type TeamInviteInfo = {
  id: string;
  role: GrantedRole;
  approval: boolean;
};

export type TeamRequestInfo = {
  id: string;
  identity: string;
  code: string;
  name: string | null;
  role: GrantedRole;
};

export type TeamInfo = {
  vaultId: string;
  name: string;
  host: string;
  role: Role | null;
  // This person's request to join waits for an answer.
  pending: boolean;
  members: TeamMemberInfo[];
  invites: TeamInviteInfo[];
  requests: TeamRequestInfo[];
  error: string | null;
};

export type JoinPreview = {
  vaultId: string;
  team: string;
  inviterCode: string;
  role: GrantedRole;
  approval: boolean;
  host: string;
};

// A note's home: the person it is shared with one to one (their identity
// as hex) or the team it is shared in (the team vault's id).
export type ShareTargetKind = 'person' | 'team';

export type SharedNoteSummary = {
  id: string;
  title: string;
  sharedAt: number;
  target: string;
  kind: ShareTargetKind;
  label: string;
};

// A team the old identity handed to its successor at a change of phrase.
export type HandedTeam = { link: string; replaces: string };

// What ending an identity did: the teams handed to the successor, and the
// names of those it may still manage and couldn't hand over yet.
export type EndedIdentity = { handed: HandedTeam[]; unfinished: string[] };

export type SharedNoteDetail = SharedNote & {
  target: string;
  kind: ShareTargetKind;
  // The version shown, which an edit made from it names when it is saved.
  version: string;
};

export type SharingSnapshot =
  | { status: 'none' }
  | {
      status: 'ready';
      code: string;
      peers: SharingPeerInfo[];
      teams: TeamInfo[];
      notes: SharedNoteSummary[];
      error: string | null;
    };

// The vault shared with one person, derived once from their card, and the
// engine that moves its notes through the current place.
type PeerVault = {
  identity: string;
  vault: OneToOneVault;
  blinded: string;
  store: NoteStore;
  engine: SyncEngine | null;
  transport: Transport | null;
  placeName: string | null;
};

// A team this person is in: its list as this device last validated it, the
// keys it can open, and the engine that moves its notes and names.
type TeamVault = {
  vaultId: string;
  host: string;
  blinded: string;
  records: SignedAccessRecord[];
  view: TeamView | null;
  notes: NoteStore;
  members: MembersStore;
  list: SingleFile;
  place: TeamPlace | null;
  engine: SyncEngine | null;
  error: string | null;
  // Names opened once per join record (an asymmetric decrypt each), and
  // members whose sealed name was tried and found unreadable.
  openedNames: Map<string, string | null>;
  // Someone lost a right before this run's engine existed: the engine reads
  // every file again once it does, instead of trusting what was received.
  recheckPending: boolean;
};

const unnamedTeam = 'Unnamed team';
const endedMessage =
  'Sharing is moving to the new phrase. Try again in a moment.';

const oldRelayMessage =
  'This relay doesn’t do sharing yet, so your shares list stays on this device until the relay is updated.';
const listContext = 'nod:team-list';

export type SharingSession = ReturnType<typeof createSharingSession>;

export function createSharingSession(options: {
  // The shares list belongs to one vault: another phrase is another person
  // to the people they share with, so it starts its own list.
  sharesFileFor: (vaultId: string) => SharesFile;
  noteFilesFor: (vaultId: string) => NoteFiles;
  teamFilesFor?: (vaultId: string) => TeamFiles;
  relays?: TeamRelays;
  cipher: () => Promise<Cipher>;
  publishedLogFor?: (scope: string) => Promise<PublishedLog>;
  newId: () => string;
  now: () => number;
  onChange: () => void;
}) {
  const { newId, now, onChange } = options;
  let identity: Identity | null = null;
  let deviceId: string | null = null;
  // Set once the identity ended with its phrase: a call that waited behind
  // the hand-over must not act as it, until another identity is loaded.
  let ended = false;
  let sharesStore: SharesStore | null = null;
  let cipher: Cipher | null = null;
  const vaults = new Map<string, PeerVault>();
  const teams = new Map<string, TeamVault>();
  let error: string | null = null;
  let busy: Promise<void> = Promise.resolve();

  async function requireCipher(): Promise<Cipher> {
    cipher ??= await options.cipher();
    return cipher;
  }

  function requireIdentity(): { identity: Identity; deviceId: string } {
    if (ended) {
      throw new Error(endedMessage);
    }
    if (!identity || !deviceId) {
      throw new Error('Set up a recovery phrase before sharing');
    }
    return { identity, deviceId };
  }

  function requireShares(): SharesStore {
    if (ended) {
      throw new Error(endedMessage);
    }
    if (!sharesStore) {
      throw new Error('Saved shares could not be read');
    }
    return sharesStore;
  }

  function peers(): Peer[] {
    return sharesStore?.shares().peers ?? [];
  }

  function peerOf(peerIdentity: string): Peer {
    const peer = peers().find((entry) => entry.identity === peerIdentity);
    if (!peer) {
      throw new Error('Nobody with that identity is shared with');
    }
    return peer;
  }

  // Nothing is written for a person sharing was stopped with; their vault is
  // still derived to take this device's copies out of it.
  function requireActive(peerIdentity: string): Peer {
    const peer = peerOf(peerIdentity);
    if (peer.stoppedAt !== null) {
      throw new Error('Sharing with that person was stopped');
    }
    return peer;
  }

  function activePeers(): string[] {
    return peers()
      .filter((peer) => peer.stoppedAt === null)
      .map((peer) => peer.identity);
  }

  function stopEngines() {
    for (const entry of vaults.values()) {
      entry.engine?.stop();
    }
    vaults.clear();
    for (const team of teams.values()) {
      team.engine?.stop();
    }
    teams.clear();
  }

  async function vaultFor(peerIdentity: string): Promise<PeerVault> {
    const known = vaults.get(peerIdentity);
    if (known) {
      return known;
    }
    const card = parseIdentityCard(peerOf(peerIdentity).card);
    if (!card) {
      throw new Error('Nobody with that identity is shared with');
    }
    const me = requireIdentity();
    const vault = oneToOneVault(me.identity, card);
    const store = createNoteStore({
      files: options.noteFilesFor(vault.id),
      cipher: await requireCipher(),
    });
    await store.load();
    const entry: PeerVault = {
      identity: peerIdentity,
      vault,
      blinded: blindedDeviceId(me.identity, vault.id, me.deviceId),
      store,
      engine: null,
      transport: null,
      placeName: null,
    };
    vaults.set(peerIdentity, entry);
    return entry;
  }

  async function engineFor(
    entry: PeerVault,
    place: SharedPlace,
  ): Promise<{ engine: SyncEngine; transport: Transport }> {
    if (entry.engine && entry.transport && entry.placeName === place.name) {
      return { engine: entry.engine, transport: entry.transport };
    }
    const { vault, blinded } = entry;
    const transport = await place.open({ id: vault.id, token: vault.token });
    const engine = createDocumentSyncEngine({
      transport,
      vault: { deviceId: blinded },
      documents: sharedNoteDocuments(
        oneToOneKeys(requireIdentity().identity, vault),
      ),
      store: entry.store,
      onRemote: () => onChange(),
      now,
      publishedLog: await options.publishedLogFor?.(
        `${vault.id}:${blinded}:${place.name}`,
      ),
    });
    entry.engine = engine;
    entry.transport = transport;
    entry.placeName = place.name;
    return { engine, transport };
  }

  // Ends this device's part in a share: its copies leave the shared vault,
  // the engine stops, and the vault is forgotten here. The other person
  // keeps what they already received. The share ends here whatever the
  // place answers: a place that can't be reached keeps the copies, and says
  // so, but never keeps the share alive.
  async function retire(
    peerIdentity: string,
    place: SharedPlace | null,
  ): Promise<string | null> {
    const entry =
      vaults.get(peerIdentity) ??
      (await vaultFor(peerIdentity).catch(() => null));
    if (!entry) {
      return null;
    }
    let failed: string | null = null;
    if (place) {
      try {
        const { transport } = await engineFor(entry, place);
        for (const id of entry.store.ids()) {
          await transport.remove(notePath(entry.blinded, id));
        }
      } catch (failure) {
        failed = `The copies this device put in the shared vault stayed there: ${messageOf(failure)}`;
      }
    }
    entry.engine?.stop();
    vaults.delete(peerIdentity);
    return failed;
  }

  // A share stopped on another of this person's devices ends here too, once
  // the shares list brings the stop over.
  async function retireStopped(place: SharedPlace): Promise<string[]> {
    const active = new Set(activePeers());
    const gone = [...vaults.keys()].filter((peer) => !active.has(peer));
    const failures = await Promise.all(gone.map((peer) => retire(peer, place)));
    return failures.filter((failed) => failed !== null);
  }

  async function peerRound(
    peer: string,
    place: SharedPlace,
  ): Promise<string[]> {
    try {
      const entry = await vaultFor(peer);
      const { engine } = await engineFor(entry, place);
      await engine.sync();
      const failed = engine.status().error;
      return failed ? [failed] : [];
    } catch (failure) {
      return [messageOf(failure)];
    }
  }

  function peersOf(): SharingPeerInfo[] {
    return peers().map(({ identity: peer, code, stoppedAt }) => ({
      identity: peer,
      code,
      stoppedAt,
    }));
  }

  async function withLock<T>(action: () => Promise<T>): Promise<T> {
    const run = busy.then(action);
    busy = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function teamEntries(): Team[] {
    return sharesStore?.shares().teams ?? [];
  }

  function activeTeams(): Team[] {
    return teamEntries().filter((team) => team.leftAt === null);
  }

  function teamFilesFor(vaultId: string): TeamFiles {
    if (!options.teamFilesFor) {
      throw new Error('Teams aren’t available on this device');
    }
    return options.teamFilesFor(vaultId);
  }

  function requireRelays(): TeamRelays {
    if (!options.relays) {
      throw new Error('Teams on a relay aren’t available on this device');
    }
    return options.relays;
  }

  const codes = new Map<string, string>();
  function codeOf(identityText: string): string {
    const known = codes.get(identityText);
    if (known) {
      return known;
    }
    const code = identityCodeOf(fromHex(identityText));
    codes.set(identityText, code);
    return code;
  }

  function myIdentityHex(): string {
    return identityHex(requireIdentity().identity.publicKey);
  }

  function replayOf(
    vaultId: string,
    records: SignedAccessRecord[],
  ): AccessState {
    const replayed = replayAccessList(vaultId, records);
    if (!replayed.ok) {
      throw new Error(
        `The team’s list doesn’t hold together: ${replayed.reason}`,
      );
    }
    return replayed.state;
  }

  function viewOf(state: AccessState): TeamView {
    return {
      state,
      keys: recoverTeamKeys(state, requireIdentity().identity),
    };
  }

  async function teamFor(entry: Team): Promise<TeamVault> {
    const known = teams.get(entry.vaultId);
    if (known) {
      return known;
    }
    const me = requireIdentity();
    const files = teamFilesFor(entry.vaultId);
    const sealed = await requireCipher();
    const notes = createNoteStore({ files: files.notes, cipher: sealed });
    const members = createMembersStore({
      vaultId: entry.vaultId,
      file: files.members,
      cipher: sealed,
    });
    const [, , stored] = await Promise.all([
      notes.load(),
      members.load(),
      files.list.read(),
    ]);
    const team: TeamVault = {
      vaultId: entry.vaultId,
      host: entry.host,
      blinded: blindedDeviceId(me.identity, entry.vaultId, me.deviceId),
      records: [],
      view: null,
      notes,
      members,
      list: files.list,
      place: null,
      engine: null,
      error: null,
      openedNames: new Map(),
      recheckPending: false,
    };
    // The list as this device last saw it, so the team is known offline and
    // a place that serves an older list is caught.
    try {
      const records = stored
        ? decodeAccessList(sealed.decrypt(stored, listContext))
        : null;
      if (records) {
        team.records = records;
        team.view = viewOf(replayOf(entry.vaultId, records));
      }
    } catch (failure) {
      team.error = messageOf(failure);
    }
    teams.set(entry.vaultId, team);
    return team;
  }

  async function keepList(
    team: TeamVault,
    records: SignedAccessRecord[],
    state: AccessState,
  ) {
    // Someone who could write or manage and now can't: what was taken from
    // them is judged again, so their copies stop counting.
    const before = team.view?.state;
    if (
      before &&
      Object.values(before.members).some((member) => {
        const now = roleOf(state, member.identity);
        return (
          (canWrite(member.role) && !canWrite(now)) ||
          (canManage(member.role) && !canManage(now))
        );
      })
    ) {
      if (team.engine) {
        team.engine.recheck?.();
      } else {
        team.recheckPending = true;
      }
    }
    team.view = viewOf(state);
    team.records = records;
    const sealed = await requireCipher();
    await team.list.write(
      sealed.encrypt(encodeAccessList(records), listContext),
    );
  }

  // The relay a team lives on, whatever place the person's own vault syncs
  // through.
  async function teamPlaceFor(team: TeamVault): Promise<TeamPlace> {
    if (team.place) {
      return team.place;
    }
    const opened = await requireRelays().open(
      team.host,
      team.vaultId,
      requireIdentity().identity,
    );
    team.place = opened;
    return opened;
  }

  // Fetches the list and takes it only when it extends what this device
  // validated before, record for record: a join record follows nothing, so
  // finding the known head somewhere in the list would still let a place
  // splice a removal or a rotation out from before it. Only the records on
  // top are validated again.
  async function refreshList(team: TeamVault, place: TeamPlace) {
    const records = await place.list.read();
    if (!extendsKnown(team.records, records)) {
      throw new Error(
        'The place serves an older team list than this device has seen',
      );
    }
    if (records.length === team.records.length) {
      team.view ??= viewOf(replayOf(team.vaultId, records));
      return;
    }
    let state = team.view?.state;
    if (state) {
      for (const record of records.slice(team.records.length)) {
        const next = applyRecord(state, record);
        if (!next.ok) {
          throw new Error(
            `The team’s list doesn’t hold together: ${next.reason}`,
          );
        }
        state = next.state;
      }
    } else {
      state = replayOf(team.vaultId, records);
    }
    await keepList(team, records, state);
  }

  function requireView(team: TeamVault): TeamView {
    if (!team.view) {
      throw new Error(team.error ?? 'The team’s list hasn’t arrived yet');
    }
    return team.view;
  }

  function keyMissingMessage(team: TeamVault): string {
    const newest = team.view?.keys.missing[0];
    const by = newest
      ? team.records.find((record) => record.id === newest.record)?.author
      : undefined;
    return by
      ? `This device can’t open the team’s current key; the change by ${codeOf(by)} left it out. An owner or admin can repair it with a key change.`
      : 'This device can’t open the team’s current key yet';
  }

  function requireKey(team: TeamVault): CurrentKey {
    const current = requireView(team).keys.current;
    if (!current) {
      throw new Error(keyMissingMessage(team));
    }
    return current;
  }

  function requireManager(team: TeamVault): AccessState {
    const { state } = requireView(team);
    if (!canManage(roleOf(state, myIdentityHex()))) {
      throw new Error('Only an owner or admin of the team can do that');
    }
    return state;
  }

  function teamNameOf(team: TeamVault): string {
    return team.members.members().team || unnamedTeam;
  }

  // Builds a record on the list as it stands and appends it; when the list
  // grew in between, the record is built again on the new head. Whatever
  // else the builder made beside the record (an invite's keys) comes back
  // with it.
  async function appendRecord<T extends { record: SignedAccessRecord }>(
    team: TeamVault,
    place: TeamPlace,
    build: (state: AccessState, key: CurrentKey | null) => T,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await refreshList(team, place);
      const { state, keys } = requireView(team);
      const built = build(state, keys.current);
      const checked = applyRecord(state, built.record);
      if (!checked.ok) {
        throw new Error(`The team wouldn’t accept that: ${checked.reason}`);
      }
      try {
        await place.list.append(built.record);
      } catch (failure) {
        if (failure instanceof HeadMoved) {
          continue;
        }
        throw failure;
      }
      await keepList(team, [...team.records, built.record], checked.state);
      return built;
    }
    throw new Error('The team’s list kept changing; try again');
  }

  async function teamEngine(
    team: TeamVault,
    place: TeamPlace,
  ): Promise<SyncEngine> {
    if (team.engine) {
      return team.engine;
    }
    const keys = teamKeys(
      team.vaultId,
      requireIdentity().identity,
      () => team.view,
    );
    const scope = `${team.vaultId}:${team.blinded}:${team.host}`;
    const [notesLog, membersLog] = await Promise.all([
      options.publishedLogFor?.(scope),
      options.publishedLogFor?.(`members:${scope}`),
    ]);
    const notes = createDocumentSyncEngine({
      transport: place.transport,
      vault: { deviceId: team.blinded },
      documents: sharedNoteDocuments(keys),
      store: team.notes,
      onRemote: () => onChange(),
      now,
      publishedLog: notesLog,
    });
    const members = createDocumentSyncEngine({
      transport: place.transport,
      vault: { deviceId: team.blinded },
      documents: membersDocuments(keys),
      store: team.members,
      onRemote: () => onChange(),
      now,
      publishedLog: membersLog,
    });
    team.engine = composeEngines([notes, members]);
    if (team.recheckPending) {
      team.engine.recheck?.();
      team.recheckPending = false;
    }
    return team.engine;
  }

  function openedName(
    team: TeamVault,
    id: string,
    sealed: string,
  ): string | null {
    const known = team.openedNames.get(id);
    if (known !== undefined) {
      return known;
    }
    const name =
      openJoinName(requireIdentity().identity, sealed)?.trim() || null;
    team.openedNames.set(id, name);
    return name;
  }

  // Names joiners sealed for this device's identity go into the members
  // document once this device, as a manager, sees them in the list.
  async function adoptJoinNames(team: TeamVault) {
    const view = team.view;
    if (!view || !canManage(roleOf(view.state, myIdentityHex()))) {
      return;
    }
    const known = team.members.members().names;
    for (const member of Object.values(view.state.members)) {
      if (member.name === null || known[member.identity] !== undefined) {
        continue;
      }
      const name = openedName(team, member.identity, member.name);
      if (name !== null) {
        await team.members.nameMember(member.identity, name);
      }
    }
  }

  // A join this person asked for: the relay says whether an owner or admin
  // answered yet. Only a clear decline ends the request; an answer that
  // can't be read is a passing fault, not a decision.
  async function followRequest(entry: Team): Promise<string | null> {
    if (entry.request === null) {
      return null;
    }
    const team = await teamFor(entry);
    const at = await teamPlaceFor(team);
    const status = await at.status(entry.request);
    if (status === 'accepted') {
      await requireShares().addTeam(entry.vaultId, {
        ...entryOf(entry),
        request: null,
      });
      return null;
    }
    if (status === 'declined') {
      await requireShares().leaveTeam(entry.vaultId, now());
      team.engine?.stop();
      teams.delete(entry.vaultId);
      return 'Your request to join the team was declined';
    }
    return status === 'unknown'
      ? 'The relay doesn’t know your request to join the team yet'
      : null;
  }

  async function teamRound(entry: Team): Promise<string[]> {
    const team = await teamFor(entry);
    try {
      if (entry.request !== null) {
        const failed = await followRequest(entry);
        return failed ? [failed] : [];
      }
      const at = await teamPlaceFor(team);
      await refreshList(team, at);
      if (!(await confirmInviter(entry, team))) {
        return [team.error ?? ''];
      }
      const { state, keys } = requireView(team);
      if (roleOf(state, myIdentityHex()) === null) {
        await leaveLocally(team, 'You are no longer a member of this team');
        return [team.error ?? ''];
      }
      team.error = keys.current ? null : keyMissingMessage(team);
      await removePredecessor(entry, team, at);
      await adoptJoinNames(team);
      const engine = await teamEngine(team, at);
      await engine.sync(await at.transport.list(devicesPrefix()));
      const failed = engine.status().error;
      return [team.error, failed].filter(
        (message): message is string => message !== null,
      );
    } catch (failure) {
      // A relay's refusal is its word, not the list's: a proxy, a relay that
      // lost its state or a hostile one could say the same. The team stays
      // until a list this device validates leaves this identity out, and the
      // person can leave it themselves.
      team.error =
        failure instanceof NotAMember
          ? 'The relay no longer lets you read this team’s list. If you were removed, leave the team.'
          : messageOf(failure);
      return [team.error];
    }
  }

  // After a change of phrase the old identity stays in the team until the new
  // one removes it, with a new key, so the old phrase opens nothing later.
  // Only an owner removes an admin; a successor that can't says so.
  async function removePredecessor(
    entry: Team,
    team: TeamVault,
    at: TeamPlace,
  ): Promise<void> {
    const old = entry.replaces;
    if (old === null) {
      return;
    }
    const { state } = requireView(team);
    const member = state.members[old];
    const mine = roleOf(state, myIdentityHex());
    if (
      member &&
      (member.role === 'owner' ||
        (member.role === 'admin' && mine !== 'owner') ||
        !canManage(mine))
    ) {
      team.error = `Your old identity ${codeOf(old)} is still in this team; ask its owner to remove it.`;
      return;
    }
    if (member) {
      const me = requireIdentity().identity;
      await appendRecord(team, at, (current, key) =>
        accountsRemoveRecord(
          me,
          current,
          requireCurrent(team, key),
          [old],
          now(),
        ),
      );
    }
    await requireShares().addTeam(entry.vaultId, {
      ...entryOf(entry),
      replaces: null,
    });
  }

  // The first list this identity reads must show that the invite it joined
  // through was written by the identity the link named: a link can carry
  // anyone's public card, and the person checked that one's code.
  async function confirmInviter(
    entry: Team,
    team: TeamVault,
  ): Promise<boolean> {
    const expected = entry.invitedBy;
    if (expected === null) {
      return true;
    }
    const invite = team.records.find((record) => record.id === expected.invite);
    if (invite?.author !== expected.identity) {
      await leaveLocally(
        team,
        'This team’s invite wasn’t made by the person the link named, so this device left the team',
      );
      return false;
    }
    await requireShares().addTeam(entry.vaultId, {
      ...entryOf(entry),
      invitedBy: null,
    });
    return true;
  }

  async function leaveLocally(team: TeamVault, reason: string) {
    team.error = reason;
    team.engine?.stop();
    team.engine = null;
    await requireShares().leaveTeam(team.vaultId, now());
  }

  // Takes this device's copies out of a team vault it leaves, best effort.
  async function removeOwnFiles(team: TeamVault, place: TeamPlace | null) {
    if (!place) {
      return;
    }
    for (const id of team.notes.ids()) {
      await place.transport.remove(notePath(team.blinded, id));
    }
    if (team.members.ids().length > 0) {
      await place.transport.remove(membersPath(team.blinded));
    }
  }

  // What a manager can give the identity that replaces it: an owner hands
  // the team over outright, an admin can only add a writer, since admins
  // don't make admins. The name follows, so the team sees the same person.
  // How far a hand-over got: the successor added, and for an owner, the team
  // handed over too. Adding is what makes the successor's entry worth
  // keeping, whatever comes after it.
  type HandOver = { added: boolean; complete: boolean };

  async function handOver(
    team: TeamVault,
    at: TeamPlace,
    card: string,
  ): Promise<HandOver & { failure: string | null }> {
    const me = requireIdentity().identity;
    const mine = myIdentityHex();
    const successor = parseIdentityCard(card);
    if (!successor) {
      throw new Error('That is not an identity card');
    }
    const next = identityHex(successor.publicKey);
    const state = requireView(team).state;
    const role = roleOf(state, mine);
    // A hand-over cut short by a crash runs again at the next start, and
    // may find the successor already added, or already the owner.
    const added = roleOf(state, next) !== null;
    if (!canManage(role)) {
      return { added, complete: added, failure: null };
    }
    if (!added) {
      await appendRecord(team, at, (current, key) => ({
        record: accountsAddRecord(
          me,
          current,
          requireCurrent(team, key),
          [{ card, role: role === 'owner' ? 'admin' : 'writer' }],
          now(),
        ),
      }));
    }
    try {
      // The name goes out while this identity still manages the team; after
      // the owner change it is a writer, whose member list nobody reads.
      const name = team.members.members().names[mine];
      if (name !== undefined) {
        await team.members.nameMember(next, name);
        await teamEngine(team, at).then((engine) => engine.sync());
      }
      if (role === 'owner') {
        await appendRecord(team, at, (state) => ({
          record: ownerChangeRecord(me, state, next, 'writer', now()),
        }));
      } else if (!requireView(team).state.members[mine]?.leaving) {
        // An admin's successor joins as a writer and can't remove an admin;
        // asking to leave shows the owner what's left to do.
        await appendRecord(team, at, (current) => ({
          record: requestRemoveRecord(me, current, now()),
        }));
      }
    } catch (failure) {
      return { added: true, complete: false, failure: messageOf(failure) };
    }
    return { added: true, complete: true, failure: null };
  }

  function requireCurrent(team: TeamVault, key: CurrentKey | null): CurrentKey {
    if (!key) {
      throw new Error(keyMissingMessage(team));
    }
    return key;
  }

  function teamInfoOf(entry: Team, team: TeamVault | undefined): TeamInfo {
    const view = team?.view ?? null;
    const document = team?.members.members();
    const names = document?.names ?? {};
    const me = identity ? identityHex(identity.publicKey) : '';
    const members: TeamMemberInfo[] = view
      ? Object.values(view.state.members).map((member) => ({
          identity: member.identity,
          code: codeOf(member.identity),
          name: names[member.identity] ?? null,
          role: member.role,
          leaving: member.leaving,
        }))
      : [];
    members.sort((a, b) => a.code.localeCompare(b.code));
    const manager = view ? canManage(roleOf(view.state, me)) : false;
    return {
      vaultId: entry.vaultId,
      name: document?.team || unnamedTeam,
      host: entry.host,
      role: view ? roleOf(view.state, me) : null,
      pending: entry.request !== null,
      members,
      invites:
        view && manager
          ? liveInvites(view.state).map(({ id, role, approval }) => ({
              id,
              role,
              approval,
            }))
          : [],
      requests:
        view && manager && team
          ? pendingRequests(view.state).map((request) => ({
              id: request.id,
              identity: request.identity,
              code: codeOf(request.identity),
              name:
                request.name === null
                  ? null
                  : openedName(team, request.id, request.name),
              role: view.state.invites[request.invite]?.role ?? 'reader',
            }))
          : [],
      error: team?.error ?? null,
    };
  }

  function teamOf(vaultId: string): Team {
    const entry = activeTeams().find((team) => team.vaultId === vaultId);
    if (!entry) {
      throw new Error('You aren’t in that team');
    }
    return entry;
  }

  function memberEntry(vaultId: string): Team {
    const entry = teamOf(vaultId);
    if (entry.request !== null) {
      throw new Error(
        'Your request to join that team hasn’t been answered yet',
      );
    }
    return entry;
  }

  async function memberTeam(
    vaultId: string,
  ): Promise<{ team: TeamVault; at: TeamPlace }> {
    const team = await teamFor(memberEntry(vaultId));
    const at = await teamPlaceFor(team);
    return { team, at };
  }

  // One change by an owner or admin: the record is built on the list as it
  // stands, with the current key, and appended.
  async function managerRecord<T extends { record: SignedAccessRecord }>(
    vaultId: string,
    build: (
      me: Identity,
      state: AccessState,
      key: CurrentKey,
      team: TeamVault,
    ) => T,
  ): Promise<T & { team: TeamVault; at: TeamPlace }> {
    const { team, at } = await memberTeam(vaultId);
    const me = requireIdentity().identity;
    const built = await appendRecord(team, at, (state, key) => {
      requireManager(team);
      return build(me, state, requireCurrent(team, key), team);
    });
    onChange();
    return { ...built, team, at };
  }

  type Target =
    | { kind: 'person'; identity: string }
    | { kind: 'team'; vaultId: string };

  function targetOf(value: string): Target {
    if (isIdentityHex(value)) {
      return { kind: 'person', identity: value };
    }
    if (isTeamVaultId(value)) {
      return { kind: 'team', vaultId: value };
    }
    throw new Error('Unknown share target');
  }

  // The note store a target's notes live in, for a share this device may
  // write to.
  async function writableStore(
    target: Target,
  ): Promise<{ store: NoteStore; label: string }> {
    if (target.kind === 'person') {
      const peer = requireActive(target.identity);
      return {
        store: (await vaultFor(target.identity)).store,
        label: peer.code,
      };
    }
    const team = await teamFor(memberEntry(target.vaultId));
    const { state } = requireView(team);
    const role = roleOf(state, myIdentityHex());
    if (role === null || role === 'reader') {
      throw new Error('Readers can’t change notes in this team');
    }
    requireKey(team);
    return { store: team.notes, label: teamNameOf(team) };
  }

  async function readableStore(target: Target): Promise<NoteStore> {
    if (target.kind === 'person') {
      requireActive(target.identity);
      return (await vaultFor(target.identity)).store;
    }
    return (await teamFor(teamOf(target.vaultId))).notes;
  }

  function requireNotInTeam(vaultId: string) {
    if (activeTeams().some((team) => team.vaultId === vaultId)) {
      throw new Error('You are already in that team, or asked to join it');
    }
  }

  async function openInvite(link: JoinLink): Promise<InviteFile> {
    const sealed = await requireRelays().fetchInvite(link);
    if (!sealed) {
      throw new Error('That invite is gone from the relay; ask for a new link');
    }
    const file =
      inviteFileIdOf(sealed) === link.fileId
        ? openInviteFile(sealed, link.key)
        : null;
    if (!file || file.vaultId !== link.vaultId || file.host !== link.host) {
      throw new Error('That invite could not be read');
    }
    return file;
  }

  return {
    // Takes the person's identity from their vault key once sync has it;
    // nothing about sharing exists before a recovery phrase does.
    // Says whether the identity's shares list opened: without it the
    // session knows none of its shares. Under the lock, so the identity never
    // changes under a call still running.
    load: (vault: { key: Uint8Array; deviceId: string } | null) =>
      withLock(async (): Promise<boolean> => {
        stopEngines();
        ended = false;
        if (!vault) {
          identity = null;
          deviceId = null;
          sharesStore = null;
          return false;
        }
        identity = identityOf(vault.key);
        deviceId = vault.deviceId;
        // Another vault's list must never serve this one, however its own
        // list fails to load.
        sharesStore = null;
        try {
          const store = createSharesStore({
            file: options.sharesFileFor(vaultIdOf(vault.key)),
            cipher: await requireCipher(),
          });
          await store.load();
          sharesStore = store;
          error = null;
        } catch (failure) {
          error = messageOf(failure);
        }
        await Promise.all([
          ...activePeers().map((peer) =>
            vaultFor(peer).catch((failure: unknown) => {
              error = messageOf(failure);
            }),
          ),
          ...(options.teamFilesFor
            ? activeTeams().map((team) =>
                teamFor(team).catch((failure: unknown) => {
                  error = messageOf(failure);
                }),
              )
            : []),
        ]);
        return sharesStore !== null;
      }),
    // The engine that carries the shares list through the person's own
    // vault, beside their meetings; it runs in that vault's round.
    sharesEngine: async (
      vault: { id: string; key: Uint8Array; deviceId: string },
      transport: Transport,
      placeName: string,
    ): Promise<SyncEngine | null> => {
      const store = sharesStore;
      if (!store || ended) {
        return null;
      }
      // A place from before sharing refuses the shares list's path; the
      // person is told what that means rather than shown a bare 400.
      const guarded: Transport = {
        ...transport,
        write: async (path, data) => {
          try {
            return await transport.write(path, data);
          } catch (failure) {
            throw failure instanceof RequestRefused && failure.status === 400
              ? new Error(oldRelayMessage)
              : failure;
          }
        },
      };
      return createDocumentSyncEngine({
        transport: guarded,
        vault: { deviceId: vault.deviceId },
        documents: sharesDocuments(vault),
        store,
        onRemote: () => onChange(),
        now,
        publishedLog: await options.publishedLogFor?.(
          `shares:${vault.id}:${vault.deviceId}:${placeName}`,
        ),
      });
    },
    // One round per shared vault, each through the same kind of place the
    // person's own vault uses. The vaults are independent, so their rounds
    // run side by side. A shared vault is never closed by a notice: it
    // carries no identity, so either person could stop the other for good.
    // Teams on a relay need no place of the person's own.
    round: async (place: SharedPlace | null) => {
      if (!identity || ended) {
        return;
      }
      await withLock(async () => {
        if (ended) {
          return;
        }
        const retired = place ? await retireStopped(place) : [];
        const rounds = await Promise.all([
          ...(place ? activePeers().map((peer) => peerRound(peer, place)) : []),
          ...(options.teamFilesFor
            ? activeTeams().map((team) =>
                teamRound(team).catch((failure: unknown) => [
                  messageOf(failure),
                ]),
              )
            : []),
        ]);
        error = [...retired, ...rounds.flat()][0] ?? null;
      });
      onChange();
    },
    snapshot: (): SharingSnapshot => {
      if (!identity) {
        return { status: 'none' };
      }
      const known = peersOf();
      const notes: SharedNoteSummary[] = [];
      for (const peer of known) {
        const entry = vaults.get(peer.identity);
        for (const note of entry?.store.notes() ?? []) {
          notes.push({
            id: note.id,
            title: note.title,
            sharedAt: note.sharedAt,
            target: peer.identity,
            kind: 'person',
            label: peer.code,
          });
        }
      }
      const teamInfos = activeTeams().map((entry) =>
        teamInfoOf(entry, teams.get(entry.vaultId)),
      );
      for (const info of teamInfos) {
        const team = teams.get(info.vaultId);
        for (const note of team?.notes.notes() ?? []) {
          notes.push({
            id: note.id,
            title: note.title,
            sharedAt: note.sharedAt,
            target: info.vaultId,
            kind: 'team',
            label: info.name,
          });
        }
      }
      notes.sort((a, b) => b.sharedAt - a.sharedAt);
      return {
        status: 'ready',
        code: identityCodeOf(identity.publicKey),
        peers: known,
        teams: teamInfos,
        notes,
        error,
      };
    },
    identityCard: (): string => identityCard(requireIdentity().identity),
    identityCode: (): string =>
      identityCodeOf(requireIdentity().identity.publicKey),
    // Whose card this is, so the user can compare the code with the person
    // before adding them.
    previewPeer: (card: string): { identity: string; code: string } => {
      const parsed = parseIdentityCard(card.trim());
      if (!parsed) {
        throw new Error('That is not an identity card');
      }
      if (identityHex(parsed.publicKey) === myIdentityHex()) {
        throw new Error('That is your own identity card');
      }
      return {
        identity: identityHex(parsed.publicKey),
        code: identityCodeOf(parsed.publicKey),
      };
    },
    addPeer: (card: string) =>
      withLock(async () => {
        const trimmed = card.trim();
        const parsed = parseIdentityCard(trimmed);
        if (!parsed) {
          throw new Error('That is not an identity card');
        }
        // Derived first: a card this device can't share with (its own, or a
        // crafted key) must never reach the list, where every device would
        // fail on it and nothing could remove it.
        oneToOneVault(requireIdentity().identity, parsed);
        await requireShares().addPeer(trimmed);
        await vaultFor(identityHex(parsed.publicKey));
        onChange();
      }),
    // Stopping removes this device's copies from the shared vault and stops
    // syncing it; the other person keeps what they already received.
    stopPeer: (peerIdentity: string, place: SharedPlace | null) =>
      withLock(async () => {
        const failed = await retire(peerIdentity, place);
        await requireShares().stopPeer(peerIdentity, now());
        error = failed;
        onChange();
      }),
    // This device stops taking part, because it moves to another vault or
    // stops syncing: its own copies come off the places where they can be
    // reached. The identity and its shares stay as they are, since the
    // person's other devices may go on with them.
    leaveDevice: (place: SharedPlace | null) =>
      withLock(async () => {
        if (!sharesStore || ended) {
          return;
        }
        const failures: string[] = [];
        for (const peer of activePeers()) {
          const failed = await retire(peer, place);
          if (failed) {
            failures.push(failed);
          }
        }
        for (const entry of activeTeams()) {
          try {
            const team = await teamFor(entry);
            const at = await teamPlaceFor(team).catch(() => null);
            await removeOwnFiles(team, at);
            team.engine?.stop();
            teams.delete(entry.vaultId);
          } catch (failure) {
            failures.push(
              `The copies this device put in a team stayed there: ${messageOf(failure)}`,
            );
          }
        }
        error = failures[0] ?? null;
        onChange();
      }),
    // The teams whose list can't be read right now, by name, since any of
    // them may be one this identity manages: a change of phrase hands those
    // over first, and can't while they are out of reach.
    unreachableTeams: (): Promise<string[]> =>
      withLock(async () => {
        const names: string[] = [];
        for (const entry of activeTeams()) {
          if (entry.request !== null) {
            continue;
          }
          const team = await teamFor(entry);
          // Every team, even one this device last saw it not manage: it may
          // have been made an admin since.
          try {
            await refreshList(team, await teamPlaceFor(team));
          } catch {
            names.push(teamNameOf(team));
          }
        }
        return names;
      }),
    // The identity itself ends, because its phrase is replaced: every
    // one-to-one share stops, each team it manages is handed to the
    // successor (an owner makes it the owner, an admin adds it as a writer),
    // and it asks to leave every other team. Each team handed over goes into
    // the successor's shares list on this device before the hand-over, so a
    // crash part way still leaves the new identity knowing where it belongs;
    // its first round there removes this identity. A team it may manage stays
    // in this identity's list until it is handed over, and is named in
    // `unfinished`, so running this again finishes it.
    endIdentity: (
      place: SharedPlace | null,
      successor: { card: string; vaultId: string },
    ) =>
      withLock(async (): Promise<EndedIdentity> => {
        if (!sharesStore) {
          throw new Error('This identity’s shares couldn’t be read');
        }
        try {
          const failures: string[] = [];
          const handed: HandedTeam[] = [];
          const unfinished: string[] = [];
          const predecessor = myIdentityHex();
          const successorShares = createSharesStore({
            file: options.sharesFileFor(successor.vaultId),
            cipher: await requireCipher(),
          });
          await successorShares.load();
          for (const peer of activePeers()) {
            const failed = await retire(peer, place);
            if (failed) {
              failures.push(failed);
            }
            try {
              await requireShares().stopPeer(peer, now());
            } catch (failure) {
              failures.push(messageOf(failure));
            }
          }
          for (const entry of activeTeams()) {
            let name = unnamedTeam;
            // Until the list says otherwise, a team may be one this identity
            // manages, so it isn't let go of.
            let finished = false;
            try {
              const team = await teamFor(entry);
              name = teamNameOf(team);
              const at = await teamPlaceFor(team);
              let handedOver = false;
              if (entry.request === null) {
                const me = requireIdentity().identity;
                // What this device last read may be from before a hand-over
                // a crash cut short.
                await refreshList(team, at);
                const manages =
                  team.view !== null &&
                  canManage(roleOf(team.view.state, predecessor));
                if (manages) {
                  await successorShares.addTeam(entry.vaultId, {
                    host: entry.host,
                    request: null,
                    invitedBy: null,
                    replaces: predecessor,
                  });
                  try {
                    const progress = await handOver(team, at, successor.card);
                    handedOver = progress.added;
                    finished = progress.complete;
                    if (progress.failure !== null) {
                      failures.push(
                        `${name} was handed to the new phrase only in part: ${progress.failure}`,
                      );
                    }
                  } catch (failure) {
                    failures.push(
                      `${name} wasn’t handed to the new phrase: ${messageOf(failure)}`,
                    );
                  }
                  if (!handedOver) {
                    await successorShares.leaveTeam(entry.vaultId, now());
                  }
                } else {
                  const progress = await handOver(team, at, successor.card);
                  handedOver = progress.added;
                  finished = true;
                  if (
                    !handedOver &&
                    !team.view?.state.members[predecessor]?.leaving
                  ) {
                    await appendRecord(team, at, (state) => ({
                      record: requestRemoveRecord(me, state, now()),
                    })).catch(() => undefined);
                  }
                }
              } else {
                finished = true;
              }
              if (handedOver) {
                handed.push({
                  link: teamLink({ vaultId: entry.vaultId, host: entry.host }),
                  replaces: predecessor,
                });
              } else if (finished) {
                await removeOwnFiles(team, at).catch((failure: unknown) => {
                  failures.push(
                    `The copies this device put in the team stayed there: ${messageOf(failure)}`,
                  );
                });
              }
              team.engine?.stop();
              teams.delete(entry.vaultId);
            } catch (failure) {
              failures.push(
                `${name} wasn’t handed to the new phrase: ${messageOf(failure)}`,
              );
            }
            if (!finished) {
              unfinished.push(name);
              continue;
            }
            await requireShares()
              .leaveTeam(entry.vaultId, now())
              .catch((failure: unknown) => {
                failures.push(messageOf(failure));
              });
          }
          error = failures[0] ?? null;
          return { handed, unfinished };
        } finally {
          stopEngines();
          ended = true;
          onChange();
        }
      }),
    shareMeeting: (
      meeting: Meeting,
      name: string,
      target: string,
    ): Promise<SharedNoteSummary> =>
      withLock(async () => {
        const home = targetOf(target);
        const { store, label } = await writableStore(home);
        const note = noteFromMeeting(meeting, name, newId(), now());
        await store.save(note);
        onChange();
        return {
          id: note.id,
          title: note.title,
          sharedAt: note.sharedAt,
          target,
          kind: home.kind,
          label,
        };
      }),
    // Under the lock, so a vault opened for it never outlives a load of
    // another identity in the cache.
    note: (target: string, id: string) =>
      withLock(async (): Promise<SharedNoteDetail> => {
        const home = targetOf(target);
        const store = await readableStore(home);
        const note = store.note(id);
        const version = store.version(id);
        if (!note || version === null) {
          throw new Error('That note is gone');
        }
        return { ...note, target, kind: home.kind, version };
      }),
    editNote: (target: string, id: string, summary: string, version: string) =>
      withLock(async () => {
        const { store } = await writableStore(targetOf(target));
        if (!store.note(id)) {
          throw new Error('That note is gone');
        }
        const saved = await store.saveFrom(id, version, (seen) =>
          editNoteSummary(seen, summary),
        );
        onChange();
        return saved;
      }),
    deleteNote: (target: string, id: string) =>
      withLock(async () => {
        const { store } = await writableStore(targetOf(target));
        await store.remove(id, now());
        onChange();
      }),

    // A new team on a relay, by its address. The root record names this
    // identity as owner and wraps the first key for it.
    createTeam: (team: string, myName: string, relay: string) =>
      withLock(async (): Promise<string> => {
        const me = requireIdentity();
        const host = relayBase(relay).href;
        const root = rootRecord(me.identity, now());
        const vaultId = teamVaultIdOf(root.record);
        const started = startAccessList(vaultId, root.record);
        if (!started.ok) {
          throw new Error(started.reason);
        }
        await requireShares().addTeam(vaultId, {
          host,
          request: null,
          invitedBy: null,
          replaces: null,
        });
        try {
          const entry = await teamFor(teamOf(vaultId));
          const at = await teamPlaceFor(entry);
          await at.list.append(root.record);
          await keepList(entry, [root.record], started.state);
          await entry.members.nameTeam(team);
          if (myName.trim() !== '') {
            await entry.members.nameMember(myIdentityHex(), myName);
          }
        } catch (failure) {
          teams.delete(vaultId);
          await requireShares().leaveTeam(vaultId, now());
          throw failure;
        }
        onChange();
        return vaultId;
      }),
    // What a link leads to, so the person can see the team and who invited
    // them before asking to join.
    previewJoin: async (text: string): Promise<JoinPreview> => {
      const link = parseJoinLink(text);
      if (!link) {
        throw new Error('That is not a team invite link');
      }
      const file = await openInvite(link);
      const inviter = parseIdentityCard(file.inviter);
      if (!inviter) {
        throw new Error('The invite names no inviter');
      }
      return {
        vaultId: link.vaultId,
        team: file.team,
        inviterCode: identityCodeOf(inviter.publicKey),
        role: file.role,
        approval: file.approval,
        host: file.host,
      };
    },
    // Asks to join, or joins at once when the invite needs no approval.
    join: (text: string, myName: string) =>
      withLock(async (): Promise<{ vaultId: string; pending: boolean }> => {
        const link = parseJoinLink(text);
        if (!link) {
          throw new Error('That is not a team invite link');
        }
        const me = requireIdentity();
        requireNotInTeam(link.vaultId);
        const file = await openInvite(link);
        const at = await requireRelays().open(
          file.host,
          link.vaultId,
          me.identity,
        );
        const name = myName.trim() === '' ? null : myName.trim();
        const invitedBy = {
          invite: file.invite,
          identity: identityHex(fromCard(file.inviter)),
        };
        if (file.approval) {
          const request = requestJoinRecord(me.identity, file, name, now());
          await at.list.append(request);
          await requireShares().addTeam(link.vaultId, {
            host: file.host,
            request: request.id,
            invitedBy,
            replaces: null,
          });
          onChange();
          return { vaultId: link.vaultId, pending: true };
        }
        const joined = inviteJoinRecord(me.identity, file, name, now());
        await at.list.append(joined.record);
        await requireShares().addTeam(link.vaultId, {
          host: file.host,
          request: null,
          invitedBy,
          replaces: null,
        });
        const entry = teamOf(link.vaultId);
        const team = await teamFor(entry);
        team.place = at;
        await refreshList(team, at).catch((failure: unknown) => {
          team.error = messageOf(failure);
        });
        if (team.view && !(await confirmInviter(entry, team))) {
          // The join is in the list already; asking to leave shows the team
          // this identity didn't mean to be there.
          await appendRecord(team, at, (state) => ({
            record: requestRemoveRecord(me.identity, state, now()),
          })).catch(() => undefined);
          throw new Error(team.error ?? 'The invite could not be confirmed');
        }
        onChange();
        return { vaultId: link.vaultId, pending: false };
      }),
    // An invite link: the record goes into the list, the file with the
    // invite's private keys onto the relay under a key only the link holds.
    inviteToTeam: (vaultId: string, role: GrantedRole, approval: boolean) =>
      withLock(async (): Promise<string> => {
        const invite = await managerRecord(vaultId, (me, state, key) =>
          inviteRecord(me, state, key, role, approval, now()),
        );
        const { record, team, at } = invite;
        if (record.body.type !== 'invite') {
          throw new Error('The invite could not be made');
        }
        const me = requireIdentity().identity;
        const file = signInviteFile(me, {
          team: teamNameOf(team),
          inviter: identityCard(me),
          vaultId,
          invite: record.id,
          signingKey: toHex(invite.signingKey),
          wrappingKey: toHex(invite.wrappingKey),
          role,
          approval,
          key:
            record.body.wrap === null
              ? null
              : { wrap: record.body.wrap, keyId: requireKey(team).keyId },
          host: team.host,
        });
        const sealed = sealInviteFile(file);
        try {
          await at.putInvite(sealed.fileId, sealed.sealed);
        } catch (failure) {
          // An invite nobody can take would otherwise stay live in the list.
          await appendRecord(team, at, (state, key) => {
            const live = state.invites[record.id];
            if (!live || live.revoked) {
              throw failure;
            }
            return inviteRevokeRecord(
              me,
              state,
              requireCurrent(team, key),
              live,
              now(),
            );
          }).catch(() => undefined);
          throw failure;
        }
        return joinLink({
          vaultId,
          fileId: sealed.fileId,
          key: sealed.key,
          host: team.host,
        });
      }),
    revokeInvite: (vaultId: string, inviteId: string) =>
      withLock(async () => {
        await managerRecord(vaultId, (me, state, key) => {
          const invite = state.invites[inviteId];
          if (!invite || invite.revoked) {
            throw new Error('No such live invite');
          }
          return inviteRevokeRecord(me, state, key, invite, now());
        });
      }),
    answerRequest: (
      vaultId: string,
      requestId: string,
      answer: { accept: true; role: GrantedRole } | { accept: false },
    ) =>
      withLock(async () => {
        const { team } = await managerRecord(vaultId, (me, state, key) => ({
          record: answer.accept
            ? requestAcceptRecord(me, state, key, requestId, answer.role, now())
            : requestDeclineRecord(me, state, requestId, now()),
        }));
        await adoptJoinNames(team);
      }),
    addTeamMembers: (
      vaultId: string,
      accounts: Array<{ card: string; role: GrantedRole; name: string }>,
    ) =>
      withLock(async () => {
        const added = accounts.map((account) => {
          const card = account.card.trim();
          const parsed = parseIdentityCard(card);
          if (!parsed) {
            throw new Error('That is not an identity card');
          }
          return { ...account, card, identity: identityHex(parsed.publicKey) };
        });
        const { team } = await managerRecord(vaultId, (me, state, key) => ({
          record: accountsAddRecord(
            me,
            state,
            key,
            added.map(({ card, role }) => ({ card, role })),
            now(),
          ),
        }));
        for (const account of added) {
          if (account.name.trim() !== '') {
            await team.members.nameMember(account.identity, account.name);
          }
        }
      }),
    setMemberRole: (vaultId: string, member: string, role: GrantedRole) =>
      withLock(async () => {
        await managerRecord(vaultId, (me, state, key) =>
          permissionChangesRecord(
            me,
            state,
            key,
            [{ identity: member, role }],
            now(),
          ),
        );
      }),
    // Removal rotates the key; what the removed person already received
    // stays with them, as the app says when asking.
    removeMembers: (vaultId: string, members: string[]) =>
      withLock(async () => {
        await managerRecord(vaultId, (me, state, key) =>
          accountsRemoveRecord(me, state, key, members, now()),
        );
      }),
    rotateTeamKey: (vaultId: string) =>
      withLock(async () => {
        await managerRecord(vaultId, (me, state, key) =>
          keyChangeRecord(me, state, key, now()),
        );
      }),
    transferTeam: (vaultId: string, owner: string, role: 'admin' | 'writer') =>
      withLock(async () => {
        await managerRecord(vaultId, (me, state) => ({
          record: ownerChangeRecord(me, state, owner, role, now()),
        }));
      }),
    // Leaving asks the owners and admins to remove this identity, and ends
    // the team here at once: this device's copies come off the place where
    // it can be reached. An owner hands the team over first, unless nobody
    // else is in it.
    leaveTeam: (vaultId: string) =>
      withLock(async () => {
        const entry = teamOf(vaultId);
        const team = await teamFor(entry);
        const at = await teamPlaceFor(team).catch(() => null);
        const failures: string[] = [];
        if (entry.request === null && at && team.view) {
          const me = requireIdentity().identity;
          const role = roleOf(team.view.state, myIdentityHex());
          if (
            role === 'owner' &&
            Object.keys(team.view.state.members).length > 1
          ) {
            throw new Error(
              'Hand the team to another member before leaving it',
            );
          }
          if (role !== null && role !== 'owner') {
            await appendRecord(team, at, (state) => ({
              record: requestRemoveRecord(me, state, now()),
            })).catch((failure: unknown) => {
              failures.push(messageOf(failure));
            });
          }
          await removeOwnFiles(team, at).catch((failure: unknown) => {
            failures.push(
              `The copies this device put in the team stayed there: ${messageOf(failure)}`,
            );
          });
        } else if (entry.request === null && !at) {
          failures.push(
            'The team’s place can’t be reached, so the copies this device put there stayed',
          );
        }
        team.engine?.stop();
        teams.delete(vaultId);
        await requireShares().leaveTeam(vaultId, now());
        error = failures[0] ?? null;
        onChange();
      }),
    // For a person an owner or admin added by card: the shares list learns
    // where the team is, and the next round reads its list.
    addKnownTeam: (text: string) =>
      withLock(async (): Promise<string> => {
        const link = parseTeamLink(text);
        if (!link) {
          throw new Error('That is not a team link');
        }
        requireIdentity();
        requireNotInTeam(link.vaultId);
        await requireShares().addTeam(link.vaultId, {
          host: link.host,
          request: null,
          invitedBy: null,
          replaces: null,
        });
        onChange();
        return link.vaultId;
      }),
    renameTeam: (vaultId: string, name: string) =>
      withLock(async () => {
        const team = await teamFor(teamOf(vaultId));
        requireManager(team);
        await team.members.nameTeam(name);
        onChange();
      }),
    nameTeamMember: (vaultId: string, member: string, name: string) =>
      withLock(async () => {
        const team = await teamFor(teamOf(vaultId));
        requireManager(team);
        await team.members.nameMember(member, name);
        onChange();
      }),
  };
}

function fromCard(card: string): Uint8Array {
  const parsed = parseIdentityCard(card);
  if (!parsed) {
    throw new Error('The invite names no inviter');
  }
  return parsed.publicKey;
}

function entryOf(team: Team): TeamEntry {
  return {
    host: team.host,
    request: team.request,
    invitedBy: team.invitedBy,
    replaces: team.replaces,
  };
}
