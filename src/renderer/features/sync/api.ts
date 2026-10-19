import type { SyncState } from '../../../shared/ipc.ts';

export function getSyncState(): Promise<SyncState> {
  return window.api.getSyncState();
}

export function onSyncChanged(
  callback: (state: SyncState) => void,
): () => void {
  return window.api.onSyncChanged(callback);
}

export function chooseSyncFolder(): Promise<void> {
  return window.api.chooseSyncFolder();
}

export function connectSyncRelay(url: string, vaultId: string): Promise<void> {
  return window.api.connectSyncRelay(url, vaultId);
}

export function approveSyncDevice(
  requestId: string,
  code: string,
): Promise<void> {
  return window.api.approveSyncDevice(requestId, code);
}

export function confirmSyncJoin(code: string): Promise<void> {
  return window.api.confirmSyncJoin(code);
}

export function rejectSyncDevice(requestId: string): Promise<void> {
  return window.api.rejectSyncDevice(requestId);
}

export function cancelSyncJoin(): Promise<void> {
  return window.api.cancelSyncJoin();
}

export function stopSync(): Promise<void> {
  return window.api.stopSync();
}

export function syncNow(): Promise<void> {
  return window.api.syncNow();
}

export function getRecoveryPhrase(): Promise<string> {
  return window.api.getRecoveryPhrase();
}

export function restoreSyncFromFolder(phrase: string): Promise<void> {
  return window.api.restoreSyncFromFolder(phrase);
}

export function restoreSyncFromRelay(
  url: string,
  vaultId: string,
  phrase: string,
): Promise<void> {
  return window.api.restoreSyncFromRelay(url, vaultId, phrase);
}

export function confirmRecoveryPhrase(): Promise<void> {
  return window.api.confirmRecoveryPhrase();
}
