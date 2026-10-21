import type { Meeting } from '../types.ts';

export type MeetingGroup = {
  label: string;
  meetings: Meeting[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.round((startOfDay(later) - startOfDay(earlier)) / DAY_MS);
}

export function dayLabel(date: Date, now: Date, locale: string): string {
  const days = daysBetween(now, date);
  if (days === 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days > 1 && days < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  }).format(date);
}

export function groupByDay(
  meetings: Meeting[],
  now: Date,
  locale: string,
): MeetingGroup[] {
  const sorted = meetings.toSorted(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  );
  const groups: MeetingGroup[] = [];
  for (const meeting of sorted) {
    const label = dayLabel(meeting.startedAt, now, locale);
    const last = groups.at(-1);
    if (last?.label === label) {
      last.meetings.push(meeting);
    } else {
      groups.push({ label, meetings: [meeting] });
    }
  }
  return groups;
}
