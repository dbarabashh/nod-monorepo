import type { AppState } from '../../shared/ipc.ts';

export const defaultAppState: AppState = { onboardingCompleted: false };

export function parseAppState(raw: unknown): AppState {
  if (typeof raw !== 'object' || raw === null) {
    return defaultAppState;
  }
  const completed =
    'onboardingCompleted' in raw ? raw.onboardingCompleted : undefined;
  return {
    onboardingCompleted: completed === true,
  };
}
