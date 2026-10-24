import * as Automerge from '@automerge/automerge';
import {
  identityCodeOf,
  identityHex,
  isIdentityHex,
  parseIdentityCard,
} from '../crypto/index.ts';
import { field, fixedActor, headsOf, mergeChanges } from '../meetings/index.ts';
import { relayBase } from '../sync/relay.ts';
import { isRecordId, isTeamVaultId } from './access-list.ts';

export const sharesSchema = 1;

type PeerFields = { card: string; stoppedAt: number | null };
// `request` is the id of this person's join request while it waits for an
// answer, so every device of theirs asks after it; null once a member.
type TeamFields = {
  host: string;
  leftAt: number | null;
  request?: string | null;
  invitedBy?: InvitedBy | null;
  replaces?: string | null;
};

// Whose invite this identity joined through, until the list shows that
// identity wrote it: a link can name anyone whose card is public.

type SharesFields = {
  schema: number;
  peers: Record<string, PeerFields>;
  teams: Record<string, TeamFields>;
};

export type SharesDocument = Automerge.Doc<SharesFields>;

export type Peer = {
  identity: string;
  code: string;
  card: string;
  stoppedAt: number | null;
};
export type InvitedBy = { invite: string; identity: string };

export type Team = {
  vaultId: string;
  host: string;
  leftAt: number | null;
  request: string | null;
  invitedBy: InvitedBy | null;
  // The identity this person had before a change of phrase, which the
  // new one removes from the team once it can.
  replaces: string | null;
};

export type TeamEntry = Omit<Team, 'vaultId' | 'leftAt'>;

// Whom a person shares with: the cards of the people they share notes with
// one to one, and the teams they are in. It follows them to every device the
// way meetings do. Each entry is one whole value under its key, so two
// devices adding shares at once keep both, and stopping one is a value every
// device adopts. A team's host is the relay it lives on.
export type Shares = { peers: Peer[]; teams: Team[] };

export const sharesId = 'shares';

// Every device starts from the same first change, so their lists share one
// history and merge, rather than each device's empty list competing with the
// others' entries. The clone writes as its own author from then on.
export function createSharesDocument(): SharesDocument {
  return Automerge.clone(
    Automerge.change(
      Automerge.init<SharesFields>({
        actor: fixedActor(`shares:${sharesSchema}`),
      }),
      { time: 0 },
      (fields) => {
        fields.schema = sharesSchema;
        fields.peers = {};
        fields.teams = {};
      },
    ),
  );
}

export function addPeer(
  document: SharesDocument,
  card: string,
): SharesDocument {
  const parsed = parseIdentityCard(card);
  if (!parsed) {
    throw new Error('Not an identity card');
  }
  const identity = identityHex(parsed.publicKey);
  return Automerge.change(document, (fields) => {
    fields.peers[identity] = { card, stoppedAt: null };
  });
}

export function stopPeer(
  document: SharesDocument,
  identity: string,
  stoppedAt: number,
): SharesDocument {
  return Automerge.change(document, (fields) => {
    const peer = fields.peers[identity];
    if (peer) {
      fields.peers[identity] = { card: peer.card, stoppedAt };
    }
  });
}

export function addTeam(
  document: SharesDocument,
  vaultId: string,
  entry: TeamEntry,
): SharesDocument {
  return Automerge.change(document, (fields) => {
    fields.teams[vaultId] = { ...entry, leftAt: null };
  });
}

export function leaveTeam(
  document: SharesDocument,
  vaultId: string,
  leftAt: number,
): SharesDocument {
  return Automerge.change(document, (fields) => {
    const team = fields.teams[vaultId];
    if (team) {
      fields.teams[vaultId] = {
        host: team.host,
        leftAt,
        request: null,
        invitedBy: null,
        replaces: null,
      };
    }
  });
}

function invitedByOf(raw: unknown): InvitedBy | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const invite = field(raw, 'invite');
  const identity = field(raw, 'identity');
  return isRecordId(invite) &&
    typeof identity === 'string' &&
    isIdentityHex(identity)
    ? { invite, identity }
    : null;
}

// A team's host is where every request of this identity goes, so one that
// isn't a relay address the app would accept anywhere else is left out.
function isRelayHost(host: string): boolean {
  try {
    return relayBase(host).href === host;
  } catch {
    return false;
  }
}

function timeOrNull(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

// A card that doesn't verify, or an entry of the wrong shape, is left out
// rather than trusted: the document comes from the person's other devices,
// but a damaged or planted file would reach here the same way.
export function readSharesDocument(document: SharesDocument): Shares | null {
  const raw: unknown = Automerge.toJS(document);
  if (
    typeof raw !== 'object' ||
    raw === null ||
    field(raw, 'schema') !== sharesSchema
  ) {
    return null;
  }
  const peers: Peer[] = [];
  const rawPeers = field(raw, 'peers');
  if (typeof rawPeers === 'object' && rawPeers !== null) {
    for (const [identity, value] of Object.entries(rawPeers)) {
      if (typeof value !== 'object' || value === null) {
        continue;
      }
      const card = field(value, 'card');
      const stoppedAt = timeOrNull(field(value, 'stoppedAt'));
      const parsed = typeof card === 'string' ? parseIdentityCard(card) : null;
      if (
        parsed &&
        typeof card === 'string' &&
        identityHex(parsed.publicKey) === identity &&
        stoppedAt !== undefined
      ) {
        peers.push({
          identity,
          code: identityCodeOf(parsed.publicKey),
          card,
          stoppedAt,
        });
      }
    }
  }
  const teams: Team[] = [];
  const rawTeams = field(raw, 'teams');
  if (typeof rawTeams === 'object' && rawTeams !== null) {
    for (const [vaultId, value] of Object.entries(rawTeams)) {
      if (typeof value !== 'object' || value === null) {
        continue;
      }
      const host = field(value, 'host');
      const leftAt = timeOrNull(field(value, 'leftAt'));
      const request = field(value, 'request');
      const invitedBy = invitedByOf(field(value, 'invitedBy'));
      const replaces = field(value, 'replaces');
      if (
        typeof host === 'string' &&
        isRelayHost(host) &&
        leftAt !== undefined &&
        isTeamVaultId(vaultId)
      ) {
        teams.push({
          vaultId,
          host,
          leftAt,
          request: isRecordId(request) ? request : null,
          invitedBy,
          replaces:
            typeof replaces === 'string' && isIdentityHex(replaces)
              ? replaces
              : null,
        });
      }
    }
  }
  return { peers, teams };
}

export function sharesHeads(document: SharesDocument): string {
  return headsOf(document);
}

export function mergeSharesDocuments(
  local: SharesDocument,
  remote: SharesDocument,
): SharesDocument {
  return mergeChanges(local, remote);
}

export function saveSharesDocument(document: SharesDocument): Uint8Array {
  return Automerge.save(document);
}

export function loadSharesDocument(
  bytes: Uint8Array,
): { document: SharesDocument; state: Shares } | null {
  try {
    const document = Automerge.load<SharesFields>(bytes);
    const state = readSharesDocument(document);
    return state ? { document, state } : null;
  } catch {
    return null;
  }
}
