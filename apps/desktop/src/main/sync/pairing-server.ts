import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { isLocalAddress, maxPairingHosts } from '@nod/core/sync';

// Who took the offer, or null once the listener closed without giving it.
export type PairingOutcome = { by: string } | null;

export type PairingListener = {
  port: number;
  hosts: string[];
  outcome: Promise<PairingOutcome>;
  close: () => void;
};

const maxWrongAttempts = 20;

// Home networks first: Docker and VPN bridges often take 172.16/12 and 10/8,
// and the code holds only the first few addresses.
function rank(address: string): number {
  if (address.startsWith('192.168.')) {
    return 0;
  }
  return address.startsWith('10.') ? 1 : 2;
}

export function localAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
    .filter(isLocalAddress)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, maxPairingHosts);
}

function sameProof(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function plainAddress(address: string | undefined): string {
  return (address ?? '').replace(/^::ffff:/, '');
}

// Serves the sealed offer on the local network, once, to whoever shows the
// proof from the QR code. Only requests to the addresses in the code count;
// anything else gets the same 404, so the port tells a scanner nothing, and
// too many wrong tries close it.
export async function listenForPairing(options: {
  offer: Uint8Array;
  proof: string;
  hosts: string[];
}): Promise<PairingListener> {
  let settle = (_outcome: PairingOutcome) => {};
  const outcome = new Promise<PairingOutcome>((resolve) => {
    settle = resolve;
  });
  let wrong = 0;
  let takenBy: string | null = null;
  const server = createServer((request, response) => {
    const authorization = request.headers.authorization ?? '';
    const proof = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const advertised = options.hosts.includes(
      plainAddress(request.socket.localAddress),
    );
    if (
      takenBy !== null ||
      !advertised ||
      request.method !== 'GET' ||
      request.url !== '/v1/pair' ||
      !sameProof(proof, options.proof)
    ) {
      response.writeHead(404, { 'cache-control': 'no-store' });
      response.end();
      if (advertised && takenBy === null) {
        wrong += 1;
        if (wrong >= maxWrongAttempts) {
          server.close();
          settle(null);
        }
      }
      return;
    }
    const by = plainAddress(request.socket.remoteAddress);
    takenBy = by;
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(options.offer.length),
      'cache-control': 'no-store',
    });
    response.end(Buffer.from(options.offer), () => {
      server.close();
      settle({ by });
    });
  });
  server.requestTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  const address: AddressInfo | string | null = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : 0,
    hosts: options.hosts,
    outcome,
    close: () => {
      server.close();
      server.closeAllConnections();
      // Once the offer started going out the phone may have it, even if the
      // window closed before the write finished.
      settle(takenBy === null ? null : { by: takenBy });
    },
  };
}
