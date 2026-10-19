import type { AppState } from '../../../shared/ipc.ts';

export function getAppState(): Promise<AppState> {
  return window.api.getAppState();
}

export function completeOnboarding(): Promise<AppState> {
  return window.api.completeOnboarding();
}
