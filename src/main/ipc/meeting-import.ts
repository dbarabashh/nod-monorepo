import { IpcChannel, type MeetingImportResult } from '../../shared/ipc.ts';
import { handleFromApp } from '../security/sender.ts';

export function registerMeetingImportIpc(
  appUrl: string,
  importMeetings: () => Promise<MeetingImportResult>,
): void {
  handleFromApp(appUrl, IpcChannel.importMeetings, importMeetings);
}
