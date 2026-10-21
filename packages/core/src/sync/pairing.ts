import { keyLength, open, seal } from '../crypto/aead.ts';
import {
  bytesOf,
  fromBase64,
  fromBase64Url,
  textOf,
  toBase64,
  toBase64Url,
} from '../crypto/encoding.ts';
import { pairingOfferKey, pairingProof } from '../crypto/pairing-keys.ts';
import { readBody, relayBase, type Fetch } from './relay.ts';

// What the QR code carries: a one-time secret and where the computer listens
// on the local network. Never the vault key, so a photo of the code is
// useless away from that network or once the computer stopped listening.
export type PairingCode = {
  secret: Uint8Array;
  port: number;
  hosts: string[];
};

// What the computer hands the phone over the local network, sealed with the
// secret: what the recovery phrase holds, plus the relay to find the vault on.
export type PairingOffer = {
  key: Uint8Array;
  relayUrl: string;
};

const prefix = 'nod-pair:v2:';
const maxCodeLength = 512;
export const maxPairingHosts = 4;
const encodedSecret = /^[A-Za-z0-9_-]{43}$/;
const offerContext = 'nod:pair-offer';

// Pairing needs the phone on the computer's own network, so only private and
// link-local IPv4 addresses are accepted: a code can't send the phone to the
// internet, or to anything outside the networks a home or office uses.
export function isLocalAddress(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return false;
  }
  const parts = match.slice(1).map(Number);
  const [a = -1, b = -1] = parts;
  if (parts.some((part) => part > 255) || host !== parts.join('.')) {
    return false;
  }
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

// A relay named by an address would be a device on some network; relays are
// reached by name. Loopback stays for the simulator, which shares the
// computer's.
function namedRelay(relay: URL): boolean {
  const literal =
    /^[\d.]+$/.test(relay.hostname) || relay.hostname.startsWith('[');
  return !literal || relay.hostname === '127.0.0.1';
}

export function assertPairingRelay(relayUrl: string): string {
  const relay = relayBase(relayUrl);
  if (!namedRelay(relay)) {
    throw new Error(
      'A phone pairs only through a relay with a host name, not an IP address',
    );
  }
  return relay.href;
}

export function pairingCode(code: PairingCode): string {
  if (code.secret.length !== keyLength) {
    throw new Error('A pairing secret must be 32 bytes');
  }
  if (!Number.isInteger(code.port) || code.port < 1 || code.port > 65_535) {
    throw new Error('Pairing needs a port to listen on');
  }
  const hosts = code.hosts.filter(isLocalAddress).slice(0, maxPairingHosts);
  if (hosts.length === 0) {
    throw new Error(
      'This computer isn’t on a local network, so a phone can’t pair with it',
    );
  }
  return `${prefix}${toBase64Url(code.secret)}:${code.port}:${hosts.join(',')}`;
}

// A scanned code is untrusted: anything a camera sees can be a QR code.
export function readPairingCode(text: string): PairingCode {
  const invalid = () => new Error('That isn’t a Nod pairing code');
  if (text.length > maxCodeLength || !text.startsWith(prefix)) {
    throw invalid();
  }
  const [encoded = '', port = '', list = '', ...extra] = text
    .slice(prefix.length)
    .split(':');
  if (extra.length > 0 || !encodedSecret.test(encoded)) {
    throw invalid();
  }
  const secret = fromBase64Url(encoded);
  if (secret.length !== keyLength || toBase64Url(secret) !== encoded) {
    throw invalid();
  }
  const portNumber = Number(port);
  if (
    !/^\d{1,5}$/.test(port) ||
    portNumber < 1 ||
    portNumber > 65_535 ||
    String(portNumber) !== port
  ) {
    throw invalid();
  }
  const hosts = list.split(',');
  if (hosts.length > maxPairingHosts || !hosts.every(isLocalAddress)) {
    throw invalid();
  }
  return { secret, port: portNumber, hosts };
}

export function sealPairingOffer(
  secret: Uint8Array,
  offer: PairingOffer,
): Uint8Array {
  if (offer.key.length !== keyLength) {
    throw new Error('Only a vault key can be paired');
  }
  return seal(
    pairingOfferKey(secret),
    bytesOf(
      JSON.stringify({
        key: toBase64(offer.key),
        relayUrl: assertPairingRelay(offer.relayUrl),
      }),
    ),
    offerContext,
  );
}

// Opens only with the secret from the code, so whatever else answers on the
// local network can't hand the phone a vault of its own.
export function openPairingOffer(
  secret: Uint8Array,
  sealed: Uint8Array,
): PairingOffer {
  const invalid = () =>
    new Error('The computer’s answer couldn’t be read. Scan the code again.');
  let raw: unknown;
  try {
    raw = JSON.parse(
      textOf(open(pairingOfferKey(secret), sealed, offerContext)),
    );
  } catch {
    throw invalid();
  }
  if (typeof raw !== 'object' || raw === null) {
    throw invalid();
  }
  const key = Reflect.get(raw, 'key');
  const relayUrl = Reflect.get(raw, 'relayUrl');
  if (typeof key !== 'string' || typeof relayUrl !== 'string') {
    throw invalid();
  }
  const bytes = fromBase64(key);
  if (bytes.length !== keyLength) {
    throw invalid();
  }
  return { key: bytes, relayUrl: assertPairingRelay(relayUrl) };
}

const maxOfferBytes = 4 * 1024;

// The phone asks the computer on the local network, at each address the code
// names, for the sealed offer. Reaching it at all is what proves the phone
// is on the computer's network.
export async function requestPairingOffer(
  code: PairingCode,
  fetch: Fetch,
): Promise<PairingOffer> {
  let refused = 0;
  let unreadable: Error | null = null;
  for (const host of code.hosts) {
    let sealed: Uint8Array;
    try {
      const response = await fetch(`http://${host}:${code.port}/v1/pair`, {
        method: 'GET',
        headers: { authorization: `Bearer ${pairingProof(code.secret)}` },
        redirect: 'error',
      });
      if (response.status === 404) {
        refused += 1;
        continue;
      }
      if (!response.ok) {
        continue;
      }
      sealed = await readBody(response, maxOfferBytes);
    } catch {
      continue;
    }
    // Something else may answer at one of the addresses; the computer is the
    // one whose answer opens with the secret.
    try {
      return openPairingOffer(code.secret, sealed);
    } catch (error) {
      unreadable = error instanceof Error ? error : unreadable;
    }
  }
  // Only when every address answered that way: something else on one of
  // them may answer 404 while the computer is just out of reach, and this
  // message tells the user to change their phrase.
  if (refused === code.hosts.length) {
    throw new Error(
      'That code was already used, or its window on the computer is closed. Show a new code and scan it again. If no phone of yours took it, change your recovery phrase on the computer.',
    );
  }
  throw (
    unreadable ??
    new Error(
      'Couldn’t reach your computer. Put this phone on the same Wi‑Fi as the computer, keep the code open there, and scan it again. If the phone just asked about the local network, allow it first.',
    )
  );
}
