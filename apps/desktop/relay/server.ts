import { createHash, timingSafeEqual } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import path from 'node:path';

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
// What @nod/core reads at most; a larger file would be refused by every
// other device.
const fileMaxBytes = 16 * 1024 * 1024;

type Reply = {
  status: number;
  body?: Buffer | string;
  type?: string;
  etag?: string;
};

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function safeParts(relative: string): string[] | null {
  const parts = relative.split('/');
  return parts.every(
    (part) =>
      /^[A-Za-z0-9_.-]{1,128}$/.test(part) && part !== '.' && part !== '..',
  )
    ? parts
    : null;
}

function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function bodyOf(
  request: IncomingMessage,
  limit: number,
): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size > limit) {
      return null;
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

// Stores encrypted files for vaults and nothing else: it can't read them,
// never merges them, and only lets a vault's own devices touch its files.
export function createRelay(dataDirectory: string): Server {
  const vaultDir = (vault: string) => path.join(dataDirectory, vault);
  const filesDir = (vault: string) => path.join(vaultDir(vault), 'files');

  async function authorized(
    vault: string,
    request: IncomingMessage,
  ): Promise<boolean> {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    try {
      const stored = Buffer.from(
        await readFile(path.join(vaultDir(vault), 'token'), 'utf8'),
      );
      const given = Buffer.from(hashOf(token));
      return (
        token !== '' &&
        stored.length === given.length &&
        timingSafeEqual(stored, given)
      );
    } catch {
      return false;
    }
  }

  async function exists(vault: string): Promise<boolean> {
    try {
      await stat(path.join(vaultDir(vault), 'token'));
      return true;
    } catch {
      return false;
    }
  }

  async function list(vault: string, prefix: string): Promise<Reply> {
    const files: Array<{ path: string; version: string; changedAt: number }> =
      [];
    const walk = async (relative: string) => {
      let entries;
      try {
        entries = await readdir(
          path.join(filesDir(vault), ...relative.split('/').filter(Boolean)),
          {
            withFileTypes: true,
          },
        );
      } catch (error) {
        if (isMissing(error)) {
          return;
        }
        throw error;
      }
      for (const entry of entries) {
        const child = `${relative}${entry.name}`;
        if (entry.isDirectory()) {
          await walk(`${child}/`);
        } else if (entry.isFile() && !entry.name.includes('.tmp-')) {
          const info = await stat(
            path.join(filesDir(vault), ...child.split('/')),
          );
          files.push({
            path: child,
            version: `${info.mtimeMs}-${info.size}`,
            changedAt: info.mtimeMs,
          });
        }
      }
    };
    await walk(prefix);
    return {
      status: 200,
      body: JSON.stringify(files),
      type: 'application/json',
    };
  }

  async function handle(request: IncomingMessage): Promise<Reply> {
    const url = new URL(request.url ?? '/', 'http://relay');
    const match = /^\/v1\/vaults\/([^/]+)(\/files(?:\/(.*))?)?$/.exec(
      url.pathname,
    );
    const vault = match?.[1] ?? '';
    if (!match || !idPattern.test(vault)) {
      return { status: 404 };
    }
    if (!match[2]) {
      if (request.method !== 'PUT') {
        return { status: 405 };
      }
      if (await exists(vault)) {
        return { status: (await authorized(vault, request)) ? 204 : 403 };
      }
      const header = request.headers.authorization ?? '';
      if (!header.startsWith('Bearer ') || header.length < 40) {
        return { status: 400 };
      }
      // A vault is named after a hash of its token, so only the holder of the
      // key can register it and nobody can claim a vault id they have seen.
      if (hashOf(header.slice(7)).slice(0, 32) !== vault) {
        return { status: 403 };
      }
      await mkdir(vaultDir(vault), { recursive: true });
      await writeFile(
        path.join(vaultDir(vault), 'token'),
        hashOf(header.slice(7)),
      );
      return { status: 201 };
    }
    if (!(await exists(vault))) {
      return { status: 404 };
    }
    const relative = match[3] ?? '';
    const listing = request.method === 'GET' && relative === '';
    const target = listing ? (url.searchParams.get('prefix') ?? '') : relative;
    if (!(await authorized(vault, request))) {
      return { status: 401 };
    }
    if (listing) {
      if (target !== '' && !safeParts(target.replace(/\/$/, ''))) {
        return { status: 400 };
      }
      return list(vault, target);
    }
    const parts = safeParts(relative);
    if (!parts) {
      return { status: 400 };
    }
    const file = path.join(filesDir(vault), ...parts);
    if (request.method === 'GET') {
      return readReply(file);
    }
    if (request.method === 'PUT') {
      const body = await bodyOf(request, fileMaxBytes);
      if (!body) {
        return { status: 413 };
      }
      await store(file, body);
      const info = await stat(file);
      return { status: 204, etag: `${info.mtimeMs}-${info.size}` };
    }
    if (request.method === 'DELETE') {
      await rm(file, { force: true });
      return { status: 204 };
    }
    return { status: 405 };
  }

  async function readReply(file: string): Promise<Reply> {
    try {
      return {
        status: 200,
        body: await readFile(file),
        type: 'application/octet-stream',
      };
    } catch (error) {
      if (isMissing(error)) {
        return { status: 404 };
      }
      throw error;
    }
  }

  async function store(file: string, body: Buffer) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random()}`;
    await writeFile(temporary, body);
    await rename(temporary, file);
  }

  return createServer((request, response) => {
    handle(request).then(
      (reply) => {
        // A phone's HTTP cache would otherwise keep listings on its disk.
        response.writeHead(reply.status, {
          'cache-control': 'no-store',
          ...(reply.type ? { 'content-type': reply.type } : {}),
          ...(reply.etag ? { etag: reply.etag } : {}),
        });
        response.end(reply.body);
      },
      () => {
        response.writeHead(500, { 'cache-control': 'no-store' });
        response.end();
      },
    );
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787);
  const directory =
    process.env.RELAY_DATA ?? path.join(process.cwd(), 'relay-data');
  createRelay(directory).listen(port, () => {
    console.log(`Relay listening on ${port}, storing in ${directory}`);
  });
}
