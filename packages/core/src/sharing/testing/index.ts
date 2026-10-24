import {
  bytesOf,
  fromHex,
  identityCard,
  identityHex,
  identityOf,
  sealSigned,
  toHex,
  type Identity,
} from '../../crypto/index.ts';
import { createMemoryTransport } from '../../sync/testing/index.ts';
import { RequestRefused } from '../../sync/transport.ts';
import { encodeAccessList, type SignedAccessRecord } from '../access-list.ts';
import {
  canManage,
  replayAccessList,
  roleOf,
  type AccessState,
} from '../access-list-validator.ts';
import { signInviteFile, type InviteFile, type JoinLink } from '../invite.ts';
import {
  authorizeTeamWrite,
  checkAppend,
  checkListRoom,
  joinStatusFor,
  mayRemoveTeamFile,
  teamFileDeviceOf,
} from '../relay/rules.ts';
import type { TeamRelays } from '../session.ts';
import { HeadMoved, NotAMember, type TeamPlace } from '../team-place.ts';
import type { CurrentKey } from '../team-records.ts';

export {
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
  type Rotated,
} from '../team-records.ts';

// The same people in every relay test: five fixed identities and their hex.
export function testIdentities() {
  const person = (seed: number) => identityOf(new Uint8Array(32).fill(seed));
  return {
    owner: person(1),
    admin: person(2),
    writer: person(3),
    reader: person(4),
    stranger: person(5),
    another: person(6),
    hex: (identity: Identity) => identityHex(identity.publicKey),
  };
}

export function sealedNote(
  key: CurrentKey,
  by: Identity,
  text = 'note',
): Uint8Array {
  return sealSigned(key.rootKey, fromHex(key.keyId), by, bytesOf(text), 'ctx');
}

export function inviteFileFor(options: {
  vaultId: string;
  invite: {
    record: SignedAccessRecord;
    signingKey: Uint8Array;
    wrappingKey: Uint8Array;
  };
  inviter: Identity;
  host: string;
  team?: string;
}): InviteFile {
  return signInviteFile(options.inviter, {
    team: options.team ?? 'Team',
    inviter: identityCard(options.inviter),
    vaultId: options.vaultId,
    invite: options.invite.record.id,
    signingKey: toHex(options.invite.signingKey),
    wrappingKey: toHex(options.invite.wrappingKey),
    role: 'writer',
    approval: true,
    key: null,
    host: options.host,
  });
}

type TeamRecord = { records: SignedAccessRecord[]; state: AccessState };

// A relay for team vaults in memory, applying the rules the real ones do:
// validating every record, answering join outcomes, keeping invite files,
// binding device folders to their first writer, and letting only members
// read and only writers write under the current key.
export function createMemoryTeamRelay(
  host = 'https://relay.test/',
  limits = {
    listBytes: 8 * 1024 * 1024,
    reserveBytes: 1024 * 1024,
    ownerReserveBytes: 512 * 1024,
  },
) {
  const teams = new Map<string, TeamRecord>();
  const invites = new Map<string, Map<string, Uint8Array>>();
  const bindings = new Map<string, Record<string, string>>();
  const transports = new Map<
    string,
    ReturnType<typeof createMemoryTransport>
  >();
  const refuse = (status: number, message: string) =>
    new RequestRefused(`The relay answered ${status}: ${message}`, status);

  function transportOf(vaultId: string) {
    const known = transports.get(vaultId) ?? createMemoryTransport();
    transports.set(vaultId, known);
    return known;
  }

  function bindingsOf(vaultId: string): Record<string, string> {
    const known = bindings.get(vaultId) ?? {};
    bindings.set(vaultId, known);
    return known;
  }

  function open(vaultId: string, identity: Identity): TeamPlace {
    const me = identityHex(identity.publicKey);
    const role = () => {
      const team = teams.get(vaultId);
      return team ? roleOf(team.state, me) : null;
    };
    const member = () => {
      const team = teams.get(vaultId);
      if (!team || roleOf(team.state, me) === null) {
        throw refuse(403, 'not a member');
      }
      return team;
    };
    const files = transportOf(vaultId);
    return {
      list: {
        read: async () => {
          const team = teams.get(vaultId);
          if (!team) {
            throw refuse(404, 'no such team');
          }
          if (role() === null) {
            throw new NotAMember('The team no longer lists this identity');
          }
          return team.records.map((record) => ({ ...record }));
        },
        append: async (record) => {
          const team = teams.get(vaultId) ?? null;
          const checked = checkAppend(team?.state ?? null, me, record, vaultId);
          if (!checked.ok) {
            throw checked.status === 409
              ? new HeadMoved('head moved')
              : refuse(checked.status, checked.reason);
          }
          const records = [...(team?.records ?? []), record];
          if (team) {
            const room = checkListRoom(
              team.state,
              me,
              record,
              encodeAccessList(records).length,
              limits,
            );
            if (!room.ok) {
              throw refuse(room.status, room.reason);
            }
          }
          teams.set(vaultId, { records, state: checked.state });
        },
      },
      status: async (recordId) => {
        const team = teams.get(vaultId);
        return (team && joinStatusFor(team.state, recordId, me)) ?? 'unknown';
      },
      putInvite: async (fileId, sealed) => {
        if (!canManage(role())) {
          throw refuse(403, 'only an owner or admin writes invites');
        }
        const stored = invites.get(vaultId) ?? new Map<string, Uint8Array>();
        stored.set(fileId, sealed);
        invites.set(vaultId, stored);
      },
      transport: {
        list: async (prefix) => {
          member();
          return files.list(prefix);
        },
        read: async (path, maxBytes) => {
          member();
          return files.read(path, maxBytes);
        },
        write: async (path, data) => {
          const team = member();
          const allowed = authorizeTeamWrite(team.state, me, path, data);
          if (!allowed.ok) {
            throw refuse(allowed.status, allowed.reason);
          }
          const device = teamFileDeviceOf(path);
          const bound = bindingsOf(vaultId);
          if (bound[device] !== undefined && bound[device] !== me) {
            throw refuse(403, 'another identity’s device folder');
          }
          bound[device] = me;
          return files.write(path, data);
        },
        remove: async (path) => {
          const team = member();
          if (!files.paths().includes(path)) {
            return;
          }
          const bound = bindingsOf(vaultId)[teamFileDeviceOf(path)] ?? null;
          if (!mayRemoveTeamFile(team.state, me, bound)) {
            throw refuse(403, 'another identity’s device folder');
          }
          return files.remove(path);
        },
      },
    };
  }

  const relays: TeamRelays = {
    open: async (atHost, vaultId, identity) => {
      if (atHost !== host) {
        throw new Error(`No relay at ${atHost}`);
      }
      return open(vaultId, identity);
    },
    fetchInvite: async (link: JoinLink) =>
      link.host === host
        ? (invites.get(link.vaultId)?.get(link.fileId) ?? null)
        : null,
  };

  return {
    host,
    relays,
    open,
    files: transportOf,
    records: (vaultId: string) => teams.get(vaultId)?.records ?? [],
    state: (vaultId: string) => {
      const records = teams.get(vaultId)?.records ?? [];
      const replayed = replayAccessList(vaultId, records);
      return replayed.ok ? replayed.state : null;
    },
  };
}
