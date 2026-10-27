import type { AppState, UpdateState } from '../../../shared/ipc.ts';

export function getUpdateState(): Promise<UpdateState> {
  return window.api.getUpdateState();
}

export function onUpdateChanged(
  callback: (state: UpdateState) => void,
): () => void {
  return window.api.onUpdateChanged(callback);
}

export function checkForUpdatesNow(): Promise<void> {
  return window.api.checkForUpdatesNow();
}

export function installUpdate(): Promise<void> {
  return window.api.installUpdate();
}

export function openUpdatePage(): Promise<void> {
  return window.api.openUpdatePage();
}

export function getAppState(): Promise<AppState> {
  return window.api.getAppState();
}

export function setCheckForUpdates(enabled: boolean): Promise<AppState> {
  return window.api.setCheckForUpdates(enabled);
}

export function setTestUpdates(enabled: boolean): Promise<AppState> {
  return window.api.setTestUpdates(enabled);
}

export function isLinux(): boolean {
  return window.api.platform === 'linux';
}
