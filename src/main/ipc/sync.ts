import { isSyncId } from '../../core/sync/index.ts';
import { IpcChannel, IpcEvent } from '../../shared/ipc.ts';
import { broadcast, handleFromApp } from '../security/sender.ts';
import type { SyncController } from '../sync/controller.ts';

const maxUrlLength = 2_048;
const maxPhraseLength = 1_000;

function phraseOf(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxPhraseLength) {
    throw new Error('That recovery phrase is not right. Check each word.');
  }
  return value;
}

function syncId(value: unknown): string {
  if (typeof value !== 'string' || !isSyncId(value)) {
    throw new Error('Unknown sync request');
  }
  return value;
}

function pairingCode(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) {
    throw new Error('That code is not valid');
  }
  return value;
}

function relayUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxUrlLength) {
    throw new Error('That relay address is not valid');
  }
  return value.trim();
}

export function registerSyncIpc(options: {
  appUrl: string;
  controller: SyncController;
  chooseFolder: () => Promise<string | null>;
  syncSoon: () => void;
}): void {
  const { appUrl, controller, chooseFolder, syncSoon } = options;
  handleFromApp(appUrl, IpcChannel.getSyncState, controller.state);
  handleFromApp(appUrl, IpcChannel.chooseSyncFolder, async () => {
    const folder = await chooseFolder();
    if (folder) {
      await controller.useFolder(folder);
      syncSoon();
    }
  });
  handleFromApp(appUrl, IpcChannel.connectSyncRelay, async (url, vaultId) => {
    await controller.useRelay(
      relayUrl(url),
      vaultId === '' ? null : syncId(vaultId),
    );
    syncSoon();
  });
  handleFromApp(appUrl, IpcChannel.approveSyncDevice, (requestId, code) =>
    controller.approve(syncId(requestId), pairingCode(code)),
  );
  handleFromApp(appUrl, IpcChannel.confirmSyncJoin, async (code) => {
    await controller.confirmJoin(pairingCode(code));
    syncSoon();
  });
  handleFromApp(appUrl, IpcChannel.rejectSyncDevice, (requestId) =>
    controller.reject(syncId(requestId)),
  );
  handleFromApp(appUrl, IpcChannel.cancelSyncJoin, controller.cancelJoin);
  handleFromApp(appUrl, IpcChannel.stopSync, controller.stop);
  handleFromApp(
    appUrl,
    IpcChannel.getRecoveryPhrase,
    controller.recoveryPhrase,
  );
  handleFromApp(
    appUrl,
    IpcChannel.confirmRecoveryPhrase,
    controller.confirmRecoveryPhrase,
  );
  handleFromApp(appUrl, IpcChannel.restoreSyncFromFolder, async (phrase) => {
    const words = phraseOf(phrase);
    const folder = await chooseFolder();
    if (folder) {
      await controller.restoreFromFolder(folder, words);
      syncSoon();
    }
  });
  handleFromApp(
    appUrl,
    IpcChannel.restoreSyncFromRelay,
    async (url, vaultId, phrase) => {
      await controller.restoreFromRelay(
        relayUrl(url),
        syncId(vaultId),
        phraseOf(phrase),
      );
      syncSoon();
    },
  );
  handleFromApp(appUrl, IpcChannel.syncNow, async () => {
    syncSoon();
  });
}

export function broadcastSync(controller: SyncController): void {
  broadcast(IpcEvent.onSyncChanged, controller.state());
}
