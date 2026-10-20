import type { MeetingImportResult } from '../../../shared/ipc.ts';

export function importMeetings(): Promise<MeetingImportResult> {
  return window.api.importMeetings();
}
