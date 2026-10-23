import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as Automerge from '@automerge/automerge';
import {
  createNoteDocument,
  loadNoteDocument,
  mergeNoteDocuments,
  noteTombstone,
  readNoteDocument,
  saveNoteDocument,
  updateNoteDocument,
} from './note-document.ts';
import { editNoteSummary, renameNote, type SharedNote } from './note.ts';

const note: SharedNote = {
  id: 'n-1',
  title: 'Roadmap review',
  summary: 'We agreed to ship sharing first.',
  sharedAt: 1_000,
};

describe('note document', () => {
  it('reads back what was written, across a save and load', () => {
    const loaded = loadNoteDocument(saveNoteDocument(createNoteDocument(note)));
    assert.ok(loaded);
    assert.deepEqual(loaded.state, { kind: 'note', id: 'n-1', note });
  });

  it('merges a rename on one side with a summary edit on the other', () => {
    const shared = createNoteDocument(note);
    const mine = updateNoteDocument(
      Automerge.clone(shared),
      note,
      renameNote(note, 'Roadmap review (final)'),
    );
    const theirs = updateNoteDocument(
      Automerge.clone(shared),
      note,
      editNoteSummary(note, 'We agreed to ship sharing first, then teams.'),
    );
    const merged = readNoteDocument(mergeNoteDocuments(mine, theirs));
    assert.ok(merged && merged.kind === 'note');
    assert.equal(merged.note.title, 'Roadmap review (final)');
    assert.equal(
      merged.note.summary,
      'We agreed to ship sharing first, then teams.',
    );
  });

  it('merges two edits of the summary character by character', () => {
    const shared = createNoteDocument(note);
    const mine = updateNoteDocument(
      Automerge.clone(shared),
      note,
      editNoteSummary(note, 'Today we agreed to ship sharing first.'),
    );
    const theirs = updateNoteDocument(
      Automerge.clone(shared),
      note,
      editNoteSummary(note, 'We agreed to ship sharing first!'),
    );
    const merged = readNoteDocument(mergeNoteDocuments(mine, theirs));
    assert.ok(merged && merged.kind === 'note');
    assert.equal(merged.note.summary, 'Today we agreed to ship sharing first!');
  });

  it('lets a deletion win over an edit and leaves no text behind', () => {
    const shared = createNoteDocument(note);
    const edited = updateNoteDocument(
      Automerge.clone(shared),
      note,
      editNoteSummary(note, 'Secret follow-up'),
    );
    const merged = mergeNoteDocuments(edited, noteTombstone('n-1', 2_000));
    assert.deepEqual(readNoteDocument(merged), {
      kind: 'deleted',
      id: 'n-1',
      deletedAt: 2_000,
    });
    assert.equal(
      Buffer.from(saveNoteDocument(merged)).includes('Secret'),
      false,
    );
    assert.deepEqual(
      saveNoteDocument(mergeNoteDocuments(noteTombstone('n-1', 2_000), edited)),
      saveNoteDocument(merged),
    );
  });

  it('refuses a document of another schema or with a broken shape', () => {
    const newer = Automerge.change(createNoteDocument(note), (fields) => {
      fields.schema = 2;
    });
    assert.equal(readNoteDocument(newer), null);
    const broken = Automerge.from({ schema: 1, id: 'n-1', title: 'x' });
    assert.equal(loadNoteDocument(Automerge.save(broken)), null);
    assert.equal(loadNoteDocument(new Uint8Array([1, 2, 3])), null);
  });
});
