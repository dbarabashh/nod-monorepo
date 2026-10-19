import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { relayToken, vaultIdOf } from '../../src/core/crypto/index.ts';
import { createRelayTransport } from '../../src/main/sync/relay-transport.ts';
import {
  Conflict,
  createRelayHandler,
  defaultLimits,
  networkOf,
  type Limits,
  type Storage,
} from './relay.ts';

function memoryStorage(
  fail: (pathname: string) => Error | null = () => null,
  gate: (pathname: string) => Promise<void> = async () => {},
) {
  const failAfter = (pathname: string) => fail(`stored:${pathname}`);
  const objects = new Map<string, { data: Uint8Array; version: string }>();
  const removed: string[] = [];
  let counter = 0;
  const storage: Storage = {
    read: async (pathname) => objects.get(pathname) ?? null,
    readChanged: async (pathname, version) => {
      const found = objects.get(pathname);
      return found?.version === version ? 'unchanged' : (found ?? null);
    },
    stat: async (pathname) => {
      const found = objects.get(pathname);
      return found ? { version: found.version, size: found.data.length } : null;
    },
    write: async (pathname, data, ifMatch) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await gate(pathname);
      const failure = fail(pathname);
      if (failure) {
        throw failure;
      }
      const current = objects.get(pathname);
      if (
        (ifMatch === null && current) ||
        (typeof ifMatch === 'string' && current?.version !== ifMatch)
      ) {
        throw new Conflict();
      }
      counter += 1;
      const version = `v${counter}`;
      objects.set(pathname, { data, version });
      const late = failAfter(pathname);
      if (late) {
        throw late;
      }
      return version;
    },
    remove: async (pathname) => {
      const failure = fail(`remove:${pathname}`);
      if (failure) {
        throw failure;
      }
      removed.push(pathname);
      objects.delete(pathname);
    },
  };
  return { storage, objects, removed };
}

const start = Date.UTC(2026, 0, 1);

describe('vercel relay', () => {
  const key = randomBytes(32);
  const token = relayToken(key);
  const vault = vaultIdOf(key);
  const base = `https://sync.example.com/v1/vaults/${vault}`;
  const meeting = 'devices/laptop/meetings/m1.bin';

  function setUp(
    limits: Limits = defaultLimits,
    fail?: (pathname: string) => Error | null,
    gate?: (pathname: string) => Promise<void>,
  ) {
    const { storage, objects, removed } = memoryStorage(fail, gate);
    let clock = start;
    const handle = createRelayHandler({
      storage,
      now: () => clock,
      addressKey: 'test-key',
      limits,
    });
    const send = (
      path: string,
      init: RequestInit & { auth?: string | null } = {},
    ) => {
      const auth = init.auth === undefined ? token : init.auth;
      return handle(
        new Request(`${base}${path}`, {
          ...init,
          headers: auth ? { authorization: `Bearer ${auth}` } : {},
        }),
      );
    };
    return {
      handle,
      send,
      objects,
      removed,
      tick: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('lets in only a token that hashes to the vault id', async () => {
    const { send, handle } = setUp();
    assert.equal((await send('', { method: 'PUT' })).status, 204);
    assert.equal((await send('', { method: 'PUT', auth: null })).status, 401);
    assert.equal(
      (await send('/files', { auth: relayToken(randomBytes(32)) })).status,
      403,
    );
    assert.equal((await send('/files', { auth: 'not-a-token' })).status, 403);
    const other = await handle(
      new Request('https://sync.example.com/v1/vaults/not-a-vault/files', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    assert.equal(other.status, 404);
    assert.equal(
      createHash('sha256').update(token).digest('hex').slice(0, 32),
      vault,
    );
  });

  it('stores, lists, reads and removes a device’s files', async () => {
    const { send } = setUp();
    assert.deepEqual(await (await send('/files?prefix=devices/')).json(), []);

    const put = await send(`/files/${meeting}`, {
      method: 'PUT',
      body: 'sealed',
    });
    assert.equal(put.status, 204);

    const listed = await (await send('/files?prefix=devices/')).json();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].path, meeting);
    const read = await send(`/files/${meeting}`);
    assert.equal(await read.text(), 'sealed');
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal(read.headers.get('access-control-allow-origin'), null);

    assert.equal(
      (await send(`/files/${meeting}`, { method: 'DELETE' })).status,
      204,
    );
    assert.deepEqual(await (await send('/files?prefix=devices/')).json(), []);
    assert.equal((await send(`/files/${meeting}`)).status, 404);
  });

  it('keeps every file when devices write at the same moment', async () => {
    const { send } = setUp();
    const paths = ['a', 'b', 'c', 'd', 'e', 'f'].map(
      (device) => `devices/${device}/meetings/m1.bin`,
    );

    const results = await Promise.all(
      paths.map((path) => send(`/files/${path}`, { method: 'PUT', body: 'x' })),
    );

    assert.deepEqual(
      results.map((result) => result.status),
      paths.map(() => 204),
    );
    const listed: unknown = await (await send('/files?prefix=devices/')).json();
    assert.deepEqual(
      (Array.isArray(listed) ? listed : [])
        .map((file) => String(Reflect.get(Object(file), 'path')))
        .sort(),
      paths,
    );
  });

  it('accepts only meeting files, never other paths', async () => {
    const { send } = setUp();
    for (const path of [
      'pairing/r1/request.json',
      'devices/laptop/meetings/../../index.json',
      'devices/laptop/meetings/m1.txt',
      'index.json',
    ]) {
      assert.equal(
        (await send(`/files/${path}`, { method: 'PUT', body: 'x' })).status,
        400,
        path,
      );
    }
    assert.equal((await send('/files?prefix=../')).status, 400);
  });

  it('refuses writes past the vault’s limits', async () => {
    const { send, tick } = setUp({
      fileBytes: 8,
      vaultBytes: 13,
      files: 2,
      writesPerHour: 4,
      newVaultBytesPerDay: 13,
      newVaults: { perHour: 100, perAddressPerHour: 100 },
    });
    const file = (name: string) => `/files/devices/laptop/meetings/${name}.bin`;

    assert.equal(
      (await send(file('big'), { method: 'PUT', body: '123456789' })).status,
      413,
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: '12345678' })).status,
      204,
    );
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: '123456' })).status,
      507,
    );
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: '1234' })).status,
      204,
    );
    assert.equal(
      (await send(file('c'), { method: 'PUT', body: '1' })).status,
      507,
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: '1' })).status,
      204,
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: '1' })).status,
      204,
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: '1' })).status,
      429,
    );
    tick(60 * 60 * 1000);
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: '1' })).status,
      204,
    );
  });

  it('serves the app’s relay transport', async () => {
    const { handle } = setUp();
    const transport = createRelayTransport({
      url: 'https://sync.example.com',
      vaultId: vault,
      token,
      fetch: (url, init) => handle(new Request(url, init)),
    });

    await transport.register();
    await transport.write(meeting, Buffer.from('sealed'));

    assert.deepEqual(
      (await transport.list('devices/')).map((file) => file.path),
      [meeting],
    );
    assert.deepEqual(
      Buffer.from((await transport.read(meeting, 1_000)) ?? []),
      Buffer.from('sealed'),
    );
    await transport.remove(meeting);
    assert.equal(await transport.read(meeting, 1_000), null);
    await assert.rejects(
      transport.write(meeting, Buffer.alloc(defaultLimits.fileBytes + 1)),
      /413: this meeting is too large/,
    );
  });

  const file = (name: string) => `/files/devices/laptop/meetings/${name}.bin`;
  const small: Limits = {
    fileBytes: 8,
    vaultBytes: 100,
    files: 1,
    writesPerHour: 3,
    newVaultBytesPerDay: 100,
    newVaults: { perHour: 100, perAddressPerHour: 100 },
  };

  it('never reaches another vault through the path', async () => {
    const { send } = setUp();
    const other = vaultIdOf(randomBytes(32));
    for (const path of [
      `/files/../../${other}/files/devices/a/meetings/m.bin`,
      `/files/%2e%2e/%2e%2e/${other}/files/devices/a/meetings/m.bin`,
    ]) {
      assert.equal(
        (await send(path, { method: 'PUT', body: 'x' })).status,
        403,
      );
    }
    assert.equal(
      (
        await send('/files/devices%2fa/meetings/m.bin', {
          method: 'PUT',
          body: 'x',
        })
      ).status,
      400,
    );
    for (const method of ['POST', 'PATCH', 'HEAD', 'OPTIONS']) {
      assert.equal((await send(file('m'), { method })).status, 405, method);
    }
    assert.equal((await send('')).status, 405);
  });

  it('treats an index it can’t read as empty instead of failing', async () => {
    const { send, objects } = setUp();
    objects.set(`vaults/${vault}/index.json`, {
      data: Buffer.from('{not json'),
      version: 'v0',
    });
    assert.deepEqual(await (await send('/files?prefix=devices/')).json(), []);
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'x' })).status,
      204,
    );
    objects.set(`vaults/${vault}/index.json`, {
      data: Buffer.from(
        JSON.stringify({
          files: {
            ['__proto__']: { version: 'v', changedAt: 0, size: 1 },
            'evil/path': { version: 'v', changedAt: 0, size: 1 },
            'devices/a/meetings/m.bin': {
              version: 'v',
              changedAt: 0,
              size: -5,
            },
          },
        }),
      ),
      version: 'v1',
    });
    assert.deepEqual(await (await send('/files?prefix=')).json(), []);
  });

  it('gives back the quota of a write that failed', async () => {
    let failing = true;
    const { send } = setUp(small, (pathname) =>
      failing && pathname.includes('/files/')
        ? new Error('storage down')
        : null,
    );
    await assert.rejects(send(file('a'), { method: 'PUT', body: 'x' }));
    failing = false;
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: 'x' })).status,
      204,
    );
  });

  it('counts deletes as writes and skips files it doesn’t have', async () => {
    const { send, removed } = setUp({ ...small, files: 10 });
    assert.equal((await send(file('none'), { method: 'DELETE' })).status, 204);
    assert.deepEqual(removed, []);
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'x' })).status,
      204,
    );
    assert.equal((await send(file('a'), { method: 'DELETE' })).status, 204);
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'x' })).status,
      204,
    );
    assert.equal((await send(file('a'), { method: 'DELETE' })).status, 429);
  });

  it('caps how many new vaults the relay takes in an hour', async () => {
    const { handle, tick } = setUp({
      ...defaultLimits,
      newVaults: { perHour: 2, perAddressPerHour: 100 },
    });
    const firstWrite = (key: Buffer) =>
      handle(
        new Request(
          `https://sync.example.com/v1/vaults/${vaultIdOf(key)}/files/devices/a/meetings/m.bin`,
          {
            method: 'PUT',
            body: 'x',
            headers: { authorization: `Bearer ${relayToken(key)}` },
          },
        ),
      );
    const keys = [randomBytes(32), randomBytes(32), randomBytes(32)];
    assert.equal((await firstWrite(keys[0] ?? randomBytes(32))).status, 204);
    assert.equal((await firstWrite(keys[1] ?? randomBytes(32))).status, 204);
    assert.equal((await firstWrite(keys[2] ?? randomBytes(32))).status, 429);
    assert.equal((await firstWrite(keys[0] ?? randomBytes(32))).status, 204);
    tick(60 * 60 * 1000);
    assert.equal((await firstWrite(keys[2] ?? randomBytes(32))).status, 204);
  });

  it('gives up with 503 when the index keeps changing under it', async () => {
    const { send } = setUp(defaultLimits, (pathname) =>
      pathname.endsWith('index.json') ? new Conflict() : null,
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'x' })).status,
      503,
    );
  });

  it('lets one address make only a few vaults an hour, and says why', async () => {
    const { handle } = setUp({
      ...defaultLimits,
      newVaults: { perHour: 100, perAddressPerHour: 2 },
    });
    const firstWrite = (address: string) => {
      const key = randomBytes(32);
      return handle(
        new Request(
          `https://sync.example.com/v1/vaults/${vaultIdOf(key)}/files/devices/a/meetings/m.bin`,
          {
            method: 'PUT',
            body: 'x',
            headers: {
              authorization: `Bearer ${relayToken(key)}`,
              'x-forwarded-for': address,
            },
          },
        ),
      );
    };
    assert.equal((await firstWrite('192.0.2.1')).status, 204);
    assert.equal((await firstWrite('192.0.2.1')).status, 204);
    const refused = await firstWrite('192.0.2.1');
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('x-relay-refusal'), 'new-vaults');
    const key = randomBytes(32);
    const transport = createRelayTransport({
      url: 'https://sync.example.com',
      vaultId: vaultIdOf(key),
      token: relayToken(key),
      fetch: (url, init) =>
        handle(
          new Request(url, {
            ...init,
            headers: { ...init.headers, 'x-forwarded-for': '192.0.2.1' },
          }),
        ),
    });
    await assert.rejects(
      transport.write('devices/a/meetings/m.bin', Buffer.from('x')),
      /429: it isn’t taking new vaults/,
    );
    assert.equal((await firstWrite('192.0.2.77')).status, 429);
    assert.equal((await firstWrite('198.51.100.1')).status, 204);
  });

  it('lets a young vault hold a day’s allowance, growing each day', async () => {
    const { send, tick } = setUp({
      ...defaultLimits,
      fileBytes: 10,
      newVaultBytesPerDay: 10,
    });
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: '123456' })).status,
      204,
    );
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: '123456' })).status,
      507,
    );
    tick(24 * 60 * 60 * 1000);
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: '123456' })).status,
      204,
    );
  });

  it('counts a file stored by a write that never finished, once it is settled', async () => {
    let stored = false;
    let blocked = true;
    const { send, tick } = setUp({ ...small, files: 1 }, (pathname) => {
      if (pathname.includes('/files/')) {
        stored = true;
        return null;
      }
      return stored && blocked && pathname.endsWith('index.json')
        ? new Conflict()
        : null;
    });
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'x' })).status,
      503,
    );
    blocked = false;
    assert.deepEqual(await (await send('/files?prefix=')).json(), []);

    tick(10 * 60 * 1000);
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: 'x' })).status,
      507,
    );
    const listed: unknown = await (await send('/files?prefix=')).json();
    assert.deepEqual(
      (Array.isArray(listed) ? listed : []).map((entry) =>
        Reflect.get(Object(entry), 'path'),
      ),
      ['devices/laptop/meetings/a.bin'],
    );
  });

  it('drops a reservation with nothing stored behind it, once it is settled', async () => {
    const { send, objects, tick } = setUp({ ...small, files: 1 });
    objects.set(`vaults/${vault}/index.json`, {
      data: Buffer.from(
        JSON.stringify({
          createdAt: 0,
          files: {
            'devices/laptop/meetings/lost.bin': {
              version: '',
              changedAt: start,
              size: 0,
              pending: { nonce: 'gone', size: 1, since: start },
            },
          },
        }),
      ),
      version: 'v0',
    });
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: 'x' })).status,
      507,
    );
    tick(10 * 60 * 1000);
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: 'x' })).status,
      204,
    );
  });

  it('counts the larger size while an overwrite is pending', async () => {
    let failing = false;
    const { send } = setUp(
      { ...small, files: 10, vaultBytes: 10, newVaultBytesPerDay: 10 },
      (pathname) =>
        failing && pathname.includes('/files/')
          ? new Error('storage down')
          : null,
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: '12345678' })).status,
      204,
    );
    failing = true;
    await assert.rejects(send(file('a'), { method: 'PUT', body: '12' }));
    failing = false;
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: '12345678' })).status,
      507,
    );
  });

  it('lets one write at a time change a file, so its size matches what is stored', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = false;
    const { send, objects } = setUp(
      defaultLimits,
      undefined,
      async (pathname) => {
        if (holding && pathname.includes('/files/')) {
          holding = false;
          await held;
        }
      },
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'x' })).status,
      204,
    );

    holding = true;
    const big = send(file('a'), { method: 'PUT', body: '123456789' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'y' })).status,
      409,
    );
    assert.equal((await send(file('a'), { method: 'DELETE' })).status, 409);
    release();
    assert.equal((await big).status, 204);

    const index: unknown = parseIndexOf(
      objects.get(`vaults/${vault}/index.json`),
    );
    const stored = objects.get(
      `vaults/${vault}/files/devices/laptop/meetings/a.bin`,
    );
    assert.equal(
      Reflect.get(
        Object(Reflect.get(Object(index), 'devices/laptop/meetings/a.bin')),
        'size',
      ),
      stored?.data.length,
    );
    assert.equal(stored?.data.length, 9);
  });

  it('ignores a write that finishes after its reservation was settled', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = false;
    const { send, tick } = setUp(
      { ...small, files: 10 },
      undefined,
      async (pathname) => {
        if (holding && pathname.endsWith('/a.bin')) {
          holding = false;
          await held;
        }
      },
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'x' })).status,
      204,
    );
    holding = true;
    const late = send(file('a'), { method: 'PUT', body: 'y' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    tick(10 * 60 * 1000);
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: 'x' })).status,
      204,
    );
    release();
    assert.equal((await late).status, 409);
  });

  it('groups client addresses by network, however they are written', () => {
    assert.equal(networkOf('192.0.2.1'), '192.0.2');
    assert.equal(networkOf('192.0.2.200, 198.51.100.1'), '192.0.2');
    assert.equal(networkOf('::ffff:192.0.2.9'), '192.0.2');
    for (const address of [
      '2001:db8::1',
      '2001:0db8:0000:0000::9',
      '2001:db8:0:0:1::5',
      '2001:DB8:0:abcd:1:2:3:4',
    ]) {
      assert.equal(networkOf(address), '2001:db8:0', address);
    }
    assert.equal(networkOf('2001:db8:1::1'), '2001:db8:1');
    for (const address of [null, '', 'garbage', '1::2::3', '2001:db8:::1']) {
      assert.equal(networkOf(address), 'unknown', String(address));
    }
  });

  it('counts the larger size while an overwrite is still running', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = false;
    const { send } = setUp(
      { ...small, files: 10, vaultBytes: 10, newVaultBytesPerDay: 10 },
      undefined,
      async (pathname) => {
        if (holding && pathname.endsWith('/a.bin')) {
          holding = false;
          await held;
        }
      },
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: '12' })).status,
      204,
    );
    holding = true;
    const growing = send(file('a'), { method: 'PUT', body: '12345678' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: '123' })).status,
      507,
    );
    release();
    assert.equal((await growing).status, 204);
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: '12' })).status,
      204,
    );
  });

  it('finishes a write whose index updates were stored but not answered', async () => {
    let indexWrites = 0;
    const { send } = setUp(defaultLimits, (pathname) => {
      if (pathname.startsWith('stored:') && pathname.endsWith('index.json')) {
        indexWrites += 1;
        return indexWrites === 1 || indexWrites === 3 ? new Conflict() : null;
      }
      return null;
    });
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'x' })).status,
      204,
    );
    assert.equal(indexWrites, 4);
    const listed: unknown = await (await send('/files?prefix=')).json();
    assert.equal(Array.isArray(listed) ? listed.length : -1, 1);
  });

  it('settles an unfinished write with the size that was stored', async () => {
    let stored = false;
    let blocked = true;
    const { send, tick } = setUp(
      { ...small, files: 10, vaultBytes: 10, newVaultBytesPerDay: 10 },
      (pathname) => {
        if (pathname.includes('/files/')) {
          stored = true;
          return null;
        }
        return stored && blocked && pathname.endsWith('index.json')
          ? new Conflict()
          : null;
      },
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: '123456' })).status,
      503,
    );
    blocked = false;
    tick(2 * 60 * 1000);
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: '123456' })).status,
      507,
    );
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: '1234' })).status,
      204,
    );
  });

  it('keeps counting a write that failed after it was stored', async () => {
    let failing = true;
    const { send } = setUp(
      { ...small, files: 10, vaultBytes: 10, newVaultBytesPerDay: 10 },
      (pathname) =>
        failing && pathname.startsWith('stored:') && pathname.endsWith('/a.bin')
          ? new Error('lost response')
          : null,
    );
    await assert.rejects(send(file('a'), { method: 'PUT', body: '123456' }));
    failing = false;
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: '123456' })).status,
      507,
    );
    const listed: unknown = await (await send('/files?prefix=')).json();
    assert.equal(Array.isArray(listed) ? listed.length : -1, 1);
  });

  it('settles a delete that failed part-way against what is stored', async () => {
    let failing = true;
    const { send, tick } = setUp({ ...small, files: 10 }, (pathname) =>
      failing && pathname.startsWith('remove:')
        ? new Error('storage down')
        : null,
    );
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'x' })).status,
      204,
    );
    await assert.rejects(send(file('a'), { method: 'DELETE' }));
    assert.equal(
      (await send(file('a'), { method: 'PUT', body: 'y' })).status,
      409,
    );
    failing = false;
    tick(2 * 60 * 1000);
    assert.equal(
      (await send(file('b'), { method: 'PUT', body: 'x' })).status,
      204,
    );
    const listed: unknown = await (await send('/files?prefix=')).json();
    assert.equal(Array.isArray(listed) ? listed.length : -1, 2);
  });

  it('answers a poll with 304 and no body while nothing changed', async () => {
    const { send, handle } = setUp();
    await send(file('a'), { method: 'PUT', body: 'x' });
    const first = await send('/files?prefix=devices/');
    const version = first.headers.get('etag') ?? '';
    assert.notEqual(version, '');

    const poll = await handle(
      new Request(`${base}/files?prefix=devices/`, {
        headers: { authorization: `Bearer ${token}`, 'if-none-match': version },
      }),
    );
    assert.equal(poll.status, 304);
    assert.equal(await poll.text(), '');

    await send(file('b'), { method: 'PUT', body: 'x' });
    const changed = await handle(
      new Request(`${base}/files?prefix=devices/`, {
        headers: { authorization: `Bearer ${token}`, 'if-none-match': version },
      }),
    );
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).length, 2);
  });

  it('lets the app reuse its listing while the relay answers 304', async () => {
    const { handle } = setUp();
    const statuses: number[] = [];
    const transport = createRelayTransport({
      url: 'https://sync.example.com',
      vaultId: vault,
      token,
      fetch: async (url, init) => {
        const response = await handle(new Request(url, init));
        if ((init.method ?? 'GET') === 'GET' && url.includes('/files?')) {
          statuses.push(response.status);
        }
        return response;
      },
    });
    await transport.write(meeting, Buffer.from('sealed'));

    const first = await transport.list('devices/');
    const second = await transport.list('devices/');
    await transport.write('devices/laptop/meetings/m2.bin', Buffer.from('x'));
    const third = await transport.list('devices/');

    assert.deepEqual(statuses, [200, 304, 200]);
    assert.deepEqual(second, first);
    assert.deepEqual(third.map((entry) => entry.path).sort(), [
      meeting,
      'devices/laptop/meetings/m2.bin',
    ]);
  });

  it('keeps a separate listing for each prefix', async () => {
    const { handle, send } = setUp();
    await send(file('a'), { method: 'PUT', body: 'x' });
    const transport = createRelayTransport({
      url: 'https://sync.example.com',
      vaultId: vault,
      token,
      fetch: (url, init) => handle(new Request(url, init)),
    });
    assert.deepEqual(await transport.list('devices/other/'), []);
    assert.deepEqual(
      (await transport.list('devices/')).map((entry) => entry.path),
      ['devices/laptop/meetings/a.bin'],
    );
  });

  it('forgets a listing the relay sent without a version, and refuses a 304 it can’t use', async () => {
    const answers = [
      () =>
        Response.json([{ path: meeting, version: 'v1', changedAt: 1 }], {
          headers: { etag: 'e1' },
        }),
      () => Response.json([]),
      () => new Response(null, { status: 304 }),
    ];
    const transport = createRelayTransport({
      url: 'https://sync.example.com',
      vaultId: vault,
      token,
      fetch: async () =>
        (answers.shift() ?? (() => new Response(null, { status: 500 })))(),
    });
    assert.equal((await transport.list('devices/')).length, 1);
    assert.deepEqual(await transport.list('devices/'), []);
    await assert.rejects(transport.list('devices/'), /answered 304/);
    const reader = createRelayTransport({
      url: 'https://sync.example.com',
      vaultId: vault,
      token,
      fetch: async () => new Response(null, { status: 304 }),
    });
    await assert.rejects(reader.read(meeting, 100), /answered 304/);
  });
});

function parseIndexOf(stored: { data: Uint8Array } | undefined): unknown {
  const raw: unknown = JSON.parse(Buffer.from(stored?.data ?? []).toString());
  return Reflect.get(Object(raw), 'files');
}
