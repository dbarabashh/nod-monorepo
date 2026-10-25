import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { startMeeting, type Meeting } from '@nod/core/meetings';
import { filterMeetings } from './filter-meetings.ts';

function meeting(
  id: string,
  title: string,
  generatedTitle: string | null = null,
): Meeting {
  return { ...startMeeting(id, title, 1), generatedTitle };
}

const meetings = [
  meeting('a', 'Weekly Sync'),
  meeting('b', 'Meeting on Monday', 'Budget review'),
  meeting('c', 'Design crit'),
];

describe('filterMeetings', () => {
  it('keeps every meeting for an empty or blank query', () => {
    assert.deepEqual(
      filterMeetings(meetings, '').map((m) => m.id),
      ['a', 'b', 'c'],
    );
    assert.deepEqual(
      filterMeetings(meetings, '   ').map((m) => m.id),
      ['a', 'b', 'c'],
    );
  });

  it('matches any part of the name, ignoring case and outer spaces', () => {
    assert.deepEqual(
      filterMeetings(meetings, ' SYNC ').map((m) => m.id),
      ['a'],
    );
  });

  it('matches the name shown in the list, not the placeholder title', () => {
    assert.deepEqual(
      filterMeetings(meetings, 'budget').map((m) => m.id),
      ['b'],
    );
    assert.deepEqual(
      filterMeetings(meetings, 'monday').map((m) => m.id),
      [],
    );
  });
});
