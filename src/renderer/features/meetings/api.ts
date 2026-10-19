import type {
  MeetingDetail,
  MeetingPart,
  MeetingSummary,
} from '../../../shared/ipc.ts';
import type { Meeting } from './types.ts';

function toMeeting(summary: MeetingSummary): Meeting {
  return {
    id: summary.id,
    title: summary.title,
    startedAt: new Date(summary.startedAt),
    durationSeconds: Math.round(summary.recordedMs / 1000),
    status: summary.status,
    contentVersion: summary.contentVersion,
  };
}

export async function listMeetings(): Promise<Meeting[]> {
  return (await window.api.listMeetings()).map(toMeeting);
}

export function onMeetingsChanged(
  callback: (meetings: Meeting[]) => void,
): () => void {
  return window.api.onMeetingsChanged((meetings) =>
    callback(meetings.map(toMeeting)),
  );
}

export function getMeeting(id: string): Promise<MeetingDetail> {
  return window.api.getMeeting(id);
}

export function copyMeeting(id: string, part: MeetingPart): Promise<void> {
  return window.api.copyMeeting(id, part);
}
