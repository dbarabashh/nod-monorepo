import { sampleMeetings } from './sample-meetings.ts';
import type { Meeting } from './types.ts';

export async function listMeetings(): Promise<Meeting[]> {
  return sampleMeetings(new Date());
}
