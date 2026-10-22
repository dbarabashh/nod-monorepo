import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bytesOf, fileKeyOf, randomKey, vaultIdOf } from '../crypto/index.ts';
import type { Merged } from '../meetings/index.ts';
import { createSyncEngine } from './engine.ts';
import { meetingPath } from './layout.ts';
import { createRelayTransport } from './relay.ts';
import { guardedRound } from './round.ts';
import { Throttled } from './transport.ts';

const waiting =
  'The relay answered 429: it asked this device to wait, sync will try again later';

describe('a round against a relay that asked to wait', () => {
  const key = randomKey();
  const vault = {
    fileKey: fileKeyOf(key),
    id: vaultIdOf(key),
    deviceId: 'phone',
  };
  const laptopFile = meetingPath('laptop', 'm-1');
  const nothing: Merged = {
    state: null,
    written: Promise.resolve(null),
    kept: false,
  };

  // Lists one file of another device, and refuses to send it.
  function relay() {
    const clock = { at: 1_000 };
    const requests: string[] = [];
    const transport = createRelayTransport({
      url: 'https://relay.example.com',
      vaultId: vault.id,
      token: 'token',
      now: () => clock.at,
      fetch: async (url) => {
        const listing = url.includes('/files?prefix=');
        requests.push(listing ? 'list' : 'read');
        const body = listing
          ? bytesOf(
              JSON.stringify([
                { path: laptopFile, version: 'v1', changedAt: 1 },
              ]),
            )
          : new Uint8Array(0);
        return {
          status: listing ? 200 : 429,
          ok: listing,
          headers: {
            get: (name) => (name === 'etag' && listing ? '"l1"' : null),
          },
          body: null,
          arrayBuffer: async () => body.slice().buffer,
        };
      },
    });
    const engine = createSyncEngine({
      transport,
      vault: { id: vault.id, key, deviceId: vault.deviceId },
      store: { ids: () => [], document: () => undefined, merge: () => nothing },
      onRemote: () => {},
      now: () => clock.at,
    });
    const round = () =>
      guardedRound({ transport, engine, checked: new Map() }, vault);
    return { round, engine, clock, requests };
  }

  it('makes no request, not even the listing, until the wait is over', async () => {
    const at = relay();

    assert.equal(await at.round(), 'synced');
    assert.deepEqual(at.requests, ['list', 'read']);
    assert.equal(at.engine.status().error, waiting);

    at.clock.at = 1_000 + 15_000;
    await assert.rejects(
      at.round(),
      (error: unknown) =>
        error instanceof Throttled && error.message === waiting,
    );
    at.clock.at = 1_000 + 59_999;
    await assert.rejects(at.round(), Throttled);
    assert.deepEqual(at.requests, ['list', 'read']);

    at.clock.at = 1_000 + 60_000;
    assert.equal(await at.round(), 'synced');
    assert.deepEqual(at.requests, ['list', 'read', 'list', 'read']);
    assert.equal(at.engine.status().error, waiting);
  });
});
