import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Meeting } from '../types.ts';
import { dayLabel, groupByDay } from './group-by-day.ts';

const now = new Date(2026, 9, 18, 15, 0);

function meeting(id: string, startedAt: Date): Meeting {
  return {
    id,
    title: id,
    startedAt,
    durationSeconds: 600,
    folder: null,
    status: 'finished',
    contentVersion: '',
  };
}

describe('dayLabel', () => {
  it('names today and yesterday by calendar day, not by 24-hour distance', () => {
    assert.equal(dayLabel(new Date(2026, 9, 18, 0, 5), now, 'en-US'), 'Today');
    assert.equal(
      dayLabel(new Date(2026, 9, 17, 23, 55), now, 'en-US'),
      'Yesterday',
    );
  });

  it('uses the weekday for the rest of the last week', () => {
    assert.equal(dayLabel(new Date(2026, 9, 16, 9, 0), now, 'en-US'), 'Friday');
    assert.equal(dayLabel(new Date(2026, 9, 12, 9, 0), now, 'en-US'), 'Monday');
  });

  it('switches to a date from seven days back', () => {
    assert.equal(
      dayLabel(new Date(2026, 9, 11, 9, 0), now, 'en-US'),
      'October 11',
    );
  });

  it('adds the year only for another year', () => {
    assert.equal(
      dayLabel(new Date(2025, 11, 30, 9, 0), now, 'en-US'),
      'December 30, 2025',
    );
  });
});

describe('groupByDay', () => {
  it('returns no groups for no meetings', () => {
    assert.deepEqual(groupByDay([], now, 'en-US'), []);
  });

  it('groups by day, newest day first and newest meeting first within a day', () => {
    const morning = meeting('morning', new Date(2026, 9, 18, 9, 0));
    const afternoon = meeting('afternoon', new Date(2026, 9, 18, 14, 0));
    const yesterday = meeting('yesterday', new Date(2026, 9, 17, 11, 0));

    const groups = groupByDay([morning, yesterday, afternoon], now, 'en-US');

    assert.deepEqual(
      groups.map((group) => [group.label, group.meetings.map((m) => m.id)]),
      [
        ['Today', ['afternoon', 'morning']],
        ['Yesterday', ['yesterday']],
      ],
    );
  });

  it('does not reorder the input array', () => {
    const input = [
      meeting('a', new Date(2026, 9, 17, 9, 0)),
      meeting('b', new Date(2026, 9, 18, 9, 0)),
    ];

    groupByDay(input, now, 'en-US');

    assert.deepEqual(
      input.map((m) => m.id),
      ['a', 'b'],
    );
  });
});
