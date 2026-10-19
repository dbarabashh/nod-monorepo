import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isAppUrl } from './navigation.ts';

function assertAppSender(event: IpcMainInvokeEvent, appUrl: string): void {
  const url = event.senderFrame?.url;
  if (url === undefined || !isAppUrl(url, appUrl)) {
    throw new Error('Refused an IPC call from outside the app');
  }
}

export function handleFromApp(
  appUrl: string,
  channel: string,
  handler: (...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertAppSender(event, appUrl);
    return handler(...args);
  });
}
