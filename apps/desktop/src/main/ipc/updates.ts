import { shell } from 'electron';
import { IpcChannel, IpcEvent, type UpdateState } from '../../shared/ipc.ts';
import { broadcast, handleFromApp } from '../security/sender.ts';
import type { Updater } from '../updates/updater.ts';

export function registerUpdatesIpc(appUrl: string, updater: Updater): void {
  handleFromApp(appUrl, IpcChannel.getUpdateState, updater.state);
  handleFromApp(appUrl, IpcChannel.checkForUpdatesNow, updater.check);
  handleFromApp(appUrl, IpcChannel.installUpdate, updater.install);
  handleFromApp(appUrl, IpcChannel.openUpdatePage, async () => {
    const page = updater.releasePage();
    if (page === null) {
      throw new Error('No update is available.');
    }
    await shell.openExternal(page);
  });
}

export function broadcastUpdate(state: UpdateState): void {
  broadcast(IpcEvent.onUpdateChanged, state);
}
