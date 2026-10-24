import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  blindedDeviceId,
  identityCard,
  identityOf,
  parseIdentityCard,
  randomKey,
  sealSigned,
  type Identity,
  type IdentityCard,
} from '../crypto/index.ts';
import { memoryFiles, plainCipher } from '../meetings/testing/index.ts';
import { createDocumentSyncEngine } from '../sync/engine.ts';
import { closedPath, noteContext, notePath } from '../sync/layout.ts';
import { sealClosedNotice } from '../sync/closing.ts';
import { createMemoryTransport } from '../sync/testing/index.ts';
import { createNoteStore, type NoteStore } from './note-store.ts';
import { saveNoteDocument, createNoteDocument } from './note-document.ts';
import type { SharedNote } from './note.ts';
import { createSharesStore } from './shares-store.ts';
import {
  oneToOneKeyId,
  oneToOneKeys,
  oneToOneVault,
  sharedNoteDocuments,
  sharesDocuments,
} from './vaults.ts';

const alice = identityOf(new Uint8Array(32).fill(1));
const bob = identityOf(new Uint8Array(32).fill(2));
const carol = identityOf(new Uint8Array(32).fill(3));

function cardOf(identity: Identity): IdentityCard {
  const card = parseIdentityCard(identityCard(identity));
  assert.ok(card);
  return card;
}

async function device(
  identity: Identity,
  peer: Identity,
  deviceId: string,
  transport: ReturnType<typeof createMemoryTransport>,
) {
  const vault = oneToOneVault(identity, cardOf(peer));
  const store = await loadedStore();
  const remote: SharedNote[] = [];
  const engine = createDocumentSyncEngine({
    transport,
    vault: { deviceId: blindedDeviceId(identity, vault.id, deviceId) },
    documents: sharedNoteDocuments(oneToOneKeys(identity, vault)),
    store,
    onRemote: (state) => {
      if (state.kind === 'note') {
        remote.push(state.note);
      }
    },
    now: () => 1,
  });
  return { vault, store, engine, remote };
}

async function loadedStore(): Promise<NoteStore> {
  const store = createNoteStore({ files: memoryFiles(), cipher: plainCipher });
  await store.load();
  return store;
}

const note: SharedNote = {
  id: 'n-1',
  title: 'Roadmap',
  summary: 'Ship sharing first.',
  sharedAt: 1_000,
};

describe('one-to-one vault', () => {
  it('is the same vault from both sides and another with a third person', () => {
    const fromAlice = oneToOneVault(alice, cardOf(bob));
    const fromBob = oneToOneVault(bob, cardOf(alice));
    assert.equal(fromBob.id, fromAlice.id);
    assert.equal(fromBob.token, fromAlice.token);
    assert.deepEqual(fromBob.fileKey, fromAlice.fileKey);
    assert.notEqual(oneToOneVault(alice, cardOf(carol)).id, fromAlice.id);
  });

  it('carries a note from one person to the other and their edits back', async () => {
    const relay = createMemoryTransport();
    const a = await device(alice, bob, 'laptop', relay);
    const b = await device(bob, alice, 'phone', relay);
    await a.store.save(note);
    await a.engine.sync();
    await b.engine.sync();
    assert.deepEqual(b.remote, [note]);
    assert.deepEqual(b.store.note('n-1'), note);

    await b.store.save({ ...note, summary: 'Ship sharing first, teams next.' });
    await b.engine.sync();
    await a.engine.sync();
    assert.equal(
      a.store.note('n-1')?.summary,
      'Ship sharing first, teams next.',
    );
    assert.equal(a.engine.status().devices, 1);
    assert.equal(a.engine.status().error, null);
  });

  it('ignores a note from someone who holds the key but isn’t one of the two', async () => {
    const relay = createMemoryTransport();
    const a = await device(alice, bob, 'laptop', relay);
    const vault = a.vault;
    const intruder = blindedDeviceId(carol, vault.id, 'x');
    await relay.write(
      notePath(intruder, 'n-9'),
      sealSigned(
        vault.fileKey,
        oneToOneKeyId(),
        carol,
        saveNoteDocument(createNoteDocument({ ...note, id: 'n-9' })),
        noteContext(vault.id, intruder, 'n-9'),
      ),
    );
    await a.engine.sync();
    assert.equal(a.store.note('n-9'), undefined);
    assert.match(a.engine.status().error ?? '', /note from another device/);
  });

  it('ignores a note sealed under another key generation', async () => {
    const relay = createMemoryTransport();
    const a = await device(alice, bob, 'laptop', relay);
    const vault = a.vault;
    const bobDevice = blindedDeviceId(bob, vault.id, 'phone');
    await relay.write(
      notePath(bobDevice, 'n-2'),
      sealSigned(
        vault.fileKey,
        new Uint8Array(16).fill(7),
        bob,
        saveNoteDocument(createNoteDocument({ ...note, id: 'n-2' })),
        noteContext(vault.id, bobDevice, 'n-2'),
      ),
    );
    await a.engine.sync();
    assert.equal(a.store.note('n-2'), undefined);
  });

  it('is never closed by a closing notice, since it carries no identity', async () => {
    const relay = createMemoryTransport();
    const a = await device(alice, bob, 'laptop', relay);
    const b = await device(bob, alice, 'phone', relay);
    await relay.write(
      closedPath('someone'),
      sealClosedNotice(a.vault.fileKey, a.vault.id, 'someone', 1),
    );
    await a.store.save({ ...note, id: 'n-3' });
    await a.engine.sync();
    await b.engine.sync();
    assert.equal(a.engine.status().error, null);
    assert.equal(b.store.note('n-3')?.title, note.title);
  });
});

describe('shares list in the personal vault', () => {
  it('reaches a person’s other device beside their meetings', async () => {
    const relay = createMemoryTransport();
    const key = randomKey();
    const vault = { id: 'vault-p', key };
    const storeFor = async () => {
      let data: Uint8Array | null = null;
      const store = createSharesStore({
        file: {
          read: async () => data,
          write: async (next) => {
            data = next;
          },
          setAside: async () => {
            data = null;
          },
        },
        cipher: plainCipher,
      });
      await store.load();
      return store;
    };
    const laptop = await storeFor();
    const phone = await storeFor();
    const engineFor = (deviceId: string, store: typeof laptop) =>
      createDocumentSyncEngine({
        transport: relay,
        vault: { deviceId },
        documents: sharesDocuments(vault),
        store,
        onRemote: () => {},
        now: () => 1,
      });
    await laptop.addPeer(identityCard(bob));
    await engineFor('laptop', laptop).sync();
    await engineFor('phone', phone).sync();
    assert.equal(phone.shares().peers[0]?.card, identityCard(bob));
    assert.equal(relay.paths().length, 1);
  });
});
