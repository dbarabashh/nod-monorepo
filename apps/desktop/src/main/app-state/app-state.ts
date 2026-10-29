import type { AppState, ChosenModels } from '../../shared/ipc.ts';

export const defaultAppState: AppState = {
  onboardingCompleted: false,
  suggestMeetings: true,
  quietMeetingApps: [],
  checkForUpdates: true,
  testUpdates: false,
  chosenModels: { speech: null, summary: null },
};

const maxQuietApps = 100;

function field(raw: object, key: string): unknown {
  return Reflect.get(raw, key);
}

function modelId(raw: unknown, kind: keyof ChosenModels): string | null {
  const id =
    typeof raw === 'object' && raw !== null ? field(raw, kind) : undefined;
  return typeof id === 'string' && /^[a-z0-9.-]{1,64}$/.test(id) ? id : null;
}

export function parseAppState(raw: unknown): AppState {
  if (typeof raw !== 'object' || raw === null) {
    return defaultAppState;
  }
  const quiet = field(raw, 'quietMeetingApps');
  const chosen = field(raw, 'chosenModels');
  return {
    onboardingCompleted: field(raw, 'onboardingCompleted') === true,
    suggestMeetings: field(raw, 'suggestMeetings') !== false,
    checkForUpdates: field(raw, 'checkForUpdates') !== false,
    testUpdates: field(raw, 'testUpdates') === true,
    chosenModels: {
      speech: modelId(chosen, 'speech'),
      summary: modelId(chosen, 'summary'),
    },
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
