import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as Automerge from '@automerge/automerge';
import {
  createDocument,
  importedDocument,
  loadDocument,
  mergeDocuments,
  readDocument,
  sameDocument,
  saveDocument,
  tombstone,
  updateDocument,
  updateDocumentFrom,
  headsOf,
  type MeetingDocument,
} from './document.ts';
import {
  appendTranscript,
  editSummary,
  editTranscriptLine,
  finishMeeting,
  meetingName,
  moveToFolder,
  recordShare,
  renameMeeting,
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
      titleEdited: false,
      generatedTitle: null,
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

  it('keeps a line another device added while this one edited an older version', () => {
    const lines = { ...base, summary: 'Ship sharing first.\nTeams next.' };
    const shown = createDocument(lines);
    const opened = headsOf(shown);
    const fromPhone = updateDocument(
      Automerge.clone(shown),
      lines,
      editSummary(
        lines,
        'Ship sharing first.\nTest on two machines.\nTeams next.',
      ),
    );
    const here = mergeDocuments(shown, fromPhone);
    const saved = updateDocumentFrom(here, opened, (seen) =>
      editSummary(seen, 'Ship sharing first.\nTeams next.\nCheck the clock.'),
    );
    assert.equal(
      saved && Automerge.getActorId(saved.document),
      Automerge.getActorId(here),
    );
    assert.equal(
      saved && meetingOf(saved.document).summary,
      'Ship sharing first.\nTest on two machines.\nTeams next.\nCheck the clock.',
    );
  });

  it('refuses an edit from a version the document doesn’t hold', () => {
    const shown = createDocument(base);
    const other = headsOf(createDocument({ ...base, id: 'm2' }));
    for (const version of [other, '', 'not-a-version']) {
      assert.equal(
        updateDocumentFrom(shown, version, (seen) => editSummary(seen, 'x')),
        null,
        version,
      );
    }
  });

  it('keeps a rename and a generated name through saving and syncing', () => {
    const named = renameMeeting(
      setSummary(base, 'Text.', 'Generated'),
      'Pricing',
    );
    const loaded = loadDocument(saveDocument(createDocument(named)));
    assert.ok(loaded);
    assert.deepEqual(meetingOf(loaded), named);
  });

  it('shows the user’s rename when the model names the meeting elsewhere at the same time', () => {
    const shared = createDocument(base);
    const recorded = updateDocument(
      Automerge.clone(shared),
      base,
      setSummary(base, 'Text.', 'Launch date planning'),
    );
    const renamed = updateDocument(
      Automerge.clone(shared),
      base,
      renameMeeting(base, 'Pricing call'),
    );
    for (const merged of [
      mergeDocuments(recorded, renamed),
      mergeDocuments(renamed, recorded),
    ]) {
      assert.equal(meetingName(meetingOf(merged)), 'Pricing call');
    }
  });

  it('keeps one whole name when two devices rename at the same time', () => {
    const shared = createDocument(base);
    const laptop = updateDocument(
      Automerge.clone(shared),
      base,
      renameMeeting(base, 'Launch date planning'),
    );
    const phone = updateDocument(
      Automerge.clone(shared),
      base,
      renameMeeting(base, 'Pricing call'),
    );
    const name = meetingName(meetingOf(mergeDocuments(laptop, phone)));
    assert.ok(['Launch date planning', 'Pricing call'].includes(name), name);
    assert.equal(meetingName(meetingOf(mergeDocuments(phone, laptop))), name);
  });

  it('reads a document written before names were whole values', () => {
    const older = Automerge.from({
      schema: 1,
      id: 'm1',
      title: 'Typed as text',
      segments: [{ startedAt: 1, endedAt: 2 }],
      finishedAt: null,
      lines: {},
      summary: '',
      summaryEdited: false,
      deletedAt: null,
    });
    const loaded = loadDocument(Automerge.save(older));
    assert.ok(loaded);
    const meeting = meetingOf(loaded);
    assert.equal(meeting.title, 'Typed as text');
    assert.equal(meeting.titleEdited, false);
    assert.equal(meeting.generatedTitle, null);
  });

  it('keeps where a meeting was shared, merges shares made on two devices, and reads none from an older document', () => {
    const peer = 'ab'.repeat(32);
    const team = 'cd'.repeat(16);
    const shared = recordShare(base, {
      noteId: 'n1',
      target: peer,
      kind: 'person',
      sharedAt: 5,
    });
    const loaded = loadDocument(saveDocument(createDocument(shared)));
    assert.ok(loaded);
    assert.deepEqual(meetingOf(loaded).sharedAs, [
      { noteId: 'n1', target: peer, kind: 'person', sharedAt: 5 },
    ]);
    const laptop = updateDocument(
      Automerge.clone(loaded),
      shared,
      recordShare(shared, {
        noteId: 'n2',
        target: team,
        kind: 'team',
        sharedAt: 7,
      }),
    );
    const phone = updateDocument(
      Automerge.clone(loaded),
      shared,
      recordShare(shared, {
        noteId: 'n3',
        target: team,
        kind: 'team',
        sharedAt: 6,
      }),
    );
    assert.deepEqual(
      meetingOf(mergeDocuments(laptop, phone)).sharedAs.map(
        (copy) => copy.noteId,
      ),
      ['n1', 'n3', 'n2'],
    );
    const older = Automerge.from({
      schema: 1,
      id: 'm1',
      title: new Automerge.ImmutableString('Before sharing'),
      segments: [{ startedAt: 1, endedAt: 2 }],
      finishedAt: null,
      lines: {},
      summary: '',
      summaryEdited: false,
      titleEdited: false,
      generatedTitle: null,
      deletedAt: null,
    });
    const before = loadDocument(Automerge.save(older));
    assert.ok(before);
    assert.deepEqual(meetingOf(before).sharedAs, []);
    const planted = Automerge.change(Automerge.clone(before), (fields) => {
      fields.sharedAs = {
        'bad id!': { target: peer, kind: 'person', sharedAt: 1 },
        ok: { target: 'not a target', kind: 'person', sharedAt: 1 },
        other: { target: peer, kind: 'team', sharedAt: Number.NaN },
      };
    });
    assert.deepEqual(meetingOf(planted).sharedAs, []);
  });

  it('keeps a folder through saving, and reads none from a document written before folders', () => {
    const filed = moveToFolder(base, 'Clients');
    const loaded = loadDocument(saveDocument(createDocument(filed)));
    assert.ok(loaded);
    assert.equal(meetingOf(loaded).folder, 'Clients');

    const older = Automerge.from({
      schema: 1,
      id: 'm1',
      title: new Automerge.ImmutableString('Before folders'),
      segments: [{ startedAt: 1, endedAt: 2 }],
      finishedAt: null,
      lines: {},
      summary: '',
      summaryEdited: false,
      titleEdited: false,
      generatedTitle: null,
      deletedAt: null,
    });
    const before = loadDocument(Automerge.save(older));
    assert.ok(before);
    const unfiled = meetingOf(before);
    assert.equal(unfiled.folder, null);

    const filedHere = updateDocument(
      Automerge.clone(before),
      unfiled,
      moveToFolder(unfiled, 'Clients'),
    );
    const editedOnOlderDevice = Automerge.change(
      Automerge.clone(older),
      (fields) => {
        fields.summaryEdited = true;
      },
    );
    for (const merged of [
      mergeDocuments(filedHere, editedOnOlderDevice),
      mergeDocuments(editedOnOlderDevice, filedHere),
    ]) {
      const meeting = meetingOf(merged);
      assert.equal(meeting.folder, 'Clients');
      assert.equal(meeting.summaryEdited, true);
    }
  });

  it('keeps a move to a folder and a rename made on different devices', () => {
    const shared = createDocument(base);
    const laptop = updateDocument(
      Automerge.clone(shared),
      base,
      moveToFolder(base, 'Clients'),
    );
    const phone = updateDocument(
      Automerge.clone(shared),
      base,
      renameMeeting(base, 'Pricing call'),
    );
    for (const merged of [
      mergeDocuments(laptop, phone),
      mergeDocuments(phone, laptop),
    ]) {
      const meeting = meetingOf(merged);
      assert.equal(meeting.folder, 'Clients');
      assert.equal(meetingName(meeting), 'Pricing call');
    }
  });

  it('settles on the same single folder when two devices file a meeting at once', () => {
    const shared = createDocument(moveToFolder(base, 'Inbox'));
    const filed = moveToFolder(base, 'Inbox');
    const laptop = updateDocument(
      Automerge.clone(shared),
      filed,
      moveToFolder(filed, 'Clients'),
    );
    const phone = updateDocument(
      Automerge.clone(shared),
      filed,
      moveToFolder(filed, null),
    );
    const merged = mergeDocuments(laptop, phone);
    assert.equal(
      Object.keys(Automerge.getConflicts(merged, 'folder') ?? {}).length,
      2,
    );
    const folder = meetingOf(merged).folder;
    assert.ok(folder === 'Clients' || folder === null, String(folder));
    assert.equal(meetingOf(mergeDocuments(phone, laptop)).folder, folder);
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

describe('an imported meeting', () => {
  const imported: Meeting = {
    ...finishMeeting(startMeeting('imported-a', 'Planning', 1_000), 9_000),
    summary: 'Ship on Friday',
    transcript: [
      { id: 'l0', speaker: 'me', startMs: 0, endMs: 500, text: 'Hello.' },
    ],
  };

  // Pinned on purpose: if this changes, devices on the old and new version
  // would write different first changes as the same author. Bump the import
  // encoding in document.ts, then update the hash.
  it('writes the same first change as earlier versions', () => {
    assert.deepEqual(Automerge.getHeads(importedDocument(imported)), [
      'a204d28c9e6ed767e064c17bd97efb206a9f876d07c7716315ad18390e231287',
    ]);
  });

  it('reads back as the meeting it was built from', () => {
    assert.deepEqual(meetingOf(importedDocument(imported)), imported);
  });

  // Two devices import the same file before they first sync. Each run builds
  // fresh copies, so an unlucky pick between unrelated histories would show.
  it('keeps an edit made on one device after merging with the other', () => {
    for (let run = 0; run < 20; run += 1) {
      const here = importedDocument(imported);
      const there = importedDocument(imported);
      const edited = updateDocument(
        here,
        imported,
        editSummary(imported, 'Ship on Monday'),
      );
      assert.equal(
        meetingOf(mergeDocuments(there, edited)).summary,
        'Ship on Monday',
      );
      assert.equal(
        meetingOf(mergeDocuments(edited, there)).summary,
        'Ship on Monday',
      );
    }
  });

  it('lets each device write as its own author afterwards', () => {
    const here = updateDocument(
      importedDocument(imported),
      imported,
      renameMeeting(imported, 'Here'),
    );
    const there = updateDocument(
      importedDocument(imported),
      imported,
      editSummary(imported, 'There'),
    );
    const merged = meetingOf(mergeDocuments(here, there));
    assert.equal(merged.title, 'Here');
    assert.equal(merged.summary, 'There');
  });
});
