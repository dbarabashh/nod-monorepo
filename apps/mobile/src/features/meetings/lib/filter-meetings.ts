import { meetingName, type Meeting } from '@nod/core/meetings';

export function filterMeetings(meetings: Meeting[], query: string): Meeting[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') {
    return meetings;
  }
  return meetings.filter((meeting) =>
    meetingName(meeting).toLocaleLowerCase().includes(needle),
  );
}
