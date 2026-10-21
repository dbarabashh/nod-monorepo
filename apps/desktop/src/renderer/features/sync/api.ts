import type { SyncDevice, SyncState } from '../../../shared/ipc.ts';

export function getSyncState(): Promise<SyncState> {
  return window.api.getSyncState();
}

export function onSyncChanged(
  callback: (state: SyncState) => void,
): () => void {
  return window.api.onSyncChanged(callback);
}

export function createRecoveryPhrase(): Promise<void> {
  return window.api.createRecoveryPhrase();
}

export function enterRecoveryPhrase(phrase: string): Promise<boolean> {
  return window.api.enterRecoveryPhrase(phrase);
}

export function showRecoveryPhrase(): Promise<boolean> {
  return window.api.showRecoveryPhrase();
}

export function showPairingCode(): Promise<void> {
  return window.api.showPairingCode();
}

export function chooseSyncFolder(): Promise<void> {
  return window.api.chooseSyncFolder();
}

export function connectSyncRelay(url: string): Promise<void> {
  return window.api.connectSyncRelay(url);
}

export function disconnectSync(): Promise<void> {
  return window.api.disconnectSync();
}

export function syncNow(): Promise<void> {
  return window.api.syncNow();
}

export function changeRecoveryPhrase(): Promise<void> {
  return window.api.changeRecoveryPhrase();
}

export function listSyncDevices(): Promise<SyncDevice[]> {
  return window.api.listSyncDevices();
}

export function forgetSyncDevice(id: string): Promise<void> {
  return window.api.forgetSyncDevice(id);
}
