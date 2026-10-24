import { bytesOf, textOf, type Identity } from '../crypto/index.ts';
import {
  createRelayRequester,
  readBody,
  relayTransportOver,
  type Fetch,
  type RelayResponse,
} from '../sync/relay.ts';
import { RequestRefused, type Transport } from '../sync/transport.ts';
import {
  parseAccessRecords,
  recordJson,
  type SignedAccessRecord,
} from './access-list.ts';
import { signRelayRequest } from '../crypto/relay-request.ts';
import type { JoinLink } from './invite.ts';

export type JoinStatus = 'pending' | 'accepted' | 'declined' | 'unknown';

// Where a team's access list is kept and appended to: the relay's `/acl`
// route.
export type AccessListPlace = {
  read: () => Promise<SignedAccessRecord[]>;
  // Refuses with `HeadMoved` when the list grew since the record was made.
  append: (record: SignedAccessRecord) => Promise<void>;
};

export class HeadMoved extends Error {}

// The relay refuses the list to an identity its team no longer lists.
export class NotAMember extends Error {}

// A team vault at one place: its files, its list, and what only a relay
// does (join requests by outsiders, invite files).
export type TeamPlace = {
  transport: Transport;
  list: AccessListPlace;
  status: (recordId: string) => Promise<JoinStatus>;
  putInvite: (fileId: string, sealed: Uint8Array) => Promise<void>;
};

const maxListBytes = 8 * 1024 * 1024;
const maxStatusBytes = 1024;
export const maxInviteFileBytes = 8 * 1024;
export const maxRecordBytes = 256 * 1024;

function listOf(data: Uint8Array): SignedAccessRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(textOf(data));
  } catch {
    throw new Error('The team’s list could not be read');
  }
  const records = parseAccessRecords(raw);
  if (!records) {
    throw new Error('The team’s list could not be read');
  }
  return records;
}

function statusOf(data: Uint8Array): JoinStatus {
  try {
    const raw: unknown = JSON.parse(textOf(data));
    const status =
      typeof raw === 'object' && raw !== null
        ? Reflect.get(raw, 'status')
        : null;
    return status === 'pending' ||
      status === 'accepted' ||
      status === 'declined'
      ? status
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

// A team vault on a relay: every request signed by this identity, the list
// at `/acl`, join outcomes at `/acl/<record>` and invite files at
// `/invites/<file>`.
export function createTeamRelay(options: {
  url: string;
  vaultId: string;
  identity: Identity;
  fetch: Fetch;
  now?: () => number;
}): TeamPlace {
  const now = options.now ?? (() => Date.now());
  const requester = createRelayRequester({
    url: options.url,
    vaultId: options.vaultId,
    fetch: options.fetch,
    now,
    authorization: {
      kind: 'identity',
      sign: (request) =>
        signRelayRequest(
          options.identity,
          {
            host: requester.base.host,
            method: request.method,
            path: request.path,
            vaultId: options.vaultId,
            body: request.body,
          },
          now(),
        ),
    },
  });
  const { vaultUrl, request } = requester;
  const aclUrl = `${vaultUrl}/acl`;
  let known: { version: string; records: SignedAccessRecord[] } | null = null;

  return {
    transport: relayTransportOver(requester),
    list: {
      read: async () => {
        let response: RelayResponse;
        try {
          response = await request(
            aclUrl,
            {
              method: 'GET',
              headers: known ? { 'if-none-match': known.version } : {},
            },
            known !== null,
          );
        } catch (failure) {
          throw failure instanceof RequestRefused && failure.status === 403
            ? new NotAMember('The team no longer lists this identity')
            : failure;
        }
        if (response.status === 304 && known) {
          return known.records;
        }
        if (response.status === 404) {
          throw new Error('The team isn’t on this relay');
        }
        const records = listOf(await readBody(response, maxListBytes));
        const version = response.headers.get('etag');
        known = version ? { version, records } : null;
        return records;
      },
      append: async (record) => {
        try {
          await request(aclUrl, {
            method: 'PUT',
            body: new Uint8Array(bytesOf(JSON.stringify(recordJson(record)))),
          });
        } catch (failure) {
          throw failure instanceof RequestRefused && failure.status === 409
            ? new HeadMoved('The team’s list changed; trying again')
            : failure;
        }
      },
    },
    status: async (recordId) => {
      const response = await request(
        `${aclUrl}/${encodeURIComponent(recordId)}`,
        { method: 'GET' },
      );
      return response.status === 404
        ? 'unknown'
        : statusOf(await readBody(response, maxStatusBytes));
    },
    putInvite: async (fileId, sealed) => {
      await request(`${vaultUrl}/invites/${encodeURIComponent(fileId)}`, {
        method: 'PUT',
        body: new Uint8Array(sealed),
      });
    },
  };
}

// Anyone with the link fetches the invite file: it opens only with the key
// the link carries, so the relay hands it out without a signature.
export async function fetchInviteFile(
  link: JoinLink,
  fetch: Fetch,
  now?: () => number,
): Promise<Uint8Array | null> {
  const { vaultUrl, request } = createRelayRequester({
    url: link.host,
    vaultId: link.vaultId,
    authorization: null,
    fetch,
    now,
  });
  const response = await request(
    `${vaultUrl}/invites/${encodeURIComponent(link.fileId)}`,
    { method: 'GET' },
  );
  return response.status === 404
    ? null
    : readBody(response, maxInviteFileBytes);
}
