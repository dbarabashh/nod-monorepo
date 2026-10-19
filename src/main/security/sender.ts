import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isAppUrl } from './navigation.ts';

function assertAppSender(event: IpcMainInvokeEvent, appUrl: string): void {
  const url = event.senderFrame?.url;
  if (url === undefined || !isAppUrl(url, appUrl)) {
    throw new Error('Refused an IPC call from outside the app');
  }
}

export function listenFromApp(
  appUrl: string,
  channel: string,
  listener: (...args: unknown[]) => void,
): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    const url = event.senderFrame?.url;
    if (url !== undefined && isAppUrl(url, appUrl)) {
      listener(...args);
    }
  });
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

export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}
