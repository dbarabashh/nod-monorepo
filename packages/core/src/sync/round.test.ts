import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bytesOf, fileKeyOf, randomKey, vaultIdOf } from '../crypto/index.ts';
import type { Merged } from '../meetings/index.ts';
import { composeEngines, createSyncEngine } from './engine.ts';
import { closedPath, meetingPath } from './layout.ts';
import { sealClosedNotice } from './closing.ts';
import { createMemoryTransport } from './testing/index.ts';
import { createRelayTransport } from './relay.ts';
import { guardedRound } from './round.ts';
import { Throttled } from './transport.ts';

const waiting =
  'The relay answered 429: it asked this device to wait, sync will try again in about a minute';

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

describe('a round with several kinds of document in one vault', () => {
  function stubEngine(outcome: { error: string | null } = { error: null }) {
    const listings: number[] = [];
    return {
      listings,
      engine: {
        sync: async (listed?: unknown[]) => {
          listings.push(listed?.length ?? -1);
        },
        status: () => ({
          lastSyncedAt: outcome.error ? null : 5,
          devices: outcome.error ? 0 : 2,
          error: outcome.error,
        }),
        merged: (path: string) =>
          path === 'devices/d2/shares.bin' && !outcome.error ? 'v7' : undefined,
        stop: () => {},
        forget: () => {},
      },
    };
  }

  it('hands every engine the one listing, and none of them a closed vault', async () => {
    const key = randomKey();
    const vault = {
      fileKey: fileKeyOf(key),
      id: vaultIdOf(key),
      deviceId: 'd1',
    };
    const transport = createMemoryTransport();
    await transport.write(meetingPath('d2', 'm-1'), bytesOf('x'));
    const main = stubEngine();
    const shares = stubEngine();
    const engine = composeEngines([main.engine, shares.engine]);
    assert.equal(
      await guardedRound({ transport, engine, checked: new Map() }, vault),
      'synced',
    );
    assert.deepEqual(main.listings, [1]);
    assert.deepEqual(shares.listings, [1]);

    await transport.write(closedPath('d2'), bytesOf('not a notice'));
    assert.equal(
      await guardedRound({ transport, engine, checked: new Map() }, vault),
      'synced',
    );
    await transport.write(
      closedPath('d2'),
      sealClosedNotice(vault.fileKey, vault.id, 'd2', 1),
    );
    assert.equal(
      await guardedRound({ transport, engine, checked: new Map() }, vault),
      'closed',
    );
    assert.deepEqual(shares.listings, [1, 2]);
  });

  it('shows the first engine’s round and devices, and any engine’s error', () => {
    const main = stubEngine();
    const shares = stubEngine({ error: 'The relay answered 400' });
    const engine = composeEngines([main.engine, shares.engine]);
    assert.deepEqual(engine.status(), {
      lastSyncedAt: 5,
      devices: 2,
      error: 'The relay answered 400',
    });
    assert.equal(engine.merged('devices/d2/shares.bin'), 'v7');
    assert.equal(engine.merged('devices/d2/meetings/m-1.bin'), undefined);
    assert.deepEqual(composeEngines([shares.engine, main.engine]).status(), {
      lastSyncedAt: null,
      devices: 0,
      error: 'The relay answered 400',
    });
  });
});
