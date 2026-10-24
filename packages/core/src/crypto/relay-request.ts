import { randomBytes } from '@noble/ciphers/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesOf, fromBase64Url, toBase64Url } from './encoding.ts';
import type { Identity } from './identity.ts';
import { publicKeyLength, sign, signatureLength, verify } from './signing.ts';

export const relayRequestScheme = 'Nod-Identity';
// A request older or newer than this is refused, so a captured one can't be
// replayed once the window has passed; within it the relay remembers nonces.
export const relayRequestWindowMs = 5 * 60_000;
const nonceLength = 16;

export type RelayRequestParts = {
  host: string;
  method: string;
  path: string;
  vaultId: string;
  body: Uint8Array | null;
};

export type VerifiedRelayRequest = {
  identity: Uint8Array;
  time: number;
  nonce: string;
};

function fields(
  request: RelayRequestParts,
  time: number,
  nonce: Uint8Array,
): Uint8Array[] {
  return [
    bytesOf(request.host),
    bytesOf(request.method.toUpperCase()),
    bytesOf(request.path),
    bytesOf(request.vaultId),
    sha256(request.body ?? new Uint8Array()),
    bytesOf(String(time)),
    nonce,
  ];
}

// A team vault has no token: every request to it is signed by the identity
// making it, over everything that names the request, so a relay can check
// the identity's role in the list and nothing can be replayed elsewhere.
export function signRelayRequest(
  identity: Identity,
  request: RelayRequestParts,
  time: number,
): string {
  const nonce = randomBytes(nonceLength);
  const signature = sign(
    identity.signingKey,
    'nod:sig:relay:v1',
    fields(request, time, nonce),
  );
  return [
    relayRequestScheme,
    toBase64Url(identity.publicKey),
    String(time),
    toBase64Url(nonce),
    toBase64Url(signature),
  ].join(' ');
}

// Only the one spelling of a value is accepted: base64url leaves unused bits
// in its last character, so a lenient decoder would read sixteen different
// texts as the same nonce, and a relay that remembers the text would take a
// replay as new.
function decode(text: string, length: number): Uint8Array | null {
  try {
    const bytes = fromBase64Url(text);
    return bytes.length === length && toBase64Url(bytes) === text
      ? bytes
      : null;
  } catch {
    return null;
  }
}

// Who signed the request, or null when the header is not a valid signature
// by the identity it names over this request within the window.
export function verifyRelayRequest(
  header: string,
  request: RelayRequestParts,
  now: number,
): VerifiedRelayRequest | null {
  const parts = header.split(' ');
  if (parts.length !== 5 || parts[0] !== relayRequestScheme) {
    return null;
  }
  const [
    ,
    identityText = '',
    timeText = '',
    nonceText = '',
    signatureText = '',
  ] = parts;
  const identity = decode(identityText, publicKeyLength);
  const nonce = decode(nonceText, nonceLength);
  const signature = decode(signatureText, signatureLength);
  const time = /^(0|[1-9]\d{0,15})$/.test(timeText)
    ? Number(timeText)
    : Number.NaN;
  if (
    !identity ||
    !nonce ||
    !signature ||
    !Number.isSafeInteger(time) ||
    Math.abs(now - time) > relayRequestWindowMs
  ) {
    return null;
  }
  return verify(
    identity,
    signature,
    'nod:sig:relay:v1',
    fields(request, time, nonce),
  )
    ? { identity, time, nonce: nonceText }
    : null;
}
