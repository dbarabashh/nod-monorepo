import type { AppState } from '../../shared/ipc.ts';

export const defaultAppState: AppState = {
  onboardingCompleted: false,
  suggestMeetings: true,
  quietMeetingApps: [],
};

const maxQuietApps = 100;

function field(raw: object, key: string): unknown {
  return Reflect.get(raw, key);
}

export function parseAppState(raw: unknown): AppState {
  if (typeof raw !== 'object' || raw === null) {
    return defaultAppState;
  }
  const quiet = field(raw, 'quietMeetingApps');
  return {
    onboardingCompleted: field(raw, 'onboardingCompleted') === true,
    suggestMeetings: field(raw, 'suggestMeetings') !== false,
    quietMeetingApps: Array.isArray(quiet)
      ? [
          ...new Set(
            quiet.filter(
              (key): key is string =>
                typeof key === 'string' && /^[a-z0-9-]{1,32}$/.test(key),
            ),
          ),
        ].slice(0, maxQuietApps)
      : [],
  };
}
