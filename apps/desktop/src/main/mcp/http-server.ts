import { randomBytes } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { JsonRpcResponse } from '@nod/core/mcp';
import { sameHex, signature, type McpClient } from './auth.ts';

export const mcpPath = '/mcp';
export const challengePath = '/mcp/challenge';
const maxBodyBytes = 1024 * 1024;
const maxConnections = 16;
const requestTimeoutMs = 10_000;
const challengeTtlMs = 30_000;
const maxChallenges = 256;

type Handler = {
  port: number;
  byKey: (key: string) => McpClient | null;
  byKeyId: (keyId: string) => McpClient | null;
  handle: (
    client: McpClient,
    message: unknown,
  ) => JsonRpcResponse | JsonRpcResponse[] | null;
  now?: () => number;
};

function reply(
  response: ServerResponse,
  status: number,
  body = '',
  headers: Record<string, string> = {},
) {
  response.writeHead(status, {
    ...headers,
    ...(body === '' ? {} : { 'content-type': 'application/json' }),
  });
  response.end(body === '' ? undefined : body);
}

async function bodyOf(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size > maxBodyBytes) {
      return null;
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return typeof value === 'string' ? value : '';
}

// Listens on the loopback address only. The host and origin checks stop a web
// page from reaching it through a rebound domain name.
export function createMcpHttpServer(handler: Handler) {
  const now = handler.now ?? Date.now;
  const host = `127.0.0.1:${handler.port}`;
  const challenges = new Map<string, number>();
  const server = createServer((request, response) => {
    void serve(request, response).catch(() => {
      if (!response.headersSent) {
        reply(response, 500);
      }
    });
  });
  server.maxConnections = maxConnections;
  server.headersTimeout = requestTimeoutMs;
  server.requestTimeout = requestTimeoutMs;
  server.keepAliveTimeout = requestTimeoutMs / 2;

  function issueChallenge(): string {
    const at = now();
    for (const [value, expires] of challenges) {
      if (expires <= at || challenges.size >= maxChallenges) {
        challenges.delete(value);
      }
    }
    const challenge = randomBytes(24).toString('base64url');
    challenges.set(challenge, at + challengeTtlMs);
    return challenge;
  }

  function takeChallenge(challenge: string): boolean {
    const expires = challenges.get(challenge);
    challenges.delete(challenge);
    return expires !== undefined && expires > now();
  }

  function authenticate(
    request: IncomingMessage,
    body: string,
  ): { client: McpClient; challenge: string | null } | null {
    const bearer = /^bearer\s+(\S+)$/i.exec(header(request, 'authorization'));
    if (bearer?.[1]) {
      const client = handler.byKey(bearer[1]);
      return client ? { client, challenge: null } : null;
    }
    const challenge = header(request, 'x-nod-challenge');
    if (!challenge || !takeChallenge(challenge)) {
      return null;
    }
    const client = handler.byKeyId(header(request, 'x-nod-key-id'));
    return client &&
      sameHex(
        header(request, 'x-nod-signature'),
        signature(client.keyHash, 'request', challenge, body),
      )
      ? { client, challenge }
      : null;
  }

  async function serve(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.headers.host !== host || request.headers.origin) {
      reply(response, 403);
      return;
    }
    if (url.pathname !== mcpPath && url.pathname !== challengePath) {
      reply(response, 404);
      return;
    }
    if (request.method !== 'POST') {
      reply(response, 405, '', { allow: 'POST' });
      return;
    }
    if (url.pathname === challengePath) {
      reply(response, 200, JSON.stringify({ challenge: issueChallenge() }));
      return;
    }
    if (!header(request, 'content-type').includes('application/json')) {
      reply(response, 415);
      return;
    }
    const body = await bodyOf(request);
    if (body === null) {
      reply(response, 413);
      return;
    }
    const caller = authenticate(request, body);
    if (caller === null) {
      reply(response, 401, '', { 'www-authenticate': 'Bearer' });
      return;
    }
    const { client, challenge } = caller;
    const sign = (text: string): Record<string, string> =>
      challenge === null
        ? {}
        : {
            'x-nod-signature': signature(
              client.keyHash,
              'response',
              challenge,
              text,
            ),
          };
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      const text = JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      reply(response, 400, text, sign(text));
      return;
    }
    const answer = handler.handle(client, message);
    const text = answer === null ? '' : JSON.stringify(answer);
    reply(response, answer === null ? 202 : 200, text, sign(text));
  }

  return {
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(handler.port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    address: () => server.address(),
  };
}
