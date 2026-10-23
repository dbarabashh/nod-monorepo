import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  identityCard,
  identityCodeOf,
  identityOf,
  randomKey,
} from '../crypto/index.ts';
import {
  startMeeting,
  setSummary,
  type MeetingFiles,
} from '../meetings/index.ts';
import { memoryFiles, plainCipher } from '../meetings/testing/index.ts';
import { createMemoryTransport } from '../sync/testing/index.ts';
import { createSharingSession, type SharedPlace } from './session.ts';

function person(rootKey: Uint8Array, deviceId: string) {
  const sharesData = new Map<string, Uint8Array>();
  const noteFiles = new Map<string, MeetingFiles>();
  let changes = 0;
  const session = createSharingSession({
    sharesFileFor: (vaultId) => ({
      read: async () => sharesData.get(vaultId) ?? null,
      write: async (data) => {
        sharesData.set(vaultId, data);
      },
      setAside: async () => {
        sharesData.delete(vaultId);
      },
    }),
    noteFilesFor: (vaultId) => {
      const files = noteFiles.get(vaultId) ?? memoryFiles();
      noteFiles.set(vaultId, files);
      return files;
    },
    cipher: async () => plainCipher,
    newId: () => `note-${deviceId}-${++changes}`,
    now: () => 1_000 + changes,
    onChange: () => {},
  });
  return {
    session,
    rootKey,
    deviceId,
    card: identityCard(identityOf(rootKey)),
  };
}

const relay = () => {
  const transport = createMemoryTransport();
  const place: SharedPlace = { name: 'memory', open: async () => transport };
  return { transport, place };
};

describe('sharing session', () => {
  it('knows nothing before a recovery phrase exists', async () => {
    const alice = person(randomKey(), 'laptop');
    await alice.session.load(null);
    assert.deepEqual(alice.session.snapshot(), { status: 'none' });
    assert.throws(() => alice.session.identityCard(), /recovery phrase/);
  });

  it('shares a meeting’s notes with a person who added this card back', async () => {
    const { transport, place } = relay();
    const alice = person(randomKey(), 'laptop');
    const bob = person(randomKey(), 'phone');
    await alice.session.load({ key: alice.rootKey, deviceId: 'laptop' });
    await bob.session.load({ key: bob.rootKey, deviceId: 'phone' });
    assert.throws(
      () => alice.session.previewPeer(alice.card),
      /your own identity card/,
    );
    assert.equal(
      alice.session.previewPeer(bob.card).code,
      identityCodeOf(identityOf(bob.rootKey).publicKey),
    );
    await alice.session.addPeer(bob.card);
    await bob.session.addPeer(alice.card);

    const meeting = setSummary(
      startMeeting('m-1', 'Planning', 1_000),
      'We plan to ship sharing.',
    );
    const shared = await alice.session.shareMeeting(
      meeting,
      'Planning',
      alice.session.previewPeer(bob.card).identity,
    );
    assert.equal(shared.title, 'Planning');
    await alice.session.round(place);
    await bob.session.round(place);

    const seen = bob.session.snapshot();
    assert.equal(seen.status, 'ready');
    assert.deepEqual(
      seen.notes.map((note) => [note.title, note.peerCode]),
      [['Planning', identityCodeOf(identityOf(alice.rootKey).publicKey)]],
    );
    const note = await bob.session.note(seen.notes[0]?.peer ?? '', shared.id);
    assert.equal(note.summary, 'We plan to ship sharing.');
    assert.equal(transport.paths().length, 1);
    assert.match(transport.paths()[0] ?? '', /^devices\/[0-9a-f]{64}\/notes\//);
  });

  it('lets the other side edit, and stopping removes this device’s copies', async () => {
    const { transport, place } = relay();
    const alice = person(randomKey(), 'laptop');
    const bob = person(randomKey(), 'phone');
    await alice.session.load({ key: alice.rootKey, deviceId: 'laptop' });
    await bob.session.load({ key: bob.rootKey, deviceId: 'phone' });
    await alice.session.addPeer(bob.card);
    await bob.session.addPeer(alice.card);
    const bobId = alice.session.previewPeer(bob.card).identity;
    const aliceId = bob.session.previewPeer(alice.card).identity;
    const shared = await alice.session.shareMeeting(
      setSummary(startMeeting('m-1', 'Planning', 1_000), 'First draft.'),
      'Planning',
      bobId,
    );
    await alice.session.round(place);
    await bob.session.round(place);
    await bob.session.editNote(aliceId, shared.id, 'First draft, reviewed.');
    await bob.session.round(place);
    await alice.session.round(place);
    assert.equal(
      (await alice.session.note(bobId, shared.id)).summary,
      'First draft, reviewed.',
    );
    assert.equal(transport.paths().length, 2);

    await alice.session.stopPeer(bobId, place);
    assert.equal(transport.paths().length, 1);
    const after = alice.session.snapshot();
    assert.equal(after.status, 'ready');
    assert.equal(after.peers[0]?.stoppedAt, 1_001);
    assert.deepEqual(after.notes, []);
    await alice.session.round(place);
    assert.equal(transport.paths().length, 1);
    const later = alice.session.snapshot();
    assert.equal(later.status, 'ready');
    assert.deepEqual(later.notes, []);
  });
});

describe('sharing session, the edges', () => {
  it('never puts its own card, or one it can’t share with, into the list', async () => {
    const alice = person(randomKey(), 'laptop');
    await alice.session.load({ key: alice.rootKey, deviceId: 'laptop' });
    await assert.rejects(
      alice.session.addPeer(alice.card),
      /two different people/,
    );
    const after = alice.session.snapshot();
    assert.equal(after.status, 'ready');
    assert.deepEqual(after.peers, []);
    assert.equal(after.error, null);
    await alice.session.load({ key: alice.rootKey, deviceId: 'laptop' });
    assert.equal(alice.session.snapshot().status, 'ready');
  });

  it('refuses to share with, edit for or delete for a person sharing was stopped with', async () => {
    const { place } = relay();
    const alice = person(randomKey(), 'laptop');
    const bob = person(randomKey(), 'phone');
    await alice.session.load({ key: alice.rootKey, deviceId: 'laptop' });
    await alice.session.addPeer(bob.card);
    const bobId = alice.session.previewPeer(bob.card).identity;
    await alice.session.stopPeer(bobId, place);
    await assert.rejects(
      alice.session.shareMeeting(startMeeting('m-1', 'x', 1), 'x', bobId),
      /was stopped/,
    );
    await assert.rejects(
      alice.session.editNote(bobId, 'n', 'x'),
      /was stopped/,
    );
  });

  it('ends a share here once another of this person’s devices stopped it', async () => {
    const { transport, place } = relay();
    const root = randomKey();
    const laptop = person(root, 'laptop');
    const phone = person(root, 'phone');
    const bob = person(randomKey(), 'bob-phone');
    await laptop.session.load({ key: root, deviceId: 'laptop' });
    await phone.session.load({ key: root, deviceId: 'phone' });
    await bob.session.load({ key: bob.rootKey, deviceId: 'bob-phone' });
    await laptop.session.addPeer(bob.card);
    await bob.session.addPeer(laptop.card);
    const bobId = laptop.session.previewPeer(bob.card).identity;
    await laptop.session.shareMeeting(
      setSummary(startMeeting('m-1', 'Planning', 1_000), 'Draft.'),
      'Planning',
      bobId,
    );
    await laptop.session.round(place);
    assert.equal(transport.paths().length, 1);

    // The person's own vault carries the shares list between their devices.
    const personal = createMemoryTransport();
    const vault = { id: 'vault-p', key: root };
    const laptopShares = await laptop.session.sharesEngine(
      { ...vault, deviceId: 'laptop' },
      personal,
      'memory',
    );
    const phoneShares = await phone.session.sharesEngine(
      { ...vault, deviceId: 'phone' },
      personal,
      'memory',
    );
    assert.ok(laptopShares && phoneShares);
    await laptopShares.sync();
    await phoneShares.sync();
    assert.equal(phone.session.snapshot().status, 'ready');
    await phone.session.stopPeer(bobId, place);
    await phoneShares.sync();
    await laptopShares.sync();

    await laptop.session.round(place);
    assert.equal(transport.paths().length, 0);
    const after = laptop.session.snapshot();
    assert.equal(after.status, 'ready');
    assert.notEqual(after.peers[0]?.stoppedAt, null);
    assert.deepEqual(after.notes, []);
  });

  it('starts another list for another phrase', async () => {
    const alice = person(randomKey(), 'laptop');
    const bob = person(randomKey(), 'phone');
    await alice.session.load({ key: alice.rootKey, deviceId: 'laptop' });
    await alice.session.addPeer(bob.card);
    await alice.session.load({ key: randomKey(), deviceId: 'laptop' });
    const fresh = alice.session.snapshot();
    assert.equal(fresh.status, 'ready');
    assert.deepEqual(fresh.peers, []);
  });
});

describe('sharing session, offline', () => {
  it('still stops a share when the place can’t be reached, and says the copies stayed', async () => {
    const alice = person(randomKey(), 'laptop');
    const bob = person(randomKey(), 'phone');
    await alice.session.load({ key: alice.rootKey, deviceId: 'laptop' });
    await alice.session.addPeer(bob.card);
    const bobId = alice.session.previewPeer(bob.card).identity;
    await alice.session.shareMeeting(
      startMeeting('m-1', 'P', 1_000),
      'P',
      bobId,
    );
    const unreachable: SharedPlace = {
      name: 'down',
      open: async () => {
        throw new Error('The relay can’t be reached');
      },
    };
    await alice.session.stopPeer(bobId, unreachable);
    const after = alice.session.snapshot();
    assert.equal(after.status, 'ready');
    assert.notEqual(after.peers[0]?.stoppedAt, null);
    assert.deepEqual(after.notes, []);
    assert.match(after.error ?? '', /stayed there: The relay can’t be reached/);
  });
});
