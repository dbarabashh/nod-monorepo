import { IpcChannel, IpcEvent } from '../../shared/ipc.ts';
import { broadcast, handleFromApp } from '../security/sender.ts';
import type { SyncController } from '../sync/controller.ts';
import type { createSyncHandlers } from '../sync/handlers.ts';

export function registerSyncIpc(
  appUrl: string,
  handlers: ReturnType<typeof createSyncHandlers>,
): void {
  handleFromApp(appUrl, IpcChannel.getSyncState, handlers.getSyncState);
  handleFromApp(
    appUrl,
    IpcChannel.createRecoveryPhrase,
    handlers.createRecoveryPhrase,
  );
  handleFromApp(
    appUrl,
    IpcChannel.enterRecoveryPhrase,
    handlers.enterRecoveryPhrase,
  );
  handleFromApp(
    appUrl,
    IpcChannel.showRecoveryPhrase,
    handlers.showRecoveryPhrase,
  );
  handleFromApp(appUrl, IpcChannel.showPairingCode, handlers.showPairingCode);
  handleFromApp(appUrl, IpcChannel.chooseSyncFolder, handlers.chooseSyncFolder);
  handleFromApp(appUrl, IpcChannel.connectSyncRelay, handlers.connectSyncRelay);
  handleFromApp(appUrl, IpcChannel.disconnectSync, handlers.disconnectSync);
  handleFromApp(
    appUrl,
    IpcChannel.changeRecoveryPhrase,
    handlers.changeRecoveryPhrase,
  );
  handleFromApp(appUrl, IpcChannel.syncNow, handlers.syncNow);
  handleFromApp(appUrl, IpcChannel.listSyncDevices, handlers.listSyncDevices);
  handleFromApp(appUrl, IpcChannel.forgetSyncDevice, handlers.forgetSyncDevice);
}

export function broadcastSync(controller: SyncController): void {
  broadcast(IpcEvent.onSyncChanged, controller.state());
}
