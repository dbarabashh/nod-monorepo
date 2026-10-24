import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { importedDocument, readDocument } from './document.ts';
import { readMeetingExport } from './import.ts';
import { meetingName } from './meeting.ts';

function exported(meetings: unknown[]) {
  return { format: 'nod-meetings', version: 1, meetings };
}

const standup = {
  id: '5f0c1e2a-0b7d-4c55-9a51-3c1a2b3c4d5e',
  title: 'Weekly standup',
  startedAt: '2026-09-01T10:00:00Z',
  endedAt: '2026-09-01T10:30:00Z',
  summary: '## Decisions\n- Ship on Friday\n',
  transcript: [
    { speaker: 'others', startMs: 4_000, endMs: 6_000, text: 'And you?' },
    { speaker: 'me', startMs: 0, endMs: 3_500, text: ' Morning. ' },
  ],
};

describe('reading a meetings export', () => {
  it('turns each exported meeting into a finished meeting', () => {
    assert.deepEqual(readMeetingExport(exported([standup])), {
      skipped: 0,
      meetings: [
        {
          id: 'imported-5f0c1e2a-0b7d-4c55-9a51-3c1a2b3c4d5e',
          title: 'Weekly standup',
          titleEdited: true,
          generatedTitle: null,
          segments: [{ startedAt: 1788256800000, endedAt: 1788258600000 }],
          finishedAt: 1788258600000,
          summary: '## Decisions\n- Ship on Friday',
          summaryEdited: false,
          folder: null,
          sharedAs: [],
          transcript: [
            {
              id: 'imported-5f0c1e2a-0b7d-4c55-9a51-3c1a2b3c4d5e-00001',
              speaker: 'me',
              startMs: 0,
              endMs: 3_500,
              text: 'Morning.',
            },
            {
              id: 'imported-5f0c1e2a-0b7d-4c55-9a51-3c1a2b3c4d5e-00000',
              speaker: 'others',
              startMs: 4_000,
              endMs: 6_000,
              text: 'And you?',
            },
          ],
        },
      ],
    });
  });

  it('refuses a file in another format or version', () => {
    assert.equal(readMeetingExport({ format: 'other', version: 1 }), null);
    assert.equal(
      readMeetingExport({ format: 'nod-meetings', version: 2, meetings: [] }),
      null,
    );
    assert.equal(
      readMeetingExport({ format: 'nod-meetings', version: 1 }),
      null,
    );
    assert.equal(readMeetingExport([standup]), null);
  });

  it('leaves out numbers and times a meeting could not be stored with', () => {
    const result = readMeetingExport(
      exported([
        { ...standup, id: 'far', startedAt: '+275760-09-13T00:00:00.000Z' },
        { ...standup, id: 'loose', startedAt: 'Tue, 1 Sep 2026 10:00:00 GMT' },
        { ...standup, id: 'old', startedAt: '1999-12-31T23:59:59Z' },
        {
          ...standup,
          id: 'offsets',
          endedAt: null,
          transcript: [
            { speaker: 'me', startMs: 1e16, endMs: 1e16, text: 'Too late' },
            { speaker: 'me', startMs: 10.4, endMs: 1e16, text: 'Kept' },
            { speaker: 'me', startMs: 20.6, endMs: 30.2, text: 'Rounded' },
          ],
        },
      ]),
    );
    assert.equal(result?.skipped, 3);
    const meeting = result?.meetings[0];
    assert.deepEqual(
      meeting?.transcript.map(({ startMs, endMs, text }) => ({
        startMs,
        endMs,
        text,
      })),
      [
        { startMs: 10, endMs: 10, text: 'Kept' },
        { startMs: 21, endMs: 30, text: 'Rounded' },
      ],
    );
    assert.deepEqual(meeting?.segments, [
      { startedAt: 1788256800000, endedAt: 1788256800030 },
    ]);
  });

  it('leaves out a meeting whose lines add up to too much text', () => {
    const line = {
      speaker: 'me',
      startMs: 0,
      endMs: 1,
      text: 'x'.repeat(10_000),
    };
    const result = readMeetingExport(
      exported([
        { ...standup, id: 'long', transcript: Array(201).fill(line) },
        { ...standup, id: 'fits', transcript: Array(199).fill(line) },
      ]),
    );
    assert.equal(result?.skipped, 1);
    assert.deepEqual(
      result?.meetings.map((meeting) => meeting.id),
      ['imported-fits'],
    );
  });

  it('treats ids that differ only in case as one meeting', () => {
    const result = readMeetingExport(
      exported([
        { ...standup, id: 'ABC', title: 'First' },
        { ...standup, id: 'abc', title: 'Second' },
      ]),
    );
    assert.deepEqual(
      result?.meetings.map((meeting) => [meeting.id, meeting.title]),
      [['imported-abc', 'First']],
    );
  });

  it('replaces broken characters so the text reads the same after saving', () => {
    const meeting = readMeetingExport(
      exported([
        {
          ...standup,
          title: 'Plan \uD800',
          summary: 'Notes \uDC00',
          transcript: [
            { speaker: 'me', startMs: 0, endMs: 1, text: 'Hi \uD800' },
          ],
        },
      ]),
    )?.meetings[0];
    assert.equal(meeting?.title, 'Plan \uFFFD');
    assert.equal(meeting?.summary, 'Notes \uFFFD');
    assert.equal(meeting?.transcript[0]?.text, 'Hi \uFFFD');
  });

  it('keeps lines that start together in file order once stored', () => {
    const transcript = Array.from({ length: 11 }, (_, index) => ({
      speaker: 'me',
      startMs: 0,
      endMs: 1,
      text: `Line ${index}`,
    }));
    const meeting = readMeetingExport(exported([{ ...standup, transcript }]))
      ?.meetings[0];
    assert.ok(meeting);
    const stored = readDocument(importedDocument(meeting));
    assert.equal(stored?.kind, 'meeting');
    assert.deepEqual(
      stored?.kind === 'meeting'
        ? stored.meeting.transcript.map((entry) => entry.text)
        : [],
      [
        'Line 0',
        'Line 1',
        'Line 2',
        'Line 3',
        'Line 4',
        'Line 5',
        'Line 6',
        'Line 7',
        'Line 8',
        'Line 9',
        'Line 10',
      ],
    );
  });

  it('leaves out a meeting too large to open quickly', () => {
    const result = readMeetingExport(
      exported([
        { ...standup, id: 'summary', summary: 'x'.repeat(100_001) },
        {
          ...standup,
          id: 'line',
          transcript: [
            { speaker: 'me', startMs: 0, endMs: 1, text: 'x'.repeat(10_001) },
          ],
        },
        { ...standup, id: 'fits', summary: 'x'.repeat(100_000) },
      ]),
    );
    assert.equal(result?.skipped, 2);
    assert.deepEqual(
      result?.meetings.map((meeting) => meeting.id),
      ['imported-fits'],
    );
  });

  it('leaves out meetings it cannot read and counts them', () => {
    const result = readMeetingExport(
      exported([
        standup,
        { ...standup, id: '../escape' },
        { ...standup, id: 'b', startedAt: 'yesterday' },
        { ...standup, id: 'c', transcript: 'none' },
        { ...standup, id: 'd', summary: 5 },
        'not a meeting',
        { ...standup, title: 'Same id again' },
      ]),
    );
    assert.deepEqual(
      result?.meetings.map((meeting) => meeting.title),
      ['Weekly standup'],
    );
    assert.equal(result?.skipped, 5);
  });

  it('keeps a meeting but drops transcript lines it cannot read', () => {
    const result = readMeetingExport(
      exported([
        {
          ...standup,
          transcript: [
            { speaker: 'them', startMs: 0, endMs: 1, text: 'Unknown side' },
            { speaker: 'me', startMs: -5, endMs: 1, text: 'Before the start' },
            { speaker: 'me', startMs: 10, text: 'No end' },
            { speaker: 'me', startMs: 20, endMs: 5, text: 'Ends early' },
            { speaker: 'me', startMs: 30, endMs: 40, text: '   ' },
          ],
        },
      ]),
    );
    assert.deepEqual(result?.meetings[0]?.transcript, [
      {
        id: 'imported-5f0c1e2a-0b7d-4c55-9a51-3c1a2b3c4d5e-00002',
        speaker: 'me',
        startMs: 10,
        endMs: 10,
        text: 'No end',
      },
      {
        id: 'imported-5f0c1e2a-0b7d-4c55-9a51-3c1a2b3c4d5e-00003',
        speaker: 'me',
        startMs: 20,
        endMs: 20,
        text: 'Ends early',
      },
    ]);
  });

  it('files a meeting under the folder it was in, cleaned like any folder name', () => {
    const result = readMeetingExport(
      exported([
        { ...standup, id: 'a', folder: '  Clients\u202e ' },
        { ...standup, id: 'b', folder: '   ' },
        { ...standup, id: 'c', folder: 7 },
        { ...standup, id: 'd', folder: null },
        { ...standup, id: 'e' },
      ]),
    );
    assert.deepEqual(
      result?.meetings.map((meeting) => [meeting.id, meeting.folder]),
      [
        ['imported-a', 'Clients'],
        ['imported-b', null],
        ['imported-c', null],
        ['imported-d', null],
        ['imported-e', null],
      ],
    );
  });

  it('ends a meeting without an end where its transcript ends', () => {
    const meeting = readMeetingExport(exported([{ ...standup, endedAt: null }]))
      ?.meetings[0];
    assert.deepEqual(meeting?.segments, [
      { startedAt: 1788256800000, endedAt: 1788256806000 },
    ]);
    assert.equal(meeting?.finishedAt, 1788256806000);
  });

  it('never ends a meeting before it started', () => {
    const meeting = readMeetingExport(
      exported([{ ...standup, endedAt: '2026-09-01T09:00:00Z' }]),
    )?.meetings[0];
    assert.deepEqual(meeting?.segments, [
      { startedAt: 1788256800000, endedAt: 1788256800000 },
    ]);
  });

  it('names a meeting without a usable title and leaves an empty summary unset', () => {
    const meeting = readMeetingExport(
      exported([{ ...standup, title: ' ‮ ', summary: '  ' }]),
    )?.meetings[0];
    assert.ok(meeting);
    assert.equal(meetingName(meeting), 'Untitled meeting');
    assert.equal(meeting.titleEdited, false);
    assert.equal(meeting.summary, null);
    assert.equal(meeting.summaryEdited, false);
  });

  it('cleans a title the same way a rename does', () => {
    const meeting = readMeetingExport(
      exported([{ ...standup, title: 'Plan‮\nreview' }]),
    )?.meetings[0];
    assert.equal(meeting?.title, 'Plan review');
  });
});
