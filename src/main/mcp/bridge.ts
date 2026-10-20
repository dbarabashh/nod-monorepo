import { request } from 'node:http';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { keyIdOf, sameHex, signatureWithKey } from './auth.ts';
import { challengePath, mcpPath } from './http-server.ts';

export type Exchange = (
  path: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ status: number; body: string; signature: string }>;

const unreachable =
  'Nod isn’t running, or its connection for AI assistants is turned off. Open Nod and turn it on in Settings → AI assistants.';
const refusedKey =
  'Nod, or a program using its port, refused this key. If Nod is open, connect the assistant again in Settings → AI assistants.';
const impostor =
  'Something other than Nod answered on its port, so its reply was dropped. Check which program uses that port.';
const exchangeTimeoutMs = 30_000;
const maxReplyChars = 2 * 1024 * 1024;

class ReplyTooLarge extends Error {}

type Id = string | number;

function idOf(message: unknown): Id | undefined {
  const id: unknown =
    typeof message === 'object' && message !== null
      ? Reflect.get(message, 'id')
      : undefined;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
}

// An error answers each request in the line: one per request in a batch,
// nothing for notifications, and one without an id for a line that isn't a
// request at all.
function errorReply(line: string, code: number, message: string): unknown {
  const error = (id: Id | null) => ({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return error(null);
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return error(null);
    }
    const replies = parsed.flatMap((item) => {
      if (typeof item !== 'object' || item === null) {
        return [error(null)];
      }
      const id = idOf(item);
      return id === undefined ? [] : [error(id)];
    });
    return replies.length > 0 ? replies : null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return error(null);
  }
  const id = idOf(parsed);
  return id === undefined ? null : error(id);
}

function challengeOf(body: string): string | null {
  try {
    const challenge: unknown = Reflect.get(
      Object(JSON.parse(body)),
      'challenge',
    );
    return typeof challenge === 'string' &&
      /^[A-Za-z0-9_-]{16,128}$/.test(challenge)
      ? challenge
      : null;
  } catch {
    return null;
  }
}

type Outcome =
  | { kind: 'reply'; body: string }
  | { kind: 'silent' }
  | { kind: 'error'; code: number; message: string };

const failed = (message: string, code = -32000): Outcome => ({
  kind: 'error',
  code,
  message,
});

async function relay(
  exchange: Exchange,
  key: string,
  line: string,
): Promise<Outcome> {
  try {
    const issued = await exchange(challengePath, '{}', {});
    const challenge = issued.status === 200 ? challengeOf(issued.body) : null;
    if (challenge === null) {
      return failed(impostor);
    }
    const response = await exchange(mcpPath, line, {
      'x-nod-key-id': keyIdOf(key),
      'x-nod-challenge': challenge,
      'x-nod-signature': signatureWithKey(key, 'request', challenge, line),
    });
    if (response.status === 401) {
      return failed(refusedKey, -32001);
    }
    if (
      !sameHex(
        response.signature,
        signatureWithKey(key, 'response', challenge, response.body),
      )
    ) {
      return response.status === 200 || response.status === 202
        ? failed(impostor)
        : failed(
            `Nod, or a program using its port, refused the request (HTTP ${response.status}).`,
            -32603,
          );
    }
    if (response.status === 202) {
      return { kind: 'silent' };
    }
    return { kind: 'reply', body: response.body.trim() };
  } catch (error) {
    return error instanceof ReplyTooLarge
      ? failed('The reply from Nod’s port was too large and was dropped.')
      : failed(unreachable);
  }
}

// One message at a time, so replies keep the order of the requests.
export async function runStdioBridge(options: {
  input: Readable;
  output: Writable;
  key: string;
  exchange: Exchange;
}): Promise<void> {
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    const outcome = await relay(options.exchange, options.key, line);
    if (outcome.kind === 'reply') {
      options.output.write(`${outcome.body}\n`);
    } else if (outcome.kind === 'error') {
      const reply = errorReply(line, outcome.code, outcome.message);
      if (reply !== null) {
        options.output.write(`${JSON.stringify(reply)}\n`);
      }
    }
  }
  await new Promise<void>((resolve) => options.output.end(resolve));
}

export function loopbackExchange(port: number): Exchange {
  return (path, body, headers) =>
    new Promise((resolve, reject) => {
      let tooLarge = false;
      const fail = (error: unknown) =>
        reject(tooLarge ? new ReplyTooLarge() : error);
      const outgoing = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: 'POST',
          timeout: exchangeTimeoutMs,
          headers: {
            ...headers,
            host: `127.0.0.1:${port}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
        },
        (incoming) => {
          let text = '';
          incoming.setEncoding('utf8');
          incoming.on('data', (chunk: string) => {
            text += chunk;
            if (text.length > maxReplyChars) {
              tooLarge = true;
              outgoing.destroy();
            }
          });
          incoming.on('end', () => {
            const signature = incoming.headers['x-nod-signature'];
            resolve({
              status: incoming.statusCode ?? 0,
              body: text,
              signature: typeof signature === 'string' ? signature : '',
            });
          });
          incoming.on('error', fail);
        },
      );
      outgoing.on('timeout', () =>
        outgoing.destroy(new Error('Nod didn’t answer in time')),
      );
      outgoing.on('error', fail);
      outgoing.on('close', () => {
        if (tooLarge) {
          fail(new ReplyTooLarge());
        }
      });
      outgoing.end(body);
    });
}
