import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Meeting } from '../types.ts';
import { filterMeetings } from './filter-meetings.ts';

function meeting(id: string, title: string): Meeting {
  return {
    id,
    title,
    startedAt: new Date(2026, 9, 18),
    durationSeconds: 60,
    folder: null,
    status: 'finished',
    contentVersion: '',
  };
}

const meetings = [
  meeting('sync', 'Weekly sync'),
  meeting('design', 'Design review'),
];

describe('filterMeetings', () => {
  it('returns every meeting for an empty or blank query', () => {
    assert.deepEqual(filterMeetings(meetings, ''), meetings);
    assert.deepEqual(filterMeetings(meetings, '   '), meetings);
  });

  it('matches the title case-insensitively', () => {
    assert.deepEqual(
      filterMeetings(meetings, 'WEEKLY').map((m) => m.id),
      ['sync'],
    );
  });

  it('matches part of a word inside the title', () => {
    assert.deepEqual(
      filterMeetings(meetings, 'view').map((m) => m.id),
      ['design'],
    );
  });

  it('returns nothing when nothing matches', () => {
    assert.deepEqual(filterMeetings(meetings, 'budget'), []);
  });
});
