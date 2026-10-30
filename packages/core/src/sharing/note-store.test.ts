import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as Automerge from '@automerge/automerge';
import type { Cipher } from '../meetings/index.ts';
import { memoryFiles } from '../meetings/testing/index.ts';
import {
  createNoteDocument,
  noteTombstone,
  readNoteDocument,
  updateNoteDocument,
} from './note-document.ts';
import { createNoteStore } from './note-store.ts';
import type { SharedNote } from './note.ts';

// Marks the bytes so the test sees the store never writes a note in the clear.
const cipher: Cipher = {
  encrypt: (plain, context) =>
    Uint8Array.from([...plain].map((byte) => byte ^ context.length)),
  decrypt: (data, context) =>
    Uint8Array.from([...data].map((byte) => byte ^ context.length)),
};

const note: SharedNote = {
  id: 'n-1',
  title: 'Roadmap',
  summary: 'Ship sharing first.',
  sharedAt: 1_000,
};

describe('note store', () => {
  it('saves notes sealed, loads them back and lists what is on disk', async () => {
    const memory = memoryFiles();
    const store = createNoteStore({ files: memory, cipher });
    await store.load();
    await store.save(note);
    assert.equal(
      Buffer.from(memory.stored.get('n-1') ?? []).includes('Roadmap'),
      false,
    );
    assert.deepEqual(store.ids(), ['n-1']);

    const again = createNoteStore({ files: memory, cipher });
    assert.deepEqual(await again.load(), [note]);
    assert.deepEqual(again.note('n-1'), note);
  });

  it('merges a copy from another person and keeps a local edit made meanwhile', async () => {
    const memory = memoryFiles();
    const store = createNoteStore({ files: memory, cipher });
    await store.load();
    await store.save(note);
    const mine = store.document('n-1');
    assert.ok(mine);
    const theirs = updateNoteDocument(Automerge.clone(mine), note, {
      ...note,
      summary: 'Ship sharing first, teams next.',
    });
    await store.save({ ...note, title: 'Roadmap 2026' });
    const merged = store.merge('n-1', theirs);
    assert.equal(merged.kept, true);
    assert.deepEqual(merged.state, {
      kind: 'note',
      id: 'n-1',
      note: {
        ...note,
        title: 'Roadmap 2026',
        summary: 'Ship sharing first, teams next.',
      },
    });
    await merged.written;
    assert.equal(store.merge('n-1', theirs).state, null);
  });

  it('refuses a copy that names another note, and deletes for good', async () => {
    const memory = memoryFiles();
    const store = createNoteStore({ files: memory, cipher });
    await store.load();
    assert.equal(
      store.merge('n-1', createNoteDocument({ ...note, id: 'n-2' })).kept,
      false,
    );
    await store.save(note);
    await store.remove('n-1', 2_000);
    assert.equal(store.isDeleted('n-1'), true);
    assert.equal(store.note('n-1'), undefined);
    await assert.rejects(store.save(note), /deleted/);
    const stored = store.document('n-1');
    assert.ok(stored);
    assert.deepEqual(readNoteDocument(stored), {
      kind: 'deleted',
      id: 'n-1',
      deletedAt: 2_000,
    });
    assert.equal(store.merge('n-1', noteTombstone('n-1', 2_000)).state, null);
  });

  it('never overwrites a file it couldn’t read, until a healthy copy arrives', async () => {
    const memory = memoryFiles();
    memory.stored.set('n-1', new Uint8Array([1, 2, 3]));
    const store = createNoteStore({ files: memory, cipher });
    assert.deepEqual(await store.load(), []);
    await assert.rejects(store.save(note), /could not be read/);
    const merged = store.merge('n-1', createNoteDocument(note));
    assert.equal(merged.kept, true);
    assert.equal(merged.state, null);
    assert.deepEqual(await merged.written, { kind: 'note', id: 'n-1', note });
    assert.deepEqual(memory.asideIds, ['n-1']);
    assert.deepEqual(store.note('n-1'), note);
    await store.save({ ...note, title: 'Fixed' });
    assert.equal(store.note('n-1')?.title, 'Fixed');
  });

  it('keeps another member’s line through two saves from an editor that never showed it', async () => {
    const store = createNoteStore({ files: memoryFiles(), cipher });
    await store.load();
    await store.save({ ...note, summary: 'one\ntwo' });
    const opened = store.version('n-1');
    const held = store.document('n-1');
    assert.ok(opened && held);
    const merged = store.merge(
      'n-1',
      updateNoteDocument(
        Automerge.clone(held),
        { ...note, summary: 'one\ntwo' },
        { ...note, summary: 'one\nA line\ntwo' },
      ),
    );
    await merged.written;

    const first = await store.saveFrom('n-1', opened, (seen) => ({
      ...seen,
      summary: 'one\ntwo\nB1',
    }));
    assert.equal(store.note('n-1')?.summary, 'one\nA line\ntwo\nB1');
    await store.saveFrom('n-1', first, (seen) => ({
      ...seen,
      summary: 'one\ntwo\nB1 more',
    }));
    assert.equal(store.note('n-1')?.summary, 'one\nA line\ntwo\nB1 more');
  });

  it('takes an edit back when its write fails, so trying again makes it once', async () => {
    const memory = memoryFiles();
    let failNext = false;
    const store = createNoteStore({
      files: {
        ...memory,
        write: async (id, data) => {
          if (failNext) {
            failNext = false;
            throw new Error('The disk is full');
          }
          await memory.write(id, data);
        },
      },
      cipher,
    });
    await store.load();
    await store.save({ ...note, summary: 'one' });
    const opened = store.version('n-1');
    assert.ok(opened);
    const edit = (seen: SharedNote) => ({ ...seen, summary: 'one\ntwo' });

    failNext = true;
    await assert.rejects(store.saveFrom('n-1', opened, edit), /disk is full/);
    assert.equal(store.note('n-1')?.summary, 'one');
    await store.saveFrom('n-1', opened, edit);
    assert.equal(store.note('n-1')?.summary, 'one\ntwo');
  });
});
