import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { finishMeeting, startMeeting } from '@nod/core/meetings';
import type { RecorderState } from './recorder.ts';
import { meetingRecording } from './status.ts';

const idle: RecorderState = { status: 'idle', problem: null };

describe('meetingRecording', () => {
  const meeting = startMeeting('m-1', 'Planning', 100_000);

  it('knows what this phone records or paused', () => {
    assert.equal(
      meetingRecording(
        meeting,
        {
          status: 'recording',
          meetingId: 'm-1',
          segmentStartedAt: 100_000,
          previousMs: 0,
          interrupted: false,
          problem: null,
        },
        500_000,
      ),
      'recording',
    );
    assert.equal(
      meetingRecording(
        meeting,
        { status: 'paused', meetingId: 'm-1', problem: null },
        500_000,
      ),
      'paused',
    );
  });

  it('leaves a meeting another device saved moments ago to that device', () => {
    assert.equal(meetingRecording(meeting, idle, 119_999), 'elsewhere');
    assert.equal(meetingRecording(meeting, idle, 120_000), 'paused');
  });

  it('says finished whatever else is going on', () => {
    assert.equal(
      meetingRecording(finishMeeting(meeting, 101_000), idle, 101_000),
      'finished',
    );
  });
});
