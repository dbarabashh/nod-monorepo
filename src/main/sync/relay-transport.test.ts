import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { createRelay } from '../../../relay/server.ts';
import {
  editSummary,
  setSummary,
  startMeeting,
  type DocumentState,
} from '../../core/meetings/index.ts';
import { createMeetingStore } from '../meetings/store.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createSyncEngine } from '../../core/sync/index.ts';
import {
  commitmentOf,
  createPairingKeys,
  relayToken,
} from '../../core/crypto/index.ts';
import { createRelayTransport, relayBase } from './relay-transport.ts';

describe('relay transport', () => {
  const dir = useTempDir('relay-');
  let url = '';
  let close = () => {};

  async function startRelay() {
    const server = createRelay(join(dir(), 'relay'));
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address: AddressInfo | string | null = server.address();
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    close = () => server.close();
  }

  afterEach(() => close());

  const transport = (token: string | null, vaultId = 'vault-1') =>
    createRelayTransport({
      url,
      vaultId,
      token,
      fetch: (input, init) => fetch(input, init),
    });

  it('keeps a vault to the devices that hold its key', async () => {
    await startRelay();
    const key = randomBytes(32);
    const owner = transport(relayToken(key));
    await owner.register();
    await owner.write('devices/a/meetings/m1.bin', Buffer.from('sealed'));

    assert.deepEqual(
      (await owner.list('devices/')).map((file) => file.path),
      ['devices/a/meetings/m1.bin'],
    );
    assert.deepEqual(
      Buffer.from(
        (await owner.read('devices/a/meetings/m1.bin', 1_000_000)) ?? [],
      ),
      Buffer.from('sealed'),
    );
    await assert.rejects(transport(null).list('devices/'), /401/);
    await assert.rejects(
      transport(relayToken(randomBytes(32))).read(
        'devices/a/meetings/m1.bin',
        1_000_000,
      ),
      /401/,
    );
    await assert.rejects(
      transport(relayToken(randomBytes(32))).register(),
      /403/,
    );
  });

  it('lets a new device post only its request and reveal, once each, without the key', async () => {
    await startRelay();
    const owner = transport(relayToken(randomBytes(32)));
    await owner.register();
    const stranger = transport(null);
    await stranger.write(
      'pairing/r1/request.json',
      Buffer.from('{"commitment":"x"}'),
    );
    assert.deepEqual(
      (await stranger.list('pairing/')).map((file) => file.path),
      ['pairing/r1/request.json'],
    );
    await assert.rejects(
      stranger.write('pairing/r1/request.json', Buffer.from('{}')),
      /409/,
    );
    await assert.rejects(
      stranger.write('pairing/r1/offer.json', Buffer.from('{}')),
      /401/,
    );
    await assert.rejects(
      stranger.write('pairing/r1/grant.json', Buffer.from('{}')),
      /401/,
    );
    await assert.rejects(stranger.remove('pairing/r1/request.json'), /401/);
    await assert.rejects(
      stranger.write('pairing/r1/reveal.json', randomBytes(8 * 1024)),
      /413/,
    );
    await assert.rejects(
      stranger.write('pairing/r1/other.json', Buffer.from('{}')),
      /400/,
    );
    await assert.rejects(
      stranger.write('devices/x/meetings/m.bin', Buffer.from('x')),
      /401/,
    );
    await owner.write(
      'pairing/r1/offer.json',
      Buffer.from('{"publicKey":"y"}'),
    );
    await assert.rejects(
      owner.write('pairing/r1/offer.json', Buffer.from('{}')),
      /409/,
    );
    assert.deepEqual(await transport(null, 'unknown').list('pairing/'), []);
  });

  it('takes a reveal only from the device that made the request', async () => {
    await startRelay();
    await transport(relayToken(randomBytes(32))).register();
    const stranger = transport(null);
    const joining = createPairingKeys();
    await stranger.write(
      'pairing/r1/request.json',
      Buffer.from(
        JSON.stringify({ commitment: commitmentOf(joining.publicKey) }),
      ),
    );
    await assert.rejects(
      stranger.write(
        'pairing/r1/reveal.json',
        Buffer.from(
          JSON.stringify({ publicKey: createPairingKeys().publicKey }),
        ),
      ),
      /400/,
    );
    await stranger.write(
      'pairing/r1/reveal.json',
      Buffer.from(JSON.stringify({ publicKey: joining.publicKey })),
    );
  });

  it('stops reading a reply that never ends instead of filling memory', async () => {
    const endless = createServer((_request, response) => {
      response.writeHead(200);
      const chunk = Buffer.alloc(64 * 1024);
      const pump = () => {
        while (response.write(chunk)) {
          if (response.writableEnded) {
            return;
          }
        }
        response.once('drain', pump);
      };
      pump();
    });
    await new Promise<void>((resolve) =>
      endless.listen(0, '127.0.0.1', resolve),
    );
    const address = endless.address();
    close = () => endless.closeAllConnections() ?? endless.close();
    const hostile = createRelayTransport({
      url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
      vaultId: 'vault-1',
      token: 'x',
      fetch: (input, init) => fetch(input, init),
    });
    await assert.rejects(
      hostile.read('devices/a/meetings/m.bin', 1_000_000),
      /more than expected/,
    );
  });

  it('caps how many requests can wait at once', async () => {
    await startRelay();
    await transport(relayToken(randomBytes(32))).register();
    const stranger = transport(null);
    for (let index = 0; index < 16; index += 1) {
      await stranger.write(`pairing/r${index}/request.json`, Buffer.from('{}'));
    }
    await assert.rejects(
      stranger.write('pairing/r16/request.json', Buffer.from('{}')),
      /429/,
    );
  });

  it('reports a write the relay did not take instead of treating it as done', async () => {
    await startRelay();
    await assert.rejects(
      transport(relayToken(randomBytes(32)), 'never-registered').write(
        'devices/a/meetings/m.bin',
        Buffer.from('x'),
      ),
      /404/,
    );
  });

  it('refuses a file larger than the caller allows', async () => {
    await startRelay();
    const owner = transport(relayToken(randomBytes(32)));
    await owner.register();
    await owner.write('devices/a/meetings/m1.bin', randomBytes(2_000));
    await assert.rejects(
      owner.read('devices/a/meetings/m1.bin', 1_000),
      /more than expected/,
    );
  });

  it('refuses paths that climb out of the vault', async () => {
    await startRelay();
    await transport(relayToken(randomBytes(32))).register();
    const response = await fetch(
      `${url}/v1/vaults/vault-1/files/pairing/..%2f..%2ftoken`,
    );
    assert.equal(response.status, 400);
    await assert.rejects(
      transport(null).read('pairing/../token', 1_000_000),
      /Unsafe/,
    );
  });

  it('accepts only https, except on this machine', () => {
    assert.throws(() => relayBase('http://relay.example.com'), /https/);
    assert.equal(relayBase('https://relay.example.com').protocol, 'https:');
    assert.equal(relayBase('http://localhost:8787').hostname, 'localhost');
  });

  it('syncs two devices through it', async () => {
    await startRelay();
    const key = randomBytes(32);
    await transport(relayToken(key)).register();
    const devices = await Promise.all(
      ['laptop', 'phone'].map(async (name) => {
        const store = createMeetingStore({
          directory: join(dir(), name),
          cipher: async () => ({
            encrypt: (plain) => Buffer.from(plain),
            decrypt: (data) => data,
          }),
        });
        await store.load();
        const received: DocumentState[] = [];
        const engine = createSyncEngine({
          transport: transport(relayToken(key)),
          vault: { id: 'vault-1', key, deviceId: name },
          store,
          onRemote: (state) => received.push(state),
          now: () => 1,
        });
        return { store, engine, received };
      }),
    );
    const [laptop, phone] = devices;
    assert.ok(laptop && phone);
    const meeting = setSummary(startMeeting('m1', 'Launch', 0), 'Ship Friday.');
    await laptop.store.save(meeting);
    await laptop.engine.sync();
    await phone.engine.sync();
    await phone.store.save(editSummary(meeting, 'Ship on Friday.'));
    await phone.engine.sync();
    await laptop.engine.sync();

    assert.equal(phone.received[0]?.id, 'm1');
    const latest = laptop.received.at(-1);
    assert.equal(
      latest?.kind === 'meeting' ? latest.meeting.summary : null,
      'Ship on Friday.',
    );
  });
});
