import type { Meeting } from '../types.ts';

export function filterMeetings(meetings: Meeting[], query: string): Meeting[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') {
    return meetings;
  }
  return meetings.filter((meeting) =>
    meeting.title.toLocaleLowerCase().includes(needle),
  );
}
