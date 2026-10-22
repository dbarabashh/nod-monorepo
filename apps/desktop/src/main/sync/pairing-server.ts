import { timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
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
// How long an ask is held while the user is still deciding, under the
// phone's own timeout for one request.
const defaultHoldMs = 3_000;

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

function decidedWithin(
  decision: Promise<boolean>,
  ms: number,
): Promise<boolean | null> {
  return Promise.race([
    decision,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms).unref();
    }),
  ]);
}

function answer(response: ServerResponse, status: number, body?: Uint8Array) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    ...(body
      ? {
          'content-type': 'application/octet-stream',
          'content-length': String(body.length),
        }
      : {}),
  });
  if (body) {
    response.end(Buffer.from(body));
  } else {
    response.end();
  }
}

// Serves the sealed offer on the local network, once, to whoever shows the
// proof from the QR code for the address it was sent to. Only requests to
// the addresses in the code count; anything else gets the same 404, so the
// port tells a scanner nothing, and too many wrong tries close it. The first
// holder of the proof is put to the user, and gets 202 (naming the address
// it asks from, for its screen) while they decide: the offer goes out only
// once they allow it, and nobody else gets it. A question that fails counts
// as not allowed.
export async function listenForPairing(options: {
  offer: Uint8Array;
  proofFor: (host: string, port: number) => string;
  hosts: string[];
  confirm: (by: string) => Promise<boolean>;
  holdMs?: number;
}): Promise<PairingListener> {
  const holdMs = options.holdMs ?? defaultHoldMs;
  let settle = (_outcome: PairingOutcome) => {};
  const outcome = new Promise<PairingOutcome>((resolve) => {
    settle = resolve;
  });
  let wrong = 0;
  let port = 0;
  let asking: { by: string; decision: Promise<boolean> } | null = null;
  let takenBy: string | null = null;
  let closed = false;

  function finish(result: PairingOutcome) {
    closed = true;
    server.close();
    settle(result);
  }

  async function serve(request: IncomingMessage, response: ServerResponse) {
    const authorization = request.headers.authorization ?? '';
    const proof = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const host = plainAddress(request.socket.localAddress);
    const by = plainAddress(request.socket.remoteAddress);
    const advertised = options.hosts.includes(host);
    const open = !closed && takenBy === null;
    if (
      !open ||
      !advertised ||
      request.method !== 'GET' ||
      request.url !== '/v1/pair' ||
      !sameProof(proof, options.proofFor(host, port)) ||
      (asking !== null && asking.by !== by)
    ) {
      answer(response, 404);
      if (advertised && open && asking === null) {
        wrong += 1;
        if (wrong >= maxWrongAttempts) {
          finish(null);
        }
      }
      return;
    }
    asking ??= {
      by,
      decision: Promise.resolve()
        .then(() => options.confirm(by))
        .catch(() => false),
    };
    const allowed = await decidedWithin(asking.decision, holdMs);
    if (closed || takenBy !== null) {
      answer(response, 404);
      return;
    }
    if (allowed === null) {
      answer(response, 202, Buffer.from(by));
      return;
    }
    if (!allowed) {
      answer(response, 403);
      finish(null);
      return;
    }
    // A phone that gave up waiting asks again; the offer is kept for that
    // rather than given to a connection nobody reads.
    if (request.destroyed || request.socket.destroyed) {
      return;
    }
    takenBy = by;
    answer(response, 200, options.offer);
    response.once('finish', () => finish({ by }));
  }

  const server = createServer((request, response) => {
    serve(request, response).catch(() => {
      if (!response.headersSent) {
        answer(response, 404);
      } else {
        response.end();
      }
    });
  });
  server.requestTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  const address: AddressInfo | string | null = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    hosts: options.hosts,
    outcome,
    close: () => {
      closed = true;
      server.close();
      server.closeAllConnections();
      // Once the offer started going out the phone may have it, even if the
      // window closed before the write finished.
      settle(takenBy === null ? null : { by: takenBy });
    },
  };
}
