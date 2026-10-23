import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { identityCard, identityHex, identityOf } from '../crypto/index.ts';
import type { Cipher } from '../meetings/index.ts';
import { addPeer, createSharesDocument } from './shares-document.ts';
import { createSharesStore, type SharesFile } from './shares-store.ts';

const cipher: Cipher = {
  encrypt: (plain, context) =>
    Uint8Array.from([...plain].map((byte) => byte ^ context.length)),
  decrypt: (data, context) =>
    Uint8Array.from([...data].map((byte) => byte ^ context.length)),
};

function memoryFile(initial: Uint8Array | null = null) {
  let data = initial;
  const setAside: number[] = [];
  const file: SharesFile = {
    read: async () => data,
    write: async (next) => {
      data = next;
    },
    setAside: async () => {
      setAside.push(data?.length ?? 0);
      data = null;
    },
  };
  return { file, setAside, data: () => data };
}

const bob = identityOf(new Uint8Array(32).fill(2));
const bobCard = identityCard(bob);

describe('shares store', () => {
  it('starts empty, keeps what was added, and reads it back sealed', async () => {
    const memory = memoryFile();
    const store = createSharesStore({ file: memory.file, cipher });
    assert.deepEqual(await store.load(), { peers: [], teams: [] });
    assert.deepEqual(store.ids(), []);
    await store.addPeer(bobCard);
    assert.deepEqual(store.ids(), ['shares']);
    assert.equal(
      Buffer.from(memory.data() ?? []).includes(Buffer.from(bobCard)),
      false,
    );
    const again = createSharesStore({ file: memory.file, cipher });
    const loaded = await again.load();
    assert.equal(loaded.peers[0]?.identity, identityHex(bob.publicKey));
  });

  it('never writes over a file it couldn’t read, until a healthy copy arrives', async () => {
    const memory = memoryFile(new Uint8Array([1, 2, 3]));
    const store = createSharesStore({ file: memory.file, cipher });
    assert.deepEqual(await store.load(), { peers: [], teams: [] });
    await assert.rejects(store.addPeer(bobCard), /could not be read/);
    assert.deepEqual([...(memory.data() ?? [])], [1, 2, 3]);

    const merged = store.merge(
      'shares',
      addPeer(createSharesDocument(), bobCard),
    );
    assert.equal(merged.kept, true);
    assert.equal(merged.state, null);
    assert.equal(
      (await merged.written)?.peers[0]?.identity,
      identityHex(bob.publicKey),
    );
    assert.deepEqual(memory.setAside, [3]);
    await store.stopPeer(identityHex(bob.publicKey), 7);
    assert.equal(store.shares().peers[0]?.stoppedAt, 7);
  });

  it('refuses a copy that is not a shares list', async () => {
    const memory = memoryFile();
    const store = createSharesStore({ file: memory.file, cipher });
    await store.load();
    assert.equal(store.merge('other', createSharesDocument()).kept, false);
  });
});
