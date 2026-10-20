import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { McpClientInfo, McpScope } from '../../shared/ipc.ts';

export type McpClient = Omit<McpClientInfo, 'revoking'> & { keyHash: string };

const keyPrefix = 'nod_mcp_';
const keyIdLength = 16;

function hashOf(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

// Only a hash of each key is kept. The hash signs the bridge's requests, so it
// is as good as the key itself; the keychain sealing of the settings file is
// what keeps it.
export function newClient(
  name: string,
  scopes: McpScope[],
  now: number,
): { client: McpClient; key: string } {
  const key = `${keyPrefix}${randomBytes(32).toString('base64url')}`;
  return {
    key,
    client: {
      id: randomUUID(),
      name,
      scopes,
      keyHash: hashOf(key),
      createdAt: now,
      lastUsedAt: null,
    },
  };
}

export function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function clientForKey(
  clients: readonly McpClient[],
  key: string,
): McpClient | null {
  const given = hashOf(key);
  return clients.find((client) => sameHex(client.keyHash, given)) ?? null;
}

// A program bridge never sends its key: it names the key by the start of the
// key's hash and signs each request with the whole hash over a one-time
// challenge from the server, and the server signs its reply the same way.
// Another user's program squatting on the port learns nothing it can use,
// can't replay a request, and can't pass off a reply as Nod's.
export function keyIdOf(key: string): string {
  return hashOf(key).slice(0, keyIdLength);
}

export function clientForKeyId(
  clients: readonly McpClient[],
  keyId: string,
): McpClient | null {
  return (
    clients.find((client) => client.keyHash.slice(0, keyIdLength) === keyId) ??
    null
  );
}

export function signature(
  keyHash: string,
  label: 'request' | 'response',
  challenge: string,
  body: string,
): string {
  return createHmac('sha256', Buffer.from(keyHash, 'hex'))
    .update(`nod-mcp-${label}\n${challenge}\n${hashOf(body)}`)
    .digest('hex');
}

export function signatureWithKey(
  key: string,
  label: 'request' | 'response',
  challenge: string,
  body: string,
): string {
  return signature(hashOf(key), label, challenge, body);
}
