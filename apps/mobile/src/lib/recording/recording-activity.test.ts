import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { activityContent, nextActivityStep } from './recording-activity.ts';

describe('activityContent', () => {
  it('counts from when the meeting would have started without pauses', () => {
    assert.deepEqual(
      activityContent({
        status: 'recording',
        meetingId: 'm',
        segmentStartedAt: 100_000,
        previousMs: 30_000,
        interrupted: false,
        problem: null,
      }),
      { since: 70_000 },
    );
  });

  it('shows nothing while paused or idle', () => {
    assert.equal(
      activityContent({ status: 'paused', meetingId: 'm', problem: null }),
      null,
    );
    assert.equal(activityContent({ status: 'idle', problem: null }), null);
  });

  it('carries only the start time, never the meeting', () => {
    const content = activityContent({
      status: 'recording',
      meetingId: 'secret-meeting',
      segmentStartedAt: 5,
      previousMs: 0,
      interrupted: true,
      problem: 'a problem',
    });
    assert.deepEqual(Object.keys(content ?? {}), ['since']);
  });
});

describe('nextActivityStep', () => {
  it('starts when recording begins and ends when it stops', () => {
    assert.deepEqual(nextActivityStep(null, { since: 1 }), {
      kind: 'start',
      content: { since: 1 },
    });
    assert.deepEqual(nextActivityStep({ since: 1 }, null), { kind: 'end' });
  });

  it('does nothing when nothing changed', () => {
    assert.equal(nextActivityStep(null, null), null);
    assert.equal(nextActivityStep({ since: 1 }, { since: 1 }), null);
  });
});
