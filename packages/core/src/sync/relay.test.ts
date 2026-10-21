import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createRelayTransport, type Fetch } from './relay.ts';
import { WritesRefused } from './transport.ts';

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

describe('relay refusals', () => {
  const refusing =
    (status: number): Fetch =>
    async () => ({
      status,
      ok: false,
      headers: { get: () => null },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
  const at = (status: number) =>
    createRelayTransport({
      url: 'https://relay.example.com',
      vaultId: 'vault-1',
      token: 'token',
      fetch: refusing(status),
    });

  it('marks a refused write for the whole vault, so the round stops writing', async () => {
    for (const status of [429, 507]) {
      await assert.rejects(
        at(status).write('devices/a/meetings/m.bin', new Uint8Array(1)),
        (error: unknown) => error instanceof WritesRefused,
      );
    }
  });

  it('keeps other failures, and refused reads, as plain errors', async () => {
    await assert.rejects(
      at(409).write('devices/a/meetings/m.bin', new Uint8Array(1)),
      (error: unknown) =>
        error instanceof Error && !(error instanceof WritesRefused),
    );
    await assert.rejects(
      at(429).read('devices/a/meetings/m.bin', 10),
      (error: unknown) =>
        error instanceof Error && !(error instanceof WritesRefused),
    );
  });
});
