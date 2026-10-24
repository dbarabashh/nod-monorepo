import * as Automerge from '@automerge/automerge';
import { isIdentityHex } from '../crypto/index.ts';
import { fixedActor, headsOf, mergeChanges } from '../meetings/index.ts';
import { field } from '../meetings/field.ts';
import { isTeamName, maxTeamNameLength } from './invite.ts';

export const membersSchema = 1;
export const maxMemberNameLength = 120;

type MembersFields = {
  schema: number;
  team: string;
  names: Record<string, string>;
};

export type MembersDocument = Automerge.Doc<MembersFields>;

// What a team calls itself and its members: display names only, written by
// owners and admins, sealed and published like a note. The relay sees
// identities in the list; names never leave the members' devices in the
// clear.
export type Members = { team: string; names: Record<string, string> };

export const membersId = 'members';

// Every device starts from the same first change, so the copies of all the
// admins share one history and merge.
export function createMembersDocument(vaultId: string): MembersDocument {
  return Automerge.clone(
    Automerge.change(
      Automerge.init<MembersFields>({
        actor: fixedActor(`members:${membersSchema}:${vaultId}`),
      }),
      { time: 0 },
      (fields) => {
        fields.schema = membersSchema;
        fields.team = '';
        fields.names = {};
      },
    ),
  );
}

export function nameTeam(
  document: MembersDocument,
  team: string,
): MembersDocument {
  const trimmed = team.trim().slice(0, maxTeamNameLength);
  return Automerge.change(document, (fields) => {
    fields.team = trimmed;
  });
}

export function nameMember(
  document: MembersDocument,
  identity: string,
  name: string,
): MembersDocument {
  const trimmed = name.trim().slice(0, maxMemberNameLength);
  return Automerge.change(document, (fields) => {
    if (trimmed === '') {
      delete fields.names[identity];
    } else {
      fields.names[identity] = trimmed;
    }
  });
}

export function readMembersDocument(document: MembersDocument): Members | null {
  const raw: unknown = Automerge.toJS(document);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    field(raw, 'schema') !== membersSchema
  ) {
    return null;
  }
  const team = field(raw, 'team');
  const names: Record<string, string> = {};
  const rawNames = field(raw, 'names');
  if (typeof rawNames === 'object' && rawNames !== null) {
    for (const [identity, name] of Object.entries(rawNames)) {
      if (
        isIdentityHex(identity) &&
        typeof name === 'string' &&
        name.length <= maxMemberNameLength
      ) {
        names[identity] = name;
      }
    }
  }
  return { team: isTeamName(team) ? team : '', names };
}

export function membersHeads(document: MembersDocument): string {
  return headsOf(document);
}

export function mergeMembersDocuments(
  local: MembersDocument,
  remote: MembersDocument,
): MembersDocument {
  return mergeChanges(local, remote);
}

export function saveMembersDocument(document: MembersDocument): Uint8Array {
  return Automerge.save(document);
}

export function loadMembersDocument(
  bytes: Uint8Array,
): { document: MembersDocument; state: Members } | null {
  try {
    const document = Automerge.load<MembersFields>(bytes);
    const state = readMembersDocument(document);
    return state ? { document, state } : null;
  } catch {
    return null;
  }
}
