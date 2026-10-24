import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  appendTranscript,
  cleanSummary,
  cleanTitle,
  editSummary,
  editTranscriptLine,
  extendMeeting,
  finishMeeting,
  meetingName,
  meetingStartedAt,
  meetingText,
  moveToFolder,
  parseMeeting,
  recordedMs,
  recordShare,
  renameMeeting,
  resumeMeeting,
  setSummary,
  startMeeting,
  transcriptText,
} from './meeting.ts';

describe('recording a meeting', () => {
  it('counts only the time spent recording across resumed segments', () => {
    let meeting = startMeeting('m1', 'Standup', 1_000);
    meeting = extendMeeting(meeting, 61_000);
    meeting = resumeMeeting(meeting, 500_000);
    meeting = extendMeeting(meeting, 530_000);

    assert.deepEqual(meeting.segments, [
      { startedAt: 1_000, endedAt: 61_000 },
      { startedAt: 500_000, endedAt: 530_000 },
    ]);
    assert.equal(recordedMs(meeting), 90_000);
    assert.equal(meetingStartedAt(meeting), 1_000);
  });

  it('never moves the end of a segment backwards', () => {
    const meeting = extendMeeting(startMeeting('m1', 'A', 5_000), 9_000);
    assert.deepEqual(extendMeeting(meeting, 7_000), meeting);
  });

  it('does not change the meeting it was given', () => {
    const meeting = startMeeting('m1', 'A', 5_000);
    extendMeeting(meeting, 9_000);
    resumeMeeting(meeting, 20_000);
    assert.deepEqual(meeting.segments, [{ startedAt: 5_000, endedAt: 5_000 }]);
  });
});

describe('finishing a meeting', () => {
  it('keeps the first finish time and refuses to resume afterwards', () => {
    const finished = finishMeeting(startMeeting('m1', 'A', 1_000), 5_000);
    assert.equal(finished.finishedAt, 5_000);
    assert.equal(finishMeeting(finished, 9_000).finishedAt, 5_000);
    assert.throws(() => resumeMeeting(finished, 9_000), /cannot be resumed/);
  });
});

describe('reading a stored meeting', () => {
  it('reads a meeting saved before later fields existed, with their defaults', () => {
    assert.deepEqual(
      parseMeeting({
        id: 'old',
        title: 'Old',
        segments: [{ startedAt: 1, endedAt: 2 }],
      }),
      {
        id: 'old',
        title: 'Old',
        segments: [{ startedAt: 1, endedAt: 2 }],
        finishedAt: null,
        transcript: [],
        summary: null,
        summaryEdited: false,
        titleEdited: false,
        generatedTitle: null,
        folder: null,
        sharedAs: [],
      },
    );
  });

  it('reads back what it wrote', () => {
    const meeting = extendMeeting(
      startMeeting('m1', 'Design review', 1_000),
      2_000,
    );
    assert.deepEqual(
      parseMeeting(JSON.parse(JSON.stringify(meeting))),
      meeting,
    );
  });

  it('refuses a damaged meeting instead of guessing', () => {
    for (const damaged of [
      { id: 'no-segments', title: 'x', segments: [] },
      { id: 'backwards', title: 'x', segments: [{ startedAt: 5, endedAt: 1 }] },
      { id: 7, title: 'x', segments: [{ startedAt: 1, endedAt: 2 }] },
      {
        id: 'bad-finish',
        title: 'x',
        segments: [{ startedAt: 1, endedAt: 2 }],
        finishedAt: 'yes',
      },
      'garbage',
      null,
    ]) {
      assert.equal(parseMeeting(damaged), null);
    }
  });
});

describe('the transcript', () => {
  it('keeps lines in time order across both speakers and drops empty ones', () => {
    let meeting = startMeeting('m1', 'A', 0);
    meeting = appendTranscript(meeting, [
      {
        id: 'others-4_000',
        speaker: 'others',
        startMs: 4_000,
        endMs: 6_000,
        text: ' Sounds good. ',
      },
    ]);
    meeting = appendTranscript(meeting, [
      {
        id: 'me-1_000',
        speaker: 'me',
        startMs: 1_000,
        endMs: 3_000,
        text: 'Shall we start?',
      },
      {
        id: 'me-7_000',
        speaker: 'me',
        startMs: 7_000,
        endMs: 7_500,
        text: '   ',
      },
    ]);
    assert.deepEqual(meeting.transcript, [
      {
        id: 'me-1_000',
        speaker: 'me',
        startMs: 1_000,
        endMs: 3_000,
        text: 'Shall we start?',
      },
      {
        id: 'others-4_000',
        speaker: 'others',
        startMs: 4_000,
        endMs: 6_000,
        text: 'Sounds good.',
      },
    ]);
    assert.equal(
      transcriptText(meeting),
      'Me: Shall we start?\nOthers: Sounds good.',
    );
  });

  it("copies the transcript with each line's time and speaker", () => {
    const meeting = appendTranscript(startMeeting('m1', 'A', 0), [
      {
        id: 'me-1_500',
        speaker: 'me',
        startMs: 1_500,
        endMs: 3_000,
        text: 'Shall we start?',
      },
      {
        id: 'others-65_000',
        speaker: 'others',
        startMs: 65_000,
        endMs: 66_000,
        text: 'Yes.',
      },
      {
        id: 'me-3_725_000',
        speaker: 'me',
        startMs: 3_725_000,
        endMs: 3_726_000,
        text: 'Bye.',
      },
    ]);
    assert.equal(
      meetingText(meeting, 'transcript'),
      '[0:01] Me: Shall we start?\n[1:05] Others: Yes.\n[1:02:05] Me: Bye.',
    );
  });

  it('names the meeting from the summary model, without the model’s wrapping', () => {
    const named = setSummary(
      startMeeting('m1', 'Meeting on Oct 19, 2026, 2:19 PM', 0),
      'We agreed to ship on Friday.',
      '  "Title: Launch date for the onboarding flow."\nExtra line',
    );
    assert.equal(meetingName(named), 'Launch date for the onboarding flow');
    assert.equal(named.title, 'Meeting on Oct 19, 2026, 2:19 PM');
    assert.equal(cleanTitle('## **Запуск онбордингу**'), 'Запуск онбордингу');
    assert.equal(cleanTitle('«Планування релізу»'), 'Планування релізу');
    assert.equal(cleanTitle('x'.repeat(100))?.length, 80);
  });

  it('keeps a name the user gave over one the model writes later', () => {
    const renamed = renameMeeting(
      startMeeting('m1', 'Meeting on Oct 19', 0),
      '  Pricing   call ',
    );
    assert.equal(renamed.title, 'Pricing call');
    assert.equal(renamed.titleEdited, true);
    assert.equal(
      meetingName(setSummary(renamed, 'Text.', 'Model name')),
      'Pricing call',
    );
    assert.throws(() => renameMeeting(renamed, '   '), /needs a name/);
  });

  it('cleans the odd shapes a model and a paste produce', () => {
    assert.equal(cleanTitle('Title:\nLaunch plan'), 'Launch plan');
    assert.equal(cleanTitle('*Launch plan*'), 'Launch plan');
    assert.equal(cleanTitle('<think>hmm</think>Launch plan'), 'Launch plan');
    assert.equal([...(cleanTitle('😀'.repeat(100)) ?? '')].length, 80);
    assert.equal(
      renameMeeting(startMeeting('m1', 'A', 0), 'Bad\u202enamegpj.exe\u0007')
        .title,
      'Bad namegpj.exe',
    );
  });

  it('keeps the old name when the model gives no usable title', () => {
    const meeting = startMeeting('m1', 'Weekly sync', 0);
    assert.equal(
      meetingName(setSummary(meeting, 'Text.', '  "" ')),
      'Weekly sync',
    );
    assert.equal(meetingName(setSummary(meeting, 'Text.')), 'Weekly sync');
  });

  it('keeps a hand-edited summary and marks it so a new one won’t replace it unasked', () => {
    const written = setSummary(startMeeting('m1', 'A', 0), 'We met Jon Smth.');
    const edited = editSummary(written, '  We met **John Smith**.\n');
    assert.equal(edited.summary, 'We met **John Smith**.');
    assert.equal(edited.summaryEdited, true);
    assert.equal(setSummary(edited, 'Rewritten.').summaryEdited, false);
    assert.deepEqual(parseMeeting(JSON.parse(JSON.stringify(edited))), edited);
  });

  it('treats a summary cleared by hand as no summary', () => {
    const edited = editSummary(
      setSummary(startMeeting('m1', 'A', 0), 'Text.'),
      '   ',
    );
    assert.equal(edited.summary, null);
    assert.equal(edited.summaryEdited, false);
  });

  it('corrects one transcript line, and removes a line emptied by hand', () => {
    const meeting = appendTranscript(startMeeting('m1', 'A', 0), [
      {
        id: 'me-1_000',
        speaker: 'me',
        startMs: 1_000,
        endMs: 2_000,
        text: 'Ask Jon.',
      },
      {
        id: 'others-1_000',
        speaker: 'others',
        startMs: 1_000,
        endMs: 2_000,
        text: 'Jon here.',
      },
      {
        id: 'me-3_000',
        speaker: 'me',
        startMs: 3_000,
        endMs: 4_000,
        text: 'Когда тебе.',
      },
    ]);
    const fixed = editTranscriptLine(meeting, 'others-1_000', ' John here. ');
    assert.deepEqual(editTranscriptLine(fixed, 'me-3_000', '').transcript, [
      {
        id: 'me-1_000',
        speaker: 'me',
        startMs: 1_000,
        endMs: 2_000,
        text: 'Ask Jon.',
      },
      {
        id: 'others-1_000',
        speaker: 'others',
        startMs: 1_000,
        endMs: 2_000,
        text: 'John here.',
      },
    ]);
    assert.throws(
      () => editTranscriptLine(fixed, 'others-9', 'x'),
      /no longer in the transcript/,
    );
  });

  it('drops lines without a real time, which the file could not store', () => {
    const meeting = appendTranscript(startMeeting('m1', 'A', 0), [
      {
        id: 'lost',
        speaker: 'me',
        startMs: Number.NaN,
        endMs: 1_000,
        text: 'Lost.',
      },
      {
        id: 'me-0',
        speaker: 'me',
        startMs: 0,
        endMs: Infinity,
        text: 'Lost too.',
      },
      {
        id: 'others-2_000',
        speaker: 'others',
        startMs: 2_000,
        endMs: 3_000,
        text: 'Kept.',
      },
    ]);
    assert.deepEqual(meeting.transcript, [
      {
        id: 'others-2_000',
        speaker: 'others',
        startMs: 2_000,
        endMs: 3_000,
        text: 'Kept.',
      },
    ]);
    assert.deepEqual(
      parseMeeting(JSON.parse(JSON.stringify(meeting))),
      meeting,
    );
  });

  it('copies the summary as written, or nothing before there is one', () => {
    const meeting = startMeeting('m1', 'A', 0);
    assert.equal(meetingText(meeting, 'summary'), '');
    assert.equal(
      meetingText(setSummary(meeting, '## Summary\nWe shipped.'), 'summary'),
      'We shipped.',
    );
  });

  it('refuses a meeting whose transcript is damaged', () => {
    assert.equal(
      parseMeeting({
        id: 'm',
        title: 't',
        segments: [{ startedAt: 1, endedAt: 2 }],
        transcript: [{ speaker: 'robot', startMs: 0, endMs: 1, text: 'x' }],
      }),
      null,
    );
  });
});

describe('shared copies', () => {
  it('records each note once, newest replacing an entry for the same note', () => {
    const meeting = startMeeting('m1', 'Plan', 1_000);
    const target = 'ef'.repeat(16);
    const kind = 'team';
    const once = recordShare(meeting, {
      noteId: 'n1',
      target,
      kind,
      sharedAt: 1,
    });
    const again = recordShare(once, {
      noteId: 'n1',
      target,
      kind,
      sharedAt: 2,
    });
    assert.deepEqual(again.sharedAs, [
      { noteId: 'n1', target, kind, sharedAt: 2 },
    ]);
    assert.deepEqual(meeting.sharedAs, []);
  });

  it('reads shares as a list sorted by time, leaving out what it can’t read', () => {
    const target = 'ef'.repeat(16);
    const read = parseMeeting({
      ...startMeeting('m1', 'Plan', 1_000),
      sharedAs: [
        { noteId: 'n2', target, kind: 'team', sharedAt: 3 },
        { noteId: 7 },
        { noteId: 'n1', target, kind: 'person', sharedAt: 1 },
        { noteId: 'n3', target, kind: 'group', sharedAt: 2 },
      ],
    });
    assert.deepEqual(
      read?.sharedAs.map((copy) => copy.noteId),
      ['n1', 'n2'],
    );
    assert.deepEqual(
      parseMeeting({ ...startMeeting('m1', 'Plan', 1), sharedAs: { n1: {} } })
        ?.sharedAs,
      [],
    );
  });
});

describe('folders', () => {
  it('files a meeting under a cleaned name, and takes it out again', () => {
    const meeting = startMeeting('m1', 'Design review', 1_000);
    assert.equal(
      moveToFolder(meeting, '  Client\u202e work\n ').folder,
      'Client work',
    );
    assert.equal(
      moveToFolder(moveToFolder(meeting, 'Design'), null).folder,
      null,
    );
    assert.equal(meeting.folder, null);
  });

  it('reads a folder it can’t use as no folder, without losing the meeting', () => {
    for (const folder of [3, { id: 'f1' }, '  ', ['Clients']]) {
      assert.equal(
        parseMeeting({
          id: 'm1',
          title: 'Kept',
          segments: [{ startedAt: 1, endedAt: 2 }],
          folder,
        })?.folder,
        null,
        JSON.stringify(folder),
      );
    }
  });

  it('cleans a folder name that arrives from another device', () => {
    const read = parseMeeting({
      id: 'm1',
      title: 'Kept',
      segments: [{ startedAt: 1, endedAt: 2 }],
      folder: `Cafe\u0301\u202e ${'x'.repeat(200)}`,
    });
    assert.equal(read?.folder, `Caf\u00e9 ${'x'.repeat(74)}…`);
  });

  it('caps a long folder name and refuses an empty one', () => {
    const meeting = startMeeting('m1', 'Design review', 1_000);
    assert.equal(
      moveToFolder(meeting, 'x'.repeat(100)).folder,
      `${'x'.repeat(79)}…`,
    );
    assert.throws(() => moveToFolder(meeting, ' \t '), /folder needs a name/);
  });
});

describe('cleanSummary', () => {
  it('drops a leading Summary heading in any of the shapes a model writes', () => {
    for (const heading of [
      '**Summary**',
      '## Summary',
      'Summary:',
      '**summary:**',
    ]) {
      assert.equal(
        cleanSummary(`${heading}\nThe team agreed.`),
        'The team agreed.',
      );
    }
  });

  it('keeps summaries that start with real content', () => {
    assert.equal(
      cleanSummary('Summary of the risks is below.\n- One'),
      'Summary of the risks is below.\n- One',
    );
    assert.equal(cleanSummary('  ## Key points\n- A  '), '## Key points\n- A');
  });
});
