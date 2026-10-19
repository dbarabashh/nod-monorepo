import type { SyncState } from '../../../shared/ipc.ts';

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
