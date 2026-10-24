import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  identityCard,
  relayRequestWindowMs,
  relayToken,
  signRelayRequest,
  vaultIdOf,
  type Identity,
} from '@nod/core/crypto';
import {
  createTeamRelay,
  fetchInviteFile,
  HeadMoved,
  maxInviteFileBytes,
  NotAMember,
  openInviteFile,
  replayAccessList,
  sealInviteFile,
  teamVaultIdOf,
  type AccessState,
  type SignedAccessRecord,
} from '@nod/core/sharing';
import {
  accountsAddRecord,
  accountsRemoveRecord,
  inviteFileFor,
  inviteRecord,
  keyChangeRecord,
  requestAcceptRecord,
  requestDeclineRecord,
  requestJoinRecord,
  requestRemoveRecord,
  rootRecord,
  sealedNote,
  testIdentities,
  type CurrentKey,
} from '@nod/core/sharing/testing';
import { createRelayTransport, type Fetch } from '@nod/core/sync';
import {
  Conflict,
  createRelayHandler,
  defaultLimits,
  networkOf,
  networksOf,
  versionOf,
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

  it('accepts only meeting, note, shares and closing files, never other paths', async () => {
    const { send } = setUp();
    for (const path of [
      'pairing/r1/request.json',
      'devices/laptop/meetings/../../index.json',
      'devices/laptop/meetings/m1.txt',
      'devices/laptop/notes/n1.txt',
      'devices/laptop/notes/closed.json',
      'devices/laptop/shares.json',
      'devices/laptop/other.json',
      'devices/laptop/device.json',
      'devices/laptop/meetings/closed.json',
      'index.json',
    ]) {
      assert.equal(
        (await send(`/files/${path}`, { method: 'PUT', body: 'x' })).status,
        400,
        path,
      );
    }
    assert.equal((await send('/files?prefix=../')).status, 400);
    for (const path of [
      'devices/laptop/closed.json',
      'devices/laptop/notes/n1.bin',
      'devices/laptop/shares.bin',
    ]) {
      assert.equal(
        (await send(`/files/${path}`, { method: 'PUT', body: 'x' })).status,
        204,
        path,
      );
    }
  });

  it('refuses writes past the vault’s limits', async () => {
    const { send, tick } = setUp({
      ...defaultLimits,
      fileBytes: 8,
      vaultBytes: 13,
      files: 2,
      writesPerHour: 4,
      newVaultBytesPerDay: 13,
      newVaults: {
        perHour: 100,
        perAddressPerHour: 100,
        perWideNetworkPerHour: 100,
      },
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
    tick(20 * 60 * 1000);
    const refused = await send(file('a'), { method: 'PUT', body: '1' });
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('retry-after'), '2400');
    assert.equal(refused.headers.get('x-relay-refusal'), 'writes');
    tick(40 * 60 * 1000);
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
    ...defaultLimits,
    fileBytes: 8,
    vaultBytes: 100,
    files: 1,
    writesPerHour: 3,
    newVaultBytesPerDay: 100,
    newVaults: {
      perHour: 100,
      perAddressPerHour: 100,
      perWideNetworkPerHour: 100,
    },
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
      newVaults: {
        perHour: 2,
        perAddressPerHour: 100,
        perWideNetworkPerHour: 100,
      },
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
      newVaults: {
        perHour: 100,
        perAddressPerHour: 2,
        perWideNetworkPerHour: 100,
      },
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
    assert.equal(refused.headers.get('retry-after'), '3600');
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

  it('lets one wider network make only a few more vaults an hour', async () => {
    const { handle } = setUp({
      ...defaultLimits,
      newVaults: {
        perHour: 100,
        perAddressPerHour: 100,
        perWideNetworkPerHour: 2,
      },
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
    assert.equal((await firstWrite('2001:db8:1::1')).status, 204);
    assert.equal((await firstWrite('2001:db8:2::1')).status, 204);
    const refused = await firstWrite('2001:db8:3::1');
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('x-relay-refusal'), 'new-vaults');
    assert.equal((await firstWrite('2001:db9:3::1')).status, 204);
    assert.equal((await firstWrite('192.0.2.1')).status, 204);
    assert.equal((await firstWrite('192.0.3.1')).status, 204);
    assert.equal((await firstWrite('192.0.4.1')).status, 429);
    assert.equal((await firstWrite('192.1.4.1')).status, 204);
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
    assert.deepEqual(networksOf('192.0.2.1'), {
      network: '192.0.2',
      wide: '192.0',
    });
    assert.deepEqual(networksOf('::ffff:192.0.2.9'), {
      network: '192.0.2',
      wide: '192.0',
    });
    assert.deepEqual(networksOf('2001:DB8:0:abcd::1'), {
      network: '2001:db8:0',
      wide: '2001:db8',
    });
    assert.deepEqual(networksOf('garbage'), {
      network: 'unknown',
      wide: 'unknown',
    });
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

  it('uses a weak ETag as the version it names, and refuses an empty one', () => {
    assert.equal(versionOf('W/"f632147f"'), '"f632147f"');
    assert.equal(versionOf('"f632147f"'), '"f632147f"');
    assert.throws(() => versionOf(''), /no version/);
    assert.throws(() => versionOf('W/'), /no version/);
  });
});

describe('vercel relay team vaults', () => {
  const host = 'https://sync.example.com/';
  const { owner, admin, writer, reader, stranger, another, hex } =
    testIdentities();
  const week = 7 * 24 * 60 * 60 * 1000;
  const dev = {
    d0: '0'.repeat(64),
    d1: '1'.repeat(64),
    d2: '2'.repeat(64),
    dx: 'f'.repeat(64),
  };
  // The app shows only the status; the reason the relay writes in the body
  // is checked from the last response it sent.
  const reasons: string[] = [];

  async function refused(
    action: Promise<unknown>,
    status: number,
    reason?: string,
  ) {
    await assert.rejects(action, new RegExp(`answered ${status}`));
    if (reason !== undefined) {
      assert.equal(reasons.at(-1), reason);
    }
  }

  function stateOf(
    vaultId: string,
    records: SignedAccessRecord[],
  ): AccessState {
    const replayed = replayAccessList(vaultId, records);
    if (!replayed.ok) {
      throw new Error(replayed.reason);
    }
    return replayed.state;
  }

  function setUp(
    limits: Limits = defaultLimits,
    gate?: (pathname: string) => Promise<void>,
  ) {
    const { storage, objects } = memoryStorage(undefined, gate);
    let clock = start;
    const sent: Array<{ url: string; init: RequestInit }> = [];
    const statuses: number[] = [];
    const reads: string[] = [];
    const handle = createRelayHandler({
      storage: {
        ...storage,
        read: (pathname) => {
          reads.push(pathname);
          return storage.read(pathname);
        },
      },
      now: () => clock,
      addressKey: 'test-key',
      limits,
    });
    const fetch: Fetch = async (url, init) => {
      sent.push({ url, init });
      const response = await handle(new Request(url, init));
      statuses.push(response.status);
      reasons.push(await response.clone().text());
      return response;
    };
    const place = (identity: Identity, vaultId: string, now = () => clock) =>
      createTeamRelay({ url: host, vaultId, identity, fetch, now });
    async function startTeam() {
      const root = rootRecord(owner, clock);
      const vaultId = teamVaultIdOf(root.record);
      const at = place(owner, vaultId);
      await at.list.append(root.record);
      const key: CurrentKey = { keyId: root.keyId, rootKey: root.rootKey };
      const state = async () => stateOf(vaultId, await at.list.read());
      return { vaultId, root, at, key, state };
    }
    // A request signed by hand, for routes the app's client doesn't send.
    const signed = (
      who: Identity,
      vaultId: string,
      method: string,
      path: string,
      body?: Uint8Array,
    ) => {
      const url = `${host}v1/vaults/${vaultId}${path}`;
      const parsed = new URL(url);
      const authorization = signRelayRequest(
        who,
        {
          host: parsed.host,
          method,
          path: `${parsed.pathname}${parsed.search}`,
          vaultId,
          body: body ?? null,
        },
        clock,
      );
      return handle(
        new Request(url, {
          method,
          headers: { authorization },
          ...(body ? { body: Buffer.from(body) } : {}),
        }),
      );
    };
    return {
      handle,
      objects,
      fetch,
      place,
      startTeam,
      signed,
      sent,
      statuses,
      reads,
      tick: (ms: number) => {
        clock += ms;
      },
      now: () => clock,
    };
  }

  it('registers a team by its root record and refuses any other root', async () => {
    const { place, startTeam, handle, objects } = setUp();
    const { vaultId, root, at } = await startTeam();
    assert.deepEqual(await at.list.read(), [root.record]);

    const other = rootRecord(stranger, start);
    await refused(
      place(stranger, vaultId).list.append(other.record),
      403,
      'not a member',
    );
    await refused(
      place(owner, teamVaultIdOf(other.record)).list.append(other.record),
      403,
      'the record isn’t the requester’s',
    );
    const mine = rootRecord(owner, start);
    await refused(
      place(owner, teamVaultIdOf(other.record)).list.append(mine.record),
      400,
      'the root isn’t this vault’s',
    );
    await assert.rejects(
      place(owner, teamVaultIdOf(mine.record)).list.read(),
      /isn’t on this relay/,
    );
    objects.set(`vaults/${teamVaultIdOf(mine.record)}/index.json`, {
      data: Buffer.from(JSON.stringify({ createdAt: start, files: {} })),
      version: 'token',
    });
    await assert.rejects(
      place(owner, teamVaultIdOf(mine.record)).list.append(mine.record),
      HeadMoved,
    );
    assert.equal(reasons.at(-1), 'this id names a token vault');
    const url = `${host}v1/vaults/${vaultId}/acl`;
    assert.equal((await handle(new Request(url))).status, 401);
    assert.equal(
      (
        await handle(
          new Request(url, {
            headers: { authorization: `Bearer ${relayToken(root.rootKey)}` },
          }),
        )
      ).status,
      401,
    );
  });

  it('counts a team against the new vaults an hour', async () => {
    const { place, startTeam } = setUp({
      ...defaultLimits,
      newVaults: {
        perHour: 1,
        perAddressPerHour: 100,
        perWideNetworkPerHour: 100,
      },
    });
    await startTeam();
    const second = rootRecord(owner, start);
    await assert.rejects(
      place(owner, teamVaultIdOf(second.record)).list.append(second.record),
      /429: it isn’t taking new vaults/,
    );
  });

  it('appends on the head only, and tells the client when the list moved', async () => {
    const { place, startTeam, now } = setUp();
    const { vaultId, at, key, state } = await startTeam();
    const stale = await state();
    await at.list.append(
      accountsAddRecord(
        owner,
        stale,
        key,
        [{ card: identityCard(writer), role: 'writer' }],
        now(),
      ),
    );
    await assert.rejects(
      at.list.append(
        inviteRecord(owner, stale, key, 'reader', true, now()).record,
      ),
      HeadMoved,
    );
    await at.list.append(
      inviteRecord(owner, await state(), key, 'reader', true, now()).record,
    );
    assert.equal((await at.list.read()).length, 3);

    await refused(
      place(stranger, vaultId).list.append(
        requestRemoveRecord(stranger, await state(), now()),
      ),
      403,
      'not a member',
    );
    await refused(
      place(writer, vaultId).list.append(
        inviteRecord(writer, await state(), key, 'reader', true, now()).record,
      ),
      400,
      'only an owner or admin invites, and only an owner invites admins',
    );
    await refused(
      place(writer, vaultId).list.append(
        requestRemoveRecord(owner, await state(), now()),
      ),
      403,
      'the record isn’t the requester’s',
    );
  });

  it('takes a join request from an outsider and tells only them how it fared', async () => {
    const { place, startTeam, now } = setUp();
    const { vaultId, at, key, state } = await startTeam();
    const invite = inviteRecord(
      owner,
      await state(),
      key,
      'writer',
      true,
      now(),
    );
    await at.list.append(invite.record);
    const file = inviteFileFor({ vaultId, invite, inviter: owner, host });

    const request = requestJoinRecord(stranger, file, null, now());
    const asker = place(stranger, vaultId);
    await asker.list.append(request);
    assert.equal(await asker.status(request.id), 'pending');
    assert.equal(await place(another, vaultId).status(request.id), 'unknown');
    assert.equal(await at.status(request.id), 'unknown');
    assert.equal(await asker.status(invite.record.id), 'unknown');
    await assert.rejects(asker.list.read(), NotAMember);
    await refused(
      asker.list.append(request),
      400,
      'this record is already in the list',
    );

    await at.list.append(
      requestAcceptRecord(
        owner,
        await state(),
        key,
        request.id,
        'writer',
        now(),
      ),
    );
    assert.equal(await asker.status(request.id), 'accepted');
    assert.equal((await asker.list.read()).length, 4);

    const second = requestJoinRecord(another, file, null, now());
    await place(another, vaultId).list.append(second);
    await at.list.append(
      requestDeclineRecord(owner, await state(), second.id, now()),
    );
    assert.equal(await place(another, vaultId).status(second.id), 'declined');
    await assert.rejects(place(another, vaultId).list.read(), NotAMember);
  });

  it('serves the list to members with a version, and 304 while it stands', async () => {
    const { startTeam, statuses, now } = setUp();
    const { at, state, key } = await startTeam();
    statuses.length = 0;
    const first = await at.list.read();
    const second = await at.list.read();
    assert.deepEqual(statuses, [200, 304]);
    assert.deepEqual(second, first);
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(reader), role: 'reader' }],
        now(),
      ),
    );
    statuses.length = 0;
    assert.equal((await at.list.read()).length, 2);
    assert.deepEqual(statuses, [200]);
  });

  it('keeps invite files for managers, few and small, and hands them to anyone', async () => {
    const { place, startTeam, fetch, now, tick, handle } = setUp({
      ...defaultLimits,
      inviteFiles: 2,
    });
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [
          { card: identityCard(admin), role: 'admin' },
          { card: identityCard(writer), role: 'writer' },
          { card: identityCard(reader), role: 'reader' },
        ],
        now(),
      ),
    );
    const invite = inviteRecord(
      owner,
      await state(),
      key,
      'writer',
      true,
      now(),
    );
    await at.list.append(invite.record);
    const sealedFor = (team: string) =>
      sealInviteFile(
        inviteFileFor({ vaultId, invite, inviter: owner, host, team }),
      );

    const first = sealedFor('First');
    await at.putInvite(first.fileId, first.sealed);
    const link = { vaultId, fileId: first.fileId, key: first.key, host };
    const fetched = await fetchInviteFile(link, fetch);
    assert.deepEqual(Buffer.from(fetched ?? []), Buffer.from(first.sealed));
    assert.equal(
      openInviteFile(fetched ?? new Uint8Array(), first.key)?.team,
      'First',
    );
    assert.equal(
      await fetchInviteFile({ ...link, fileId: '0'.repeat(32) }, fetch),
      null,
    );

    for (const who of [writer, reader, stranger]) {
      const theirs = sealedFor('Theirs');
      await refused(
        place(who, vaultId).putInvite(theirs.fileId, theirs.sealed),
        403,
        'only an owner or admin writes invites',
      );
    }
    const second = sealedFor('Second');
    await place(admin, vaultId).putInvite(second.fileId, second.sealed);
    await refused(
      at.putInvite('0'.repeat(32), second.sealed),
      400,
      'the file id isn’t the file’s hash',
    );
    await refused(
      at.putInvite(second.fileId, new Uint8Array(maxInviteFileBytes + 1)),
      413,
    );
    const third = sealedFor('Third');
    await refused(at.putInvite(third.fileId, third.sealed), 507);
    await at.putInvite(first.fileId, first.sealed);

    tick(week);
    assert.equal(await fetchInviteFile(link, fetch), null);
    await at.putInvite(third.fileId, third.sealed);
    assert.equal(
      (
        await handle(
          new Request(`${host}v1/vaults/${vaultId}/invites/${first.fileId}`, {
            method: 'PUT',
            body: new Uint8Array(first.sealed),
          }),
        )
      ).status,
      401,
    );
  });

  it('lets writers publish signed files under the current key into their own folder', async () => {
    const { place, startTeam, now, objects } = setUp();
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [
          { card: identityCard(writer), role: 'writer' },
          { card: identityCard(reader), role: 'reader' },
        ],
        now(),
      ),
    );
    const files = (who: Identity) => place(who, vaultId).transport;
    const note = `devices/${dev.d1}/notes/n1.bin`;
    const published = sealedNote(key, writer);

    assert.notEqual(await files(writer).write(note, published), null);
    assert.deepEqual(
      (await files(reader).list('devices/')).map((file) => file.path),
      [note],
    );
    assert.deepEqual(
      Buffer.from((await files(reader).read(note, 10_000)) ?? []),
      Buffer.from(published),
    );
    await refused(files(stranger).list('devices/'), 403, 'not a member');
    await refused(files(stranger).read(note, 10_000), 403);
    await refused(
      files(reader).write(
        `devices/${dev.d2}/notes/n1.bin`,
        sealedNote(key, reader),
      ),
      403,
      'readers don’t write',
    );
    await refused(
      files(writer).write(
        `devices/${dev.d1}/notes/n2.bin`,
        sealedNote(key, owner),
      ),
      403,
      'the file names another publisher',
    );
    await refused(
      files(writer).write(
        `devices/${dev.d1}/notes/n2.bin`,
        Buffer.from('plain'),
      ),
      400,
      'not a signed file',
    );
    for (const path of [
      `devices/${dev.d1}/meetings/m1.bin`,
      `devices/${dev.d1}/closed.json`,
      `devices/${dev.d1}/shares.bin`,
    ]) {
      await refused(files(writer).write(path, sealedNote(key, writer)), 400);
    }
    await refused(
      files(writer).write(
        `devices/${dev.d1}/members.bin`,
        sealedNote(key, writer),
      ),
      403,
      'only an owner or admin names members',
    );
    await files(owner).write(
      `devices/${dev.d0}/members.bin`,
      sealedNote(key, owner),
    );

    await refused(
      files(owner).write(
        `devices/${dev.d1}/notes/n9.bin`,
        sealedNote(key, owner),
      ),
      403,
      'another identity’s device folder',
    );
    const index = objects.get(`vaults/${vaultId}/index.json`);
    assert.ok(index);
    const raw: unknown = JSON.parse(Buffer.from(index.data).toString());
    assert.deepEqual(Reflect.get(Object(raw), 'bindings'), {
      [dev.d1]: hex(writer),
      [dev.d0]: hex(owner),
    });
    objects.set(`vaults/${vaultId}/index.json`, {
      data: Buffer.from(JSON.stringify({ ...Object(raw), bindings: {} })),
      version: 'rebuilt',
    });
    await refused(
      files(owner).write(
        `devices/${dev.d1}/notes/n9.bin`,
        sealedNote(key, owner),
      ),
      403,
      'another identity’s device folder',
    );
    await files(writer).write(
      `devices/${dev.d1}/notes/n2.bin`,
      sealedNote(key, writer),
    );

    const rotated = keyChangeRecord(owner, await state(), key, now());
    await at.list.append(rotated.record);
    await refused(
      files(writer).write(note, sealedNote(key, writer, 'later')),
      409,
      'sealed under a retired key',
    );
    const next: CurrentKey = {
      keyId:
        rotated.record.body.type === 'keyChange'
          ? rotated.record.body.keyChange.keyId
          : '',
      rootKey: rotated.rootKey,
    };
    await files(writer).write(note, sealedNote(next, writer, 'later'));
  });

  it('lets files go only by their folder’s identity, or a manager once it left', async () => {
    const { place, startTeam, now } = setUp();
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [
          { card: identityCard(writer), role: 'writer' },
          { card: identityCard(admin), role: 'admin' },
        ],
        now(),
      ),
    );
    const files = (who: Identity) => place(who, vaultId).transport;
    await files(writer).write(
      `devices/${dev.d1}/notes/n1.bin`,
      sealedNote(key, writer),
    );
    await files(writer).write(
      `devices/${dev.d1}/notes/n2.bin`,
      sealedNote(key, writer),
    );

    await refused(
      files(admin).remove(`devices/${dev.d1}/notes/n1.bin`),
      403,
      'another identity’s device folder',
    );
    await refused(files(owner).remove(`devices/${dev.d1}/notes/n1.bin`), 403);
    await files(writer).remove(`devices/${dev.d1}/notes/n1.bin`);
    await files(writer).remove(`devices/${dev.d1}/notes/none.bin`);
    assert.equal(
      await files(admin).read(`devices/${dev.d1}/notes/n1.bin`, 10_000),
      null,
    );

    const removed = accountsRemoveRecord(
      owner,
      await state(),
      key,
      [hex(writer)],
      now(),
    );
    await at.list.append(removed.record);
    await refused(files(writer).list('devices/'), 403, 'not a member');
    await files(admin).remove(`devices/${dev.d1}/notes/n2.bin`);
    assert.deepEqual(await files(owner).list('devices/'), []);
    const rotated: CurrentKey = {
      keyId:
        removed.record.body.type === 'accountsRemove'
          ? removed.record.body.keyChange.keyId
          : '',
      rootKey: removed.rootKey,
    };
    await refused(
      files(owner).write(
        `devices/${dev.d1}/notes/n3.bin`,
        sealedNote(rotated, owner),
      ),
      403,
      'another identity’s device folder',
    );
    await files(owner).write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(rotated, owner),
    );
  });

  it('takes each signed request once, and only within its time window', async () => {
    const { place, startTeam, handle, sent, now } = setUp();
    const { vaultId, at, key } = await startTeam();
    const files = at.transport;
    await files.write(`devices/${dev.d0}/notes/n1.bin`, sealedNote(key, owner));
    const write = sent.at(-1);
    assert.ok(write);
    const replayed = await handle(new Request(write.url, write.init));
    assert.equal(replayed.status, 403);
    assert.equal(await replayed.text(), 'a replayed request');
    await files.list('devices/');
    const listing = sent.at(-1);
    assert.ok(listing);
    assert.equal(
      (await handle(new Request(listing.url, listing.init))).status,
      200,
    );
    const tampered = new Request(
      listing.url.replace('prefix=devices', 'prefix=devices%2Fd0'),
      listing.init,
    );
    assert.notEqual(tampered.url, listing.url);
    assert.equal((await handle(tampered)).status, 401);

    const late = place(owner, vaultId, () => now() - relayRequestWindowMs - 1);
    await refused(late.list.read(), 401);
    const early = place(owner, vaultId, () => now() + relayRequestWindowMs + 1);
    await refused(early.list.read(), 401);
    const close = place(
      owner,
      vaultId,
      () => now() - relayRequestWindowMs + 1000,
    );
    assert.equal((await close.list.read()).length, 1);
  });

  it('refuses a replay for as long as the request’s own time is good', async () => {
    const { place, startTeam, handle, sent, now, tick } = setUp();
    const { vaultId, key } = await startTeam();
    const ahead = place(
      owner,
      vaultId,
      () => now() + relayRequestWindowMs - 1000,
    );
    await ahead.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
    const write = sent.at(-1);
    assert.ok(write);
    tick(relayRequestWindowMs + 2000);
    const replayed = await handle(new Request(write.url, write.init));
    assert.equal(replayed.status, 403);
    assert.equal(await replayed.text(), 'a replayed request');
  });

  it('remembers nonces only for requests it acts on, and caps them per identity', async () => {
    const { place, startTeam, objects, now, tick, signed } = setUp({
      ...defaultLimits,
      liveNonces: 32,
      repairNonces: 4,
    });
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [
          { card: identityCard(reader), role: 'reader' },
          { card: identityCard(admin), role: 'admin' },
        ],
        now(),
      ),
    );
    const noncesPath = `vaults/${vaultId}/nonces.json`;
    const before = Buffer.from(objects.get(noncesPath)?.data ?? []).toString();
    assert.notEqual(before, '');
    for (let count = 0; count < 3; count += 1) {
      await refused(
        place(stranger, vaultId).transport.remove(
          `devices/${dev.d0}/notes/n1.bin`,
        ),
        403,
      );
      await refused(
        place(reader, vaultId).transport.write(
          `devices/${dev.d2}/notes/n1.bin`,
          sealedNote(key, reader),
        ),
        403,
      );
      await refused(
        place(stranger, vaultId).list.append(
          requestRemoveRecord(stranger, await state(), now()),
        ),
        403,
      );
      assert.equal((await signed(reader, vaultId, 'PUT', '')).status, 204);
    }
    assert.equal(
      Buffer.from(objects.get(noncesPath)?.data ?? []).toString(),
      before,
    );
    assert.equal(objects.has(`vaults/${vaultId}/team.json`), false);

    // 32 live nonces in all, 4 from one identity; the owner spent two on the
    // root and the accounts.
    const files = at.transport;
    await files.write(`devices/${dev.d0}/notes/n1.bin`, sealedNote(key, owner));
    await files.write(`devices/${dev.d0}/notes/n2.bin`, sealedNote(key, owner));
    const full = await signed(
      owner,
      vaultId,
      'DELETE',
      `/files/devices/${dev.d0}/notes/n1.bin`,
    );
    assert.equal(full.status, 429);
    assert.equal(full.headers.get('x-relay-refusal'), 'writes');
    assert.equal(await full.text(), 'too many live requests');
    await assert.rejects(
      files.write(`devices/${dev.d0}/notes/n3.bin`, sealedNote(key, owner)),
      /429: it took every change/,
    );
    await place(admin, vaultId).transport.write(
      `devices/${dev.d1}/notes/n1.bin`,
      sealedNote(key, admin),
    );
    assert.equal((await signed(owner, vaultId, 'PUT', '')).status, 204);
    tick(relayRequestWindowMs + 1);
    await files.write(`devices/${dev.d0}/notes/n3.bin`, sealedNote(key, owner));
  });

  it('gives each member a share of the vault’s hour', async () => {
    const { place, startTeam, now, signed } = setUp({
      ...defaultLimits,
      identityWritesPerHour: 2,
    });
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(writer), role: 'writer' }],
        now(),
      ),
    );
    const mine = place(writer, vaultId).transport;
    await mine.write(`devices/${dev.d1}/notes/n1.bin`, sealedNote(key, writer));
    await mine.remove(`devices/${dev.d1}/notes/n1.bin`);
    const spent = await signed(
      writer,
      vaultId,
      'PUT',
      `/files/devices/${dev.d1}/notes/n2.bin`,
      sealedNote(key, writer),
    );
    assert.equal(spent.status, 429);
    assert.equal(spent.headers.get('x-relay-refusal'), 'writes');
    assert.equal(
      await spent.text(),
      'this identity took its share of the hour',
    );
    assert.deepEqual(await mine.list('devices/'), []);
    await at.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
  });

  it('counts the list’s records against the hour, and keeps room for repairs', async () => {
    const limits: Limits = {
      ...defaultLimits,
      writesPerHour: 3,
      managerRecordsPerHour: 2,
    };
    const { place, startTeam, now, objects, signed } = setUp(limits);
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [
          { card: identityCard(admin), role: 'admin' },
          { card: identityCard(writer), role: 'writer' },
        ],
        now(),
      ),
    );
    const asAdmin = place(admin, vaultId);
    await asAdmin.list.append(
      inviteRecord(admin, await state(), key, 'reader', true, now()).record,
    );
    await place(writer, vaultId).transport.write(
      `devices/${dev.d1}/notes/n1.bin`,
      sealedNote(key, writer),
    );
    const hourSpent = await signed(
      admin,
      vaultId,
      'PUT',
      '/acl',
      Buffer.from(
        JSON.stringify(
          inviteRecord(admin, await state(), key, 'reader', true, now()).record,
        ),
      ),
    );
    assert.equal(hourSpent.status, 429);
    assert.equal(hourSpent.headers.get('x-relay-refusal'), 'writes');
    assert.equal(
      await hourSpent.text(),
      'the vault took every write it allows this hour',
    );
    const rotated = keyChangeRecord(admin, await state(), key, now());
    await asAdmin.list.append(rotated.record);
    const next: CurrentKey = {
      keyId:
        rotated.record.body.type === 'keyChange'
          ? rotated.record.body.keyChange.keyId
          : '',
      rootKey: rotated.rootKey,
    };
    await refused(
      asAdmin.list.append(
        keyChangeRecord(admin, await state(), next, now()).record,
      ),
      429,
      'too many records from this identity this hour',
    );
    const live: unknown = JSON.parse(
      Buffer.from(
        objects.get(`vaults/${vaultId}/nonces.json`)?.data ?? [],
      ).toString(),
    );
    assert.equal(
      (Array.isArray(live) ? live : []).filter(
        (entry: unknown) => Reflect.get(Object(entry), 'by') === hex(admin),
      ).length,
      2,
    );

    const acl = objects.get(`vaults/${vaultId}/acl.json`);
    assert.ok(acl);
    limits.listReserveBytes = 64 * 1024;
    limits.listBytes = acl.data.length + 64 * 1024 - 1;
    limits.writesPerHour = 100;
    const before = (await at.list.read()).length;
    await refused(
      at.list.append(
        inviteRecord(owner, await state(), next, 'reader', true, now()).record,
      ),
      507,
      'the list keeps its last room for repairs',
    );
    await refused(
      place(writer, vaultId).list.append(
        requestRemoveRecord(writer, await state(), now()),
      ),
      507,
      'the list keeps its last room for repairs',
    );
    const removed = accountsRemoveRecord(
      owner,
      await state(),
      next,
      [hex(writer)],
      now(),
    );
    await at.list.append(removed.record);
    assert.equal((await at.list.read()).length, before + 1);
    limits.listBytes = acl.data.length;
    await refused(
      at.list.append(keyChangeRecord(owner, await state(), next, now()).record),
      507,
      'the list is full',
    );
  });

  it('refuses a write whose list moved to a new key while it was on its way', async () => {
    let armed = false;
    let rotate = async () => {};
    const { place, startTeam, now, objects, tick } = setUp(
      defaultLimits,
      async (pathname) => {
        if (armed && pathname.endsWith('index.json')) {
          armed = false;
          await rotate();
        }
      },
    );
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(writer), role: 'writer' }],
        now(),
      ),
    );
    const mine = place(writer, vaultId).transport;
    await mine.write(`devices/${dev.d1}/notes/n1.bin`, sealedNote(key, writer));
    const stored = objects.get(
      `vaults/${vaultId}/files/devices/${dev.d1}/notes/n1.bin`,
    );
    const entryOf = (): unknown => {
      const raw: unknown = JSON.parse(
        Buffer.from(
          objects.get(`vaults/${vaultId}/index.json`)?.data ?? [],
        ).toString(),
      );
      return Reflect.get(
        Object(Reflect.get(Object(raw), 'files')),
        `devices/${dev.d1}/notes/n1.bin`,
      );
    };
    const before = entryOf();
    tick(1000);
    const current = await state();
    rotate = async () => {
      await at.list.append(keyChangeRecord(owner, current, key, now()).record);
    };
    armed = true;
    await refused(
      mine.write(
        `devices/${dev.d1}/notes/n1.bin`,
        sealedNote(key, writer, 'late'),
      ),
      409,
      'sealed under a retired key',
    );
    armed = true;
    rotate = async () => {};
    await refused(
      mine.write(`devices/${dev.d1}/notes/n2.bin`, sealedNote(key, writer)),
      409,
      'sealed under a retired key',
    );
    assert.equal(
      objects.get(`vaults/${vaultId}/files/devices/${dev.d1}/notes/n1.bin`),
      stored,
    );
    const listed = await at.transport.list('devices/');
    assert.deepEqual(
      listed.map((file) => file.path),
      [`devices/${dev.d1}/notes/n1.bin`],
    );
    const index: unknown = JSON.parse(
      Buffer.from(
        objects.get(`vaults/${vaultId}/index.json`)?.data ?? [],
      ).toString(),
    );
    const entry: unknown = Reflect.get(
      Object(Reflect.get(Object(index), 'files')),
      `devices/${dev.d1}/notes/n1.bin`,
    );
    assert.equal(Reflect.has(Object(entry), 'pending'), false);
    assert.deepEqual(entryOf(), before);
  });

  it('lets go of a folder a refused write had just bound', async () => {
    let armed = false;
    let removal = async () => {};
    const { place, startTeam, now, objects } = setUp(
      defaultLimits,
      async (pathname) => {
        if (armed && pathname.endsWith('index.json')) {
          armed = false;
          await removal();
        }
      },
    );
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(writer), role: 'writer' }],
        now(),
      ),
    );
    const current = await state();
    let next: CurrentKey = key;
    removal = async () => {
      const removed = accountsRemoveRecord(
        owner,
        current,
        key,
        [hex(writer)],
        now(),
      );
      await at.list.append(removed.record);
      next = {
        keyId:
          removed.record.body.type === 'accountsRemove'
            ? removed.record.body.keyChange.keyId
            : '',
        rootKey: removed.rootKey,
      };
    };
    armed = true;
    await refused(
      place(writer, vaultId).transport.write(
        `devices/${dev.d2}/notes/n1.bin`,
        sealedNote(key, writer),
      ),
      403,
      'not a member',
    );
    const index: unknown = JSON.parse(
      Buffer.from(
        objects.get(`vaults/${vaultId}/index.json`)?.data ?? [],
      ).toString(),
    );
    assert.deepEqual(Reflect.get(Object(index), 'bindings'), {});
    assert.deepEqual(Reflect.get(Object(index), 'files'), {});
    await at.transport.write(
      `devices/${dev.d2}/notes/n1.bin`,
      sealedNote(next, owner),
    );
  });

  it('keeps the last live nonces for an owner’s or admin’s repair, and takes no body on a delete', async () => {
    const { place, startTeam, now, tick, signed } = setUp({
      ...defaultLimits,
      liveNonces: 16,
      repairNonces: 10,
    });
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [
          { card: identityCard(writer), role: 'writer' },
          { card: identityCard(another), role: 'writer' },
          { card: identityCard(admin), role: 'admin' },
        ],
        now(),
      ),
    );
    tick(relayRequestWindowMs + 1);
    const folders: Array<[Identity, string]> = [
      [writer, dev.d1],
      [another, dev.d2],
      [admin, dev.dx],
    ];
    for (const [who, device] of folders) {
      for (const note of ['n1', 'n2']) {
        await place(who, vaultId).transport.write(
          `devices/${device}/notes/${note}.bin`,
          sealedNote(key, who),
        );
      }
    }
    await refused(
      at.transport.write(
        `devices/${dev.d0}/notes/n1.bin`,
        sealedNote(key, owner),
      ),
      429,
      'too many live requests',
    );
    await at.list.append(
      accountsRemoveRecord(owner, await state(), key, [hex(writer)], now())
        .record,
    );
    const withBody = await signed(
      admin,
      vaultId,
      'DELETE',
      `/files/devices/${dev.dx}/notes/n1.bin`,
      Buffer.from('x'),
    );
    assert.equal(withBody.status, 413);
  });

  it('keeps no nonce for a request the hour refused, and turns away what it can before reading', async () => {
    const { place, startTeam, now, objects, signed, handle } = setUp({
      ...defaultLimits,
      identityWritesPerHour: 4,
    });
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(writer), role: 'writer' }],
        now(),
      ),
    );
    const mine = place(writer, vaultId).transport;
    for (const note of ['n1', 'n2', 'n3', 'n4']) {
      await mine.write(
        `devices/${dev.d1}/notes/${note}.bin`,
        sealedNote(key, writer),
      );
    }
    for (const note of ['n5', 'n6', 'n7']) {
      await refused(
        mine.write(
          `devices/${dev.d1}/notes/${note}.bin`,
          sealedNote(key, writer),
        ),
        429,
        'this identity took its share of the hour',
      );
    }
    await refused(
      mine.remove(`devices/${dev.d1}/notes/n1.bin`),
      429,
      'this identity took its share of the hour',
    );
    const live: unknown = JSON.parse(
      Buffer.from(
        objects.get(`vaults/${vaultId}/nonces.json`)?.data ?? [],
      ).toString(),
    );
    assert.equal(
      (Array.isArray(live) ? live : []).filter(
        (entry: unknown) => Reflect.get(Object(entry), 'by') === hex(writer),
      ).length,
      4,
    );
    await at.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
    const removal = new URL(
      `${host}v1/vaults/${vaultId}/files/devices/${dev.d0}/notes/n1.bin`,
    );
    const authorization = signRelayRequest(
      owner,
      {
        host: removal.host,
        method: 'DELETE',
        path: removal.pathname,
        vaultId,
        body: null,
      },
      now(),
    );
    const removeOnce = () =>
      handle(
        new Request(removal, { method: 'DELETE', headers: { authorization } }),
      );
    assert.equal((await removeOnce()).status, 204);
    await at.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
    const again = await removeOnce();
    assert.equal(again.status, 403);
    assert.equal(await again.text(), 'a replayed request');
    const path = `/files/devices/${dev.d2}/notes/n1.bin`;
    const outsider = await signed(
      stranger,
      vaultId,
      'PUT',
      path,
      new Uint8Array(5 * 1024 * 1024),
    );
    assert.equal(outsider.status, 403);
    assert.equal(await outsider.text(), 'not a member');
    const posted = await signed(
      owner,
      vaultId,
      'POST',
      path,
      new Uint8Array(5 * 1024 * 1024),
    );
    assert.equal(posted.status, 405);
  });

  it('keeps cached lists within a size, dropping the least recently used', async () => {
    const { startTeam, reads, objects } = setUp({
      ...defaultLimits,
      teamCacheBytes: 1000,
    });
    const first = await startTeam();
    const second = await startTeam();
    for (const team of [first, second]) {
      assert.equal(
        objects.get(`vaults/${team.vaultId}/acl.json`)?.data.length,
        585,
      );
    }
    const aclReads = (vaultId: string) =>
      reads.filter((pathname) => pathname === `vaults/${vaultId}/acl.json`)
        .length;
    await first.at.transport.list('devices/');
    await second.at.transport.list('devices/');
    reads.length = 0;
    await second.at.transport.list('devices/');
    assert.equal(aclReads(second.vaultId), 0);
    await first.at.transport.list('devices/');
    assert.equal(aclReads(first.vaultId), 1);
    await first.at.transport.list('devices/');
    assert.equal(aclReads(first.vaultId), 1);
    await second.at.transport.list('devices/');
    assert.equal(aclReads(second.vaultId), 1);
  });

  it('remembers for a moment that an id names no team', async () => {
    const { place, handle, reads, tick } = setUp();
    const root = rootRecord(owner, start);
    const vaultId = teamVaultIdOf(root.record);
    const count = (name: string) =>
      reads.filter((pathname) => pathname === `vaults/${vaultId}/${name}`)
        .length;
    const at = place(owner, vaultId);
    await assert.rejects(at.list.read(), /isn’t on this relay/);
    await assert.rejects(at.list.read(), /isn’t on this relay/);
    assert.equal(count('acl.json'), 1);
    const invite = `${host}v1/vaults/${vaultId}/invites/${'a'.repeat(32)}`;
    assert.equal((await handle(new Request(invite))).status, 404);
    assert.equal(count('team.json'), 0);
    tick(10_001);
    await assert.rejects(at.list.read(), /isn’t on this relay/);
    assert.equal(count('acl.json'), 2);
    assert.equal((await handle(new Request(invite))).status, 404);
    assert.equal((await handle(new Request(invite))).status, 404);
    assert.equal(count('team.json'), 0);
    await at.list.append(root.record);
    assert.deepEqual(await at.list.read(), [root.record]);
    tick(10_001);
    assert.equal((await handle(new Request(invite))).status, 404);
    assert.equal((await handle(new Request(invite))).status, 404);
    assert.equal(count('team.json'), 1);
  });

  it('keeps a token and an identity each to their own kind of vault', async () => {
    const { startTeam, handle, signed, objects } = setUp();
    const { vaultId } = await startTeam();
    const vaultKey = randomBytes(32);
    const tokenVault = vaultIdOf(vaultKey);
    const token = relayToken(vaultKey);
    const asToken = (id: string, method: string, path: string, body?: string) =>
      handle(
        new Request(`${host}v1/vaults/${id}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}` },
          ...(body ? { body } : {}),
        }),
      );
    assert.equal((await asToken(tokenVault, 'PUT', '')).status, 204);
    assert.equal(
      (
        await asToken(
          tokenVault,
          'PUT',
          '/files/devices/a/meetings/m1.bin',
          'x',
        )
      ).status,
      204,
    );
    const before = new Map(objects);
    const note = `/files/devices/${dev.d0}/notes/n1.bin`;
    for (const [method, path, status] of [
      ['PUT', '', 403],
      ['GET', '/files', 403],
      ['GET', note, 403],
      ['PUT', note, 403],
      ['DELETE', note, 403],
      ['GET', '/acl', 401],
      ['PUT', '/acl', 401],
      ['PUT', `/invites/${'a'.repeat(32)}`, 401],
    ] satisfies Array<[string, string, number]>) {
      assert.equal(
        (
          await asToken(
            vaultId,
            method,
            path,
            method === 'PUT' ? 'x' : undefined,
          )
        ).status,
        status,
        `${method} ${path}`,
      );
    }
    const meeting = '/files/devices/a/meetings/m1.bin';
    for (const [method, path, status] of [
      ['PUT', '', 404],
      ['GET', '/files', 404],
      ['GET', meeting, 404],
      ['PUT', meeting, 404],
      ['DELETE', meeting, 404],
      ['GET', '/acl', 404],
    ] satisfies Array<[string, string, number]>) {
      assert.equal(
        (
          await signed(
            owner,
            tokenVault,
            method,
            path,
            method === 'PUT' && path !== '' ? Buffer.from('x') : undefined,
          )
        ).status,
        status,
        `${method} ${path}`,
      );
    }
    const root = await signed(
      owner,
      tokenVault,
      'PUT',
      '/acl',
      Buffer.from(JSON.stringify(rootRecord(owner, start).record)),
    );
    assert.equal(root.status, 400);
    assert.deepEqual(new Map(objects), before);
  });

  it('keeps a team when its index is lost', async () => {
    const { place, startTeam, objects, tick } = setUp({
      ...defaultLimits,
      newVaults: {
        perHour: 1,
        perAddressPerHour: 100,
        perWideNetworkPerHour: 100,
      },
    });
    const { vaultId, at, key } = await startTeam();
    await at.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
    objects.delete(`vaults/${vaultId}/index.json`);
    tick(60 * 60 * 1000);
    const other = rootRecord(admin, start);
    await place(admin, teamVaultIdOf(other.record)).list.append(other.record);

    await at.transport.write(
      `devices/${dev.d0}/notes/n2.bin`,
      sealedNote(key, owner),
    );
    const index: unknown = JSON.parse(
      Buffer.from(
        objects.get(`vaults/${vaultId}/index.json`)?.data ?? [],
      ).toString(),
    );
    assert.equal(Reflect.get(Object(index), 'team'), true);
  });

  it('lets nobody write or delete in a folder whose owner it can’t tell', async () => {
    const { place, startTeam, objects, now } = setUp();
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(admin), role: 'admin' }],
        now(),
      ),
    );
    await at.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
    const indexPath = `vaults/${vaultId}/index.json`;
    const stored = objects.get(indexPath);
    assert.ok(stored);
    const raw: unknown = JSON.parse(Buffer.from(stored.data).toString());
    objects.set(`vaults/${vaultId}/files/devices/${dev.dx}/notes/x.bin`, {
      data: Buffer.from('not a signed file'),
      version: 'vx',
    });
    objects.set(indexPath, {
      data: Buffer.from(
        JSON.stringify({
          ...Object(raw),
          bindings: {},
          files: {
            ...Object(Reflect.get(Object(raw), 'files')),
            [`devices/${dev.dx}/notes/x.bin`]: {
              version: 'vx',
              changedAt: start,
              size: 17,
            },
          },
        }),
      ),
      version: 'vy',
    });
    for (const who of [owner, admin]) {
      await refused(
        place(who, vaultId).transport.remove(`devices/${dev.dx}/notes/x.bin`),
        403,
        'another identity’s device folder',
      );
      await refused(
        place(who, vaultId).transport.write(
          `devices/${dev.dx}/notes/y.bin`,
          sealedNote(key, who),
        ),
        403,
        'another identity’s device folder',
      );
    }
    await at.transport.remove(`devices/${dev.d0}/notes/n1.bin`);
  });

  it('reads the list again only when it changed', async () => {
    const { startTeam, reads, now, objects } = setUp();
    const { vaultId, at, key, state } = await startTeam();
    const aclReads = () =>
      reads.filter((pathname) => pathname === `vaults/${vaultId}/acl.json`)
        .length;
    reads.length = 0;
    await at.transport.list('devices/');
    await at.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
    await at.transport.read(`devices/${dev.d0}/notes/n1.bin`, 10_000);
    assert.equal(aclReads(), 0);
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(reader), role: 'reader' }],
        now(),
      ),
    );
    const acl = objects.get(`vaults/${vaultId}/acl.json`);
    assert.ok(acl);
    objects.set(`vaults/${vaultId}/acl.json`, {
      data: acl.data,
      version: 'written elsewhere',
    });
    reads.length = 0;
    await at.transport.list('devices/');
    await at.transport.list('devices/');
    assert.equal(aclReads(), 1);
  });
});

function parseIndexOf(stored: { data: Uint8Array } | undefined): unknown {
  const raw: unknown = JSON.parse(Buffer.from(stored?.data ?? []).toString());
  return Reflect.get(Object(raw), 'files');
}
