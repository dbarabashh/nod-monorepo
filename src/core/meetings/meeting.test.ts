import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  appendTranscript,
  cleanSummary,
  extendMeeting,
  finishMeeting,
  meetingStartedAt,
  meetingText,
  parseMeetings,
  recordedMs,
  resumeMeeting,
  serializeMeetings,
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

describe('the stored meetings file', () => {
  it('reads files written before meetings could be finished', () => {
    assert.deepEqual(
      parseMeetings({
        version: 1,
        meetings: [
          { id: 'old', title: 'Old', segments: [{ startedAt: 1, endedAt: 2 }] },
        ],
      }),
      [
        {
          id: 'old',
          title: 'Old',
          segments: [{ startedAt: 1, endedAt: 2 }],
          finishedAt: null,
          transcript: [],
          summary: null,
        },
      ],
    );
  });

  it('reads back what it wrote', () => {
    const meetings = [
      extendMeeting(startMeeting('m1', 'Design review', 1_000), 2_000),
    ];
    assert.deepEqual(
      parseMeetings(JSON.parse(JSON.stringify(serializeMeetings(meetings)))),
      meetings,
    );
  });

  it('refuses a file from an unknown version instead of guessing', () => {
    assert.throws(
      () => parseMeetings({ version: 2, meetings: [] }),
      /Unsupported meetings file version 2/,
    );
    assert.throws(() => parseMeetings(null), /not an object/);
  });

  it('refuses a file with a damaged meeting, so saving never erases it', () => {
    const good = {
      id: 'ok',
      title: 'Kept',
      segments: [{ startedAt: 1, endedAt: 2 }],
      finishedAt: 7,
      transcript: [],
      summary: null,
    };
    assert.deepEqual(parseMeetings({ version: 1, meetings: [good] }), [good]);
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
    ]) {
      assert.throws(
        () => parseMeetings({ version: 1, meetings: [good, damaged] }),
        /Meeting 2 in the meetings file is damaged/,
      );
    }
  });
});

describe('the transcript', () => {
  it('keeps lines in time order across both speakers and drops empty ones', () => {
    let meeting = startMeeting('m1', 'A', 0);
    meeting = appendTranscript(meeting, [
      {
        speaker: 'others',
        startMs: 4_000,
        endMs: 6_000,
        text: ' Sounds good. ',
      },
    ]);
    meeting = appendTranscript(meeting, [
      { speaker: 'me', startMs: 1_000, endMs: 3_000, text: 'Shall we start?' },
      { speaker: 'me', startMs: 7_000, endMs: 7_500, text: '   ' },
    ]);
    assert.deepEqual(meeting.transcript, [
      { speaker: 'me', startMs: 1_000, endMs: 3_000, text: 'Shall we start?' },
      { speaker: 'others', startMs: 4_000, endMs: 6_000, text: 'Sounds good.' },
    ]);
    assert.equal(
      transcriptText(meeting),
      'Me: Shall we start?\nOthers: Sounds good.',
    );
  });

  it("copies the transcript with each line's time and speaker", () => {
    const meeting = appendTranscript(startMeeting('m1', 'A', 0), [
      { speaker: 'me', startMs: 1_500, endMs: 3_000, text: 'Shall we start?' },
      { speaker: 'others', startMs: 65_000, endMs: 66_000, text: 'Yes.' },
      { speaker: 'me', startMs: 3_725_000, endMs: 3_726_000, text: 'Bye.' },
    ]);
    assert.equal(
      meetingText(meeting, 'transcript'),
      '[0:01] Me: Shall we start?\n[1:05] Others: Yes.\n[1:02:05] Me: Bye.',
    );
  });

  it('drops lines without a real time, which the file could not store', () => {
    const meeting = appendTranscript(startMeeting('m1', 'A', 0), [
      { speaker: 'me', startMs: Number.NaN, endMs: 1_000, text: 'Lost.' },
      { speaker: 'me', startMs: 0, endMs: Infinity, text: 'Lost too.' },
      { speaker: 'others', startMs: 2_000, endMs: 3_000, text: 'Kept.' },
    ]);
    assert.deepEqual(meeting.transcript, [
      { speaker: 'others', startMs: 2_000, endMs: 3_000, text: 'Kept.' },
    ]);
    assert.deepEqual(
      parseMeetings(JSON.parse(JSON.stringify(serializeMeetings([meeting])))),
      [meeting],
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

  it('refuses a file whose transcript is damaged', () => {
    assert.throws(
      () =>
        parseMeetings({
          version: 1,
          meetings: [
            {
              id: 'm',
              title: 't',
              segments: [{ startedAt: 1, endedAt: 2 }],
              transcript: [
                { speaker: 'robot', startMs: 0, endMs: 1, text: 'x' },
              ],
            },
          ],
        }),
      /damaged/,
    );
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
