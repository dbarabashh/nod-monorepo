import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as Automerge from '@automerge/automerge';
import {
  createDocument,
  loadDocument,
  mergeDocuments,
  readDocument,
  sameDocument,
  saveDocument,
  tombstone,
  updateDocument,
  type MeetingDocument,
} from './document.ts';
import {
  appendTranscript,
  editSummary,
  editTranscriptLine,
  finishMeeting,
  setSummary,
  startMeeting,
  type Meeting,
} from './meeting.ts';

function meetingOf(document: MeetingDocument): Meeting {
  const state = readDocument(document);
  assert.equal(state?.kind, 'meeting');
  if (state?.kind !== 'meeting') {
    throw new Error('not a meeting');
  }
  return state.meeting;
}

const base = setSummary(
  finishMeeting(
    appendTranscript(startMeeting('m1', 'Launch sync', 1_000), [
      {
        id: 'b',
        speaker: 'others',
        startMs: 4_000,
        endMs: 5_000,
        text: 'Jon ships Friday.',
      },
      {
        id: 'a',
        speaker: 'me',
        startMs: 1_000,
        endMs: 3_000,
        text: 'Where are we?',
      },
    ]),
    9_000,
  ),
  'Jon ships the onboarding on Friday.',
);

describe('meeting documents', () => {
  it('reads back the meeting it was made from, through saved bytes', () => {
    const loaded = loadDocument(saveDocument(createDocument(base)));
    assert.ok(loaded);
    assert.deepEqual(meetingOf(loaded), base);
  });

  it('merges edits made on two devices while they were apart, in either order', () => {
    const shared = createDocument(base);
    const laptop = updateDocument(
      Automerge.clone(shared),
      base,
      editSummary(base, 'John ships the onboarding on Friday.'),
    );
    const phone = updateDocument(
      Automerge.clone(shared),
      base,
      editTranscriptLine(
        appendTranscript(
          editSummary(
            base,
            'Jon ships the onboarding on Friday. Anna writes the notes.',
          ),
          [
            {
              id: 'c',
              speaker: 'me',
              startMs: 6_000,
              endMs: 7_000,
              text: 'Great.',
            },
          ],
        ),
        'b',
        'John ships Friday.',
      ),
    );

    const expected: Meeting = {
      ...base,
      summary: 'John ships the onboarding on Friday. Anna writes the notes.',
      summaryEdited: true,
      transcript: [
        {
          id: 'a',
          speaker: 'me',
          startMs: 1_000,
          endMs: 3_000,
          text: 'Where are we?',
        },
        {
          id: 'b',
          speaker: 'others',
          startMs: 4_000,
          endMs: 5_000,
          text: 'John ships Friday.',
        },
        {
          id: 'c',
          speaker: 'me',
          startMs: 6_000,
          endMs: 7_000,
          text: 'Great.',
        },
      ],
    };
    assert.deepEqual(meetingOf(mergeDocuments(laptop, phone)), expected);
    assert.deepEqual(meetingOf(mergeDocuments(phone, laptop)), expected);
  });

  it('removes a line deleted on one device everywhere', () => {
    const shared = createDocument(base);
    const edited = updateDocument(
      Automerge.clone(shared),
      base,
      editTranscriptLine(base, 'a', ''),
    );
    assert.deepEqual(
      meetingOf(mergeDocuments(shared, edited)).transcript.map(
        (line) => line.id,
      ),
      ['b'],
    );
  });

  it('lets a deletion win over edits made elsewhere, and keeps none of the text', () => {
    const shared = createDocument(base);
    const deleted = tombstone('m1', 20_000);
    const edited = updateDocument(
      Automerge.clone(shared),
      base,
      editSummary(base, 'Edited later.'),
    );

    for (const merged of [
      mergeDocuments(edited, deleted),
      mergeDocuments(deleted, edited),
    ]) {
      assert.deepEqual(readDocument(merged), {
        kind: 'deleted',
        id: 'm1',
        deletedAt: 20_000,
      });
      assert.equal(Automerge.getAllChanges(merged).length, 1);
      assert.equal(
        JSON.stringify(Automerge.toJS(merged)).includes('ships'),
        false,
      );
    }
  });

  it('never lets a copy that missed a remote change undo it', () => {
    const shared = createDocument(base);
    const fromPhone = updateDocument(
      Automerge.clone(shared),
      base,
      appendTranscript(base, [
        {
          id: 'p',
          speaker: 'others',
          startMs: 6_000,
          endMs: 7_000,
          text: 'Phone line.',
        },
      ]),
    );
    const merged = mergeDocuments(shared, fromPhone);
    const staleLocal = appendTranscript(base, [
      {
        id: 'l',
        speaker: 'me',
        startMs: 8_000,
        endMs: 9_000,
        text: 'Local line.',
      },
    ]);
    const saved = updateDocument(merged, base, staleLocal);
    assert.deepEqual(
      meetingOf(saved).transcript.map((line) => line.id),
      ['a', 'b', 'p', 'l'],
    );
  });

  it('keeps both sides when a summary is written and cleared on different devices', () => {
    const empty = { ...base, summary: null };
    const shared = createDocument(empty);
    const typed = updateDocument(
      Automerge.clone(shared),
      empty,
      editSummary(empty, 'Typed here.'),
    );
    const written = updateDocument(
      Automerge.clone(shared),
      empty,
      setSummary(empty, 'Model wrote this.'),
    );
    const both = meetingOf(mergeDocuments(typed, written)).summary ?? '';
    assert.ok(
      both.includes('Typed here.') && both.includes('Model wrote this.'),
      both,
    );

    const withSummary = createDocument(base);
    const cleared = updateDocument(
      Automerge.clone(withSummary),
      base,
      editSummary(base, ''),
    );
    const extended = updateDocument(
      Automerge.clone(withSummary),
      base,
      editSummary(base, `${base.summary} Plus a note.`),
    );
    assert.equal(
      meetingOf(mergeDocuments(cleared, extended)).summary,
      ' Plus a note.',
    );
  });

  it('builds the same tombstone on every device, so it stops syncing', () => {
    const here = tombstone('m1', 20_000);
    const there = tombstone('m1', 20_000);
    assert.deepEqual(saveDocument(here), saveDocument(there));
    assert.equal(sameDocument(mergeDocuments(here, there), here), true);
    assert.equal(sameDocument(here, tombstone('m1', 20_001)), false);
  });

  it('tells when a merge brought nothing new', () => {
    const shared = createDocument(base);
    const copy = Automerge.clone(shared);
    assert.equal(sameDocument(mergeDocuments(shared, copy), shared), true);
    const edited = updateDocument(copy, base, editSummary(base, 'Changed.'));
    assert.equal(sameDocument(mergeDocuments(shared, edited), shared), false);
  });

  it('keeps the earliest deletion when two devices delete', () => {
    assert.deepEqual(
      readDocument(mergeDocuments(tombstone('m1', 30), tombstone('m1', 20))),
      { kind: 'deleted', id: 'm1', deletedAt: 20 },
    );
  });

  it('refuses bytes that are not a meeting it understands', () => {
    assert.equal(loadDocument(new Uint8Array([1, 2, 3])), null);
    assert.equal(
      loadDocument(Automerge.save(Automerge.from({ hello: 'world' }))),
      null,
    );
    const newer = Automerge.change(createDocument(base), (fields) => {
      fields.schema = 2;
    });
    assert.equal(loadDocument(Automerge.save(newer)), null);
    const damaged = Automerge.change(createDocument(base), (fields) => {
      const line = fields.lines.a;
      if (line) {
        Reflect.set(line, 'speaker', 'robot');
      }
    });
    assert.equal(readDocument(damaged), null);
  });
});
