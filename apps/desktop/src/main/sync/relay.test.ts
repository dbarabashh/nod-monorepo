import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import { createRelay } from '../../../relay/server.ts';
import {
  editSummary,
  readDocument,
  setSummary,
  startMeeting,
  type DocumentState,
  type MeetingDocument,
} from '@nod/core/meetings';
import { createMeetingStore } from '../meetings/store.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import {
  createSyncEngine,
  requestPairingOffer,
  sealPairingOffer,
  type Merged,
} from '@nod/core/sync';
import { pairingProof, relayToken, vaultIdOf } from '@nod/core/crypto';
import { listenForPairing } from './pairing-server.ts';
import { createRelayTransport, relayBase } from '@nod/core/sync';

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

  const ownerKey = randomBytes(32);
  const ownerToken = relayToken(ownerKey);
  const vault = vaultIdOf(ownerKey);

  const transport = (token: string | null, vaultId = vault) =>
    createRelayTransport({
      url,
      vaultId,
      token,
      fetch: (input, init) => fetch(input, init),
    });

  it('keeps a vault to the devices that hold its key', async () => {
    await startRelay();
    const owner = transport(ownerToken);
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

  it('lets a phone that scans the pairing code find the vault and every meeting', async () => {
    await startRelay();
    const store = createMeetingStore({
      directory: join(dir(), 'computer'),
      cipher: async () => ({
        encrypt: (plain) => Buffer.from(plain),
        decrypt: (data) => data,
      }),
    });
    await store.load();
    await store.save(setSummary(startMeeting('m-1', 'Planning', 1), 'Ship it'));
    await store.save(startMeeting('m-2', 'Retro', 2));
    const owner = transport(ownerToken);
    await owner.register();
    await createSyncEngine({
      transport: owner,
      vault: { id: vault, key: ownerKey, deviceId: 'computer' },
      store,
      onRemote: () => {},
      now: () => 1,
    }).sync();

    const listing = await fetch(
      `${url}/v1/vaults/${vault}/files?prefix=devices%2F`,
      { headers: { authorization: `Bearer ${ownerToken}` } },
    );
    assert.equal(listing.headers.get('cache-control'), 'no-store');

    const secret = randomBytes(32);
    const listener = await listenForPairing({
      offer: sealPairingOffer(secret, { key: ownerKey, relayUrl: url }),
      proofFor: (host, port) => pairingProof(secret, host, port),
      hosts: ['127.0.0.1'],
      confirm: async () => true,
    });
    const lan = { secret, port: listener.port, hosts: ['127.0.0.1'] };
    const pairing = await requestPairingOffer(lan, (input, init) =>
      fetch(input, init),
    );
    assert.deepEqual(await listener.outcome, { by: '127.0.0.1' });
    await assert.rejects(
      requestPairingOffer(lan, (input, init) => fetch(input, init)),
      /same Wi‑Fi/,
    );
    const phoneTransport = createRelayTransport({
      url: pairing.relayUrl,
      vaultId: vaultIdOf(pairing.key),
      token: relayToken(pairing.key),
      fetch: (input, init) => fetch(input, init),
    });
    await phoneTransport.register();
    const received = new Map<string, MeetingDocument>();
    const nothing: Merged = {
      state: null,
      written: Promise.resolve(null),
      kept: false,
    };
    await createSyncEngine({
      transport: phoneTransport,
      vault: {
        id: vaultIdOf(pairing.key),
        key: pairing.key,
        deviceId: 'phone',
      },
      store: {
        ids: () => [],
        document: () => undefined,
        merge: (id, remote) => {
          received.set(id, remote);
          return nothing;
        },
      },
      onRemote: () => {},
      now: () => 1,
    }).sync();

    assert.deepEqual(
      [...received].map(([id, document]) => {
        const state = readDocument(document);
        return [id, state?.kind === 'meeting' ? state.meeting.title : null];
      }),
      [
        ['m-1', 'Planning'],
        ['m-2', 'Retro'],
      ],
    );
  });

  it('needs the key for every file, and stores nothing outside a vault’s layout', async () => {
    await startRelay();
    const owner = transport(ownerToken);
    await owner.register();
    await owner.write('devices/a/meetings/m1.bin', Buffer.from('sealed'));
    const stranger = transport(null);
    await assert.rejects(stranger.list('devices/'), /401/);
    await assert.rejects(
      stranger.read('devices/a/meetings/m1.bin', 1_000_000),
      /401/,
    );
    await assert.rejects(
      stranger.write('devices/x/meetings/m.bin', Buffer.from('x')),
      /401/,
    );
    await assert.rejects(stranger.remove('devices/a/meetings/m1.bin'), /401/);
    await assert.rejects(
      stranger.write('pairing/r1/request.json', Buffer.from('{}')),
      /401/,
    );
    await assert.rejects(
      owner.write('pairing/r1/offer.json', Buffer.from('{}')),
      /400/,
    );
    await assert.rejects(owner.list('pairing/'), /400/);
    await assert.rejects(
      owner.write('devices/a/other.bin', Buffer.from('x')),
      /400/,
    );
    assert.deepEqual(
      (await owner.list('devices/')).map((file) => file.path),
      ['devices/a/meetings/m1.bin'],
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

  it('registers a vault only for the holder of the key it is named after', async () => {
    await startRelay();
    const stranger = relayToken(randomBytes(32));
    await assert.rejects(transport(stranger).register(), /403/);
    await transport(ownerToken).register();
    await transport(ownerToken).register();
    await assert.rejects(transport(stranger).register(), /403/);
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
    const owner = transport(ownerToken);
    await owner.register();
    await owner.write('devices/a/meetings/m1.bin', randomBytes(2_000));
    await assert.rejects(
      owner.read('devices/a/meetings/m1.bin', 1_000),
      /more than expected/,
    );
  });

  it('refuses paths that climb out of the vault', async () => {
    await startRelay();
    await transport(ownerToken).register();
    const response = await fetch(
      `${url}/v1/vaults/${vault}/files/devices/..%2f..%2ftoken`,
      { headers: { authorization: `Bearer ${ownerToken}` } },
    );
    assert.equal(response.status, 400);
    await assert.rejects(
      transport(ownerToken).read('devices/../token', 1_000_000),
      /Unsafe/,
    );
  });

  it('accepts only https, except on this machine', () => {
    assert.throws(() => relayBase('http://relay.example.com'), /https/);
    assert.equal(relayBase('https://relay.example.com').protocol, 'https:');
    assert.equal(relayBase('http://localhost:8787').hostname, 'localhost');
    assert.equal(
      relayBase('https://relay.example.com/nod/').href,
      'https://relay.example.com/nod/',
    );
    for (const address of [
      'https://relay.example.com/?words=secret',
      'https://relay.example.com/#secret',
      'https://user:secret@relay.example.com/',
    ]) {
      assert.throws(() => relayBase(address), /without a login/);
    }
  });

  it('syncs two devices through it', async () => {
    await startRelay();
    const key = ownerKey;
    await transport(ownerToken).register();
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
          vault: { id: vault, key, deviceId: name },
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
