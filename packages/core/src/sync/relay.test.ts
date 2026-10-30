import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  createRelayRequester,
  createRelayTransport,
  relayTransportOver,
  retryAfterOf,
  throttledMessage,
  type Fetch,
} from './relay.ts';
import { Throttled, WritesRefused } from './transport.ts';

// A response without a body stream, as some fetch implementations give.
function whole(data: Uint8Array, status = 200): Fetch {
  return async () => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    body: null,
    arrayBuffer: async () => data.slice().buffer,
  });
}

describe('relay transport without a body stream', () => {
  const at = (fetch: Fetch) =>
    createRelayTransport({
      url: 'https://relay.example.com',
      vaultId: 'vault-1',
      token: 'token',
      fetch,
    });

  it('reads the whole reply instead', async () => {
    const data = await at(whole(new Uint8Array([1, 2, 3]))).read(
      'devices/a/meetings/m.bin',
      3,
    );
    assert.deepEqual([...(data ?? [])], [1, 2, 3]);
  });

  it('still refuses a reply larger than the caller allows', async () => {
    await assert.rejects(
      at(whole(new Uint8Array(4))).read('devices/a/meetings/m.bin', 3),
      /more than expected/,
    );
  });
});

describe('identity-signed relay requests', () => {
  it('signs the path with its query and the body, and sends no bearer token', async () => {
    const signed: Array<{ method: string; path: string; body: number }> = [];
    const sent: Array<Record<string, string>> = [];
    const fetch: Fetch = async (_url, init) => {
      sent.push(init.headers);
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        body: null,
        arrayBuffer: async () => new TextEncoder().encode('[]').buffer,
      };
    };
    const transport = relayTransportOver(
      createRelayRequester({
        url: 'https://relay.example.com/sync',
        vaultId: 'ab'.repeat(16),
        fetch,
        authorization: {
          kind: 'identity',
          sign: (request) => {
            signed.push({
              method: request.method,
              path: request.path,
              body: request.body?.length ?? -1,
            });
            return 'Nod-Identity signed';
          },
        },
      }),
    );
    await transport.list('devices/');
    await transport.write('devices/d/notes/n.bin', new Uint8Array(3));
    assert.deepEqual(signed, [
      {
        method: 'GET',
        path: `/sync/v1/vaults/${'ab'.repeat(16)}/files?prefix=devices%2F`,
        body: -1,
      },
      {
        method: 'PUT',
        path: `/sync/v1/vaults/${'ab'.repeat(16)}/files/devices/d/notes/n.bin`,
        body: 3,
      },
    ]);
    assert.deepEqual(
      sent.map((headers) => headers.authorization),
      ['Nod-Identity signed', 'Nod-Identity signed'],
    );
  });
});

describe('relay refusals', () => {
  const refusing =
    (status: number, headers: Record<string, string> = {}): Fetch =>
    async () => ({
      status,
      ok: false,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
  const at = (status: number, headers?: Record<string, string>) =>
    createRelayTransport({
      url: 'https://relay.example.com',
      vaultId: 'vault-1',
      token: 'token',
      fetch: refusing(status, headers),
    });
  const path = 'devices/a/meetings/m.bin';

  it('marks a full vault for the round, so it stops writing', async () => {
    await assert.rejects(
      at(507).write(path, new Uint8Array(1)),
      (error: unknown) => error instanceof WritesRefused,
    );
  });

  it('asks the round to wait on a rate limit, reading or writing', async () => {
    await assert.rejects(
      at(429).write(path, new Uint8Array(1)),
      (error: unknown) =>
        error instanceof Throttled &&
        error.retryAfterMs === 60_000 &&
        error.message ===
          'The relay answered 429: it asked this device to wait, sync will try again in about a minute',
    );
    await assert.rejects(
      at(429, { 'retry-after': '5' }).read(path, 10),
      (error: unknown) =>
        error instanceof Throttled && error.retryAfterMs === 5_000,
    );
    await assert.rejects(
      at(429).list('devices/'),
      (error: unknown) => error instanceof Throttled,
    );
  });

  it('names an outdated relay as well as the clock when it refuses the device', async () => {
    await assert.rejects(at(401).read(path, 10), {
      message:
        'The relay answered 401: it didn’t accept this device; the relay may be older than this version of Nod, or this device’s clock may be off',
    });
  });

  it('keeps other failures, and a full vault on a read, as plain errors', async () => {
    for (const refused of [
      at(409).write(path, new Uint8Array(1)),
      at(507).read(path, 10),
    ]) {
      await assert.rejects(
        refused,
        (error: unknown) =>
          error instanceof Error &&
          !(error instanceof WritesRefused) &&
          !(error instanceof Throttled),
      );
    }
  });
});

describe('the wait a relay names', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it('is taken in seconds or as a date, between five seconds and ten minutes', () => {
    assert.equal(retryAfterOf('7', now), 7_000);
    assert.equal(retryAfterOf(' 7 ', now), 7_000);
    assert.equal(retryAfterOf('0', now), 5_000);
    assert.equal(retryAfterOf('2', now), 5_000);
    assert.equal(retryAfterOf('Thu, 01 Jan 2026 12:00:30 GMT', now), 30_000);
    assert.equal(retryAfterOf('100000', now), 600_000);
  });

  it('is a minute when the relay names none, or one that makes no sense', () => {
    assert.equal(retryAfterOf(null, now), 60_000);
    assert.equal(retryAfterOf('', now), 60_000);
    assert.equal(retryAfterOf('soon', now), 60_000);
    assert.equal(retryAfterOf('-1', now), 60_000);
    assert.equal(retryAfterOf('Thu, 01 Jan 2026 11:57:00 GMT', now), 60_000);
  });
});

describe('what a device says while it waits', () => {
  it('names the time left, roughly', () => {
    assert.equal(
      throttledMessage(1),
      'The relay answered 429: it asked this device to wait, sync will try again in a moment',
    );
    assert.equal(
      throttledMessage(44_999),
      'The relay answered 429: it asked this device to wait, sync will try again in a moment',
    );
    assert.equal(
      throttledMessage(45_000),
      'The relay answered 429: it asked this device to wait, sync will try again in about a minute',
    );
    assert.equal(
      throttledMessage(89_999),
      'The relay answered 429: it asked this device to wait, sync will try again in about a minute',
    );
    assert.equal(
      throttledMessage(90_000),
      'The relay answered 429: it asked this device to wait, sync will try again in about 2 minutes',
    );
    assert.equal(
      throttledMessage(600_000),
      'The relay answered 429: it asked this device to wait, sync will try again in about 10 minutes',
    );
    for (const odd of [-1, Number.NaN]) {
      assert.equal(
        throttledMessage(odd),
        'The relay answered 429: it asked this device to wait, sync will try again in a moment',
      );
    }
  });
});

describe('a relay that asked to wait', () => {
  const waiting =
    'The relay answered 429: it asked this device to wait, sync will try again in a moment';
  const path = 'devices/a/meetings/m.bin';

  function relay(answers: () => number, retryAfter: string | null) {
    const clock = { at: 1_000 };
    let calls = 0;
    const transport = createRelayTransport({
      url: 'https://relay.example.com',
      vaultId: 'vault-1',
      token: 'token',
      now: () => clock.at,
      fetch: async () => {
        calls += 1;
        const status = answers();
        return {
          status,
          ok: status === 200,
          headers: {
            get: (name) =>
              name.toLowerCase() === 'retry-after' && status === 429
                ? retryAfter
                : null,
          },
          body: null,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        };
      },
    });
    return { transport, clock, calls: () => calls };
  }

  it('sends nothing until the wait is over, then asks again', async () => {
    let status = 429;
    const at = relay(() => status, '7');
    await assert.rejects(
      at.transport.read(path, 10),
      (error: unknown) =>
        error instanceof Throttled && error.retryAfterMs === 7_000,
    );
    assert.equal(at.calls(), 1);

    at.clock.at = 1_000 + 6_999;
    for (const request of [
      () => at.transport.read(path, 10),
      () => at.transport.list('devices/'),
      () => at.transport.write(path, new Uint8Array(1)),
      () => at.transport.remove(path),
      () => at.transport.register(),
    ]) {
      await assert.rejects(
        request(),
        (error: unknown) =>
          error instanceof Throttled &&
          error.retryAfterMs === 1 &&
          error.message === waiting,
      );
    }
    assert.equal(at.calls(), 1);

    status = 200;
    at.clock.at = 1_000 + 7_000;
    assert.deepEqual([...((await at.transport.read(path, 10)) ?? [])], [1]);
    assert.equal(at.calls(), 2);
  });

  it('keeps the relay’s own limit on writes to writes, and reads on', async () => {
    let calls = 0;
    const transport = createRelayTransport({
      url: 'https://relay.example.com',
      vaultId: 'vault-1',
      token: 'token',
      fetch: async (_url, init) => {
        calls += 1;
        const refused = init.method === 'PUT';
        return {
          status: refused ? 429 : 200,
          ok: !refused,
          headers: {
            get: (name) =>
              refused && name.toLowerCase() === 'x-relay-refusal'
                ? 'writes'
                : null,
          },
          body: null,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        };
      },
    });
    await assert.rejects(
      transport.write(path, new Uint8Array(1)),
      (error: unknown) =>
        error instanceof WritesRefused &&
        error.message ===
          'The relay answered 429: it took every change it allows for now, sync will try again later',
    );
    assert.deepEqual([...((await transport.read(path, 10)) ?? [])], [1]);
    assert.equal(calls, 2);
  });

  it('forgets a wait that a clock jumping back would stretch past ten minutes', async () => {
    const at = relay(() => 429, null);
    await assert.rejects(at.transport.read(path, 10), Throttled);
    at.clock.at = 1_000 - 9 * 60_000;
    await assert.rejects(at.transport.read(path, 10), Throttled);
    assert.equal(at.calls(), 1);

    at.clock.at = 1_000 - 9 * 60_000 - 1;
    await assert.rejects(at.transport.read(path, 10), Throttled);
    assert.equal(at.calls(), 2);
  });
});
