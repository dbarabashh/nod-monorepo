import type {
  MeetingsDeleteResult,
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
    folder: summary.folder,
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

export function summarizeMeeting(id: string): Promise<void> {
  return window.api.summarizeMeeting(id);
}

export function editSummary(
  id: string,
  markdown: string,
  version: string,
): Promise<string> {
  return window.api.editSummary(id, markdown, version);
}

export function editTranscriptLine(
  id: string,
  lineId: string,
  text: string,
): Promise<void> {
  return window.api.editTranscriptLine(id, lineId, text);
}

export function deleteMeeting(id: string): Promise<void> {
  return window.api.deleteMeeting(id);
}

export function renameMeeting(id: string, title: string): Promise<void> {
  return window.api.renameMeeting(id, title);
}

export function moveMeetingToFolder(
  id: string,
  folder: string | null,
): Promise<void> {
  return window.api.moveMeetingToFolder(id, folder);
}

export function renameFolder(from: string, to: string): Promise<string> {
  return window.api.renameFolder(from, to);
}

export function removeFolder(name: string): Promise<void> {
  return window.api.removeFolder(name);
}

export function deleteMeetings(ids: string[]): Promise<MeetingsDeleteResult> {
  return window.api.deleteMeetings(ids);
}
