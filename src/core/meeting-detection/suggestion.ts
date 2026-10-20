import type { MeetingApp } from './apps.ts';

export type Detection = {
  apps: readonly MeetingApp[];
  recording: boolean;
  enabled: boolean;
  muted: ReadonlySet<string>;
};

export type SuggestionState = {
  since: ReadonlyMap<string, number>;
  handled: ReadonlySet<string>;
  showing: MeetingApp | null;
};

export const noSuggestion: SuggestionState = {
  since: new Map(),
  handled: new Set(),
  showing: null,
};

// A dedicated call app is the better guess when a browser holds the
// microphone at the same time.
function ranked(apps: readonly MeetingApp[]): MeetingApp[] {
  const unique = new Map(apps.map((app) => [app.key, app]));
  return [...unique.values()].sort(
    (a, b) => Number(a.kind === 'browser') - Number(b.kind === 'browser'),
  );
}

// An app is suggested once it has held the microphone for `holdMs`, so a
// quick dictation or a settings check doesn't, and only once per call: it
// can be suggested again after it lets the microphone go.
export function nextSuggestion(
  state: SuggestionState,
  detection: Detection,
  now: number,
  holdMs: number,
): { state: SuggestionState; checkAt: number | null } {
  const apps = ranked(detection.apps);
  const active = new Set(apps.map((app) => app.key));
  const since = new Map(
    apps.map((app) => [app.key, state.since.get(app.key) ?? now]),
  );
  const handled = new Set([...state.handled].filter((key) => active.has(key)));
  if (!detection.enabled || detection.recording) {
    return {
      state: {
        since,
        handled: new Set([...handled, ...active]),
        showing: null,
      },
      checkAt: null,
    };
  }
  const waiting = (app: MeetingApp) =>
    !handled.has(app.key) && !detection.muted.has(app.key);
  const showing =
    state.showing &&
    active.has(state.showing.key) &&
    !detection.muted.has(state.showing.key)
      ? state.showing
      : null;
  if (showing) {
    return { state: { since, handled, showing }, checkAt: null };
  }
  const ready = apps.find(
    (app) => waiting(app) && now - (since.get(app.key) ?? now) >= holdMs,
  );
  if (ready) {
    return {
      state: {
        since,
        handled: new Set([...handled, ready.key]),
        showing: ready,
      },
      checkAt: null,
    };
  }
  const pending = apps
    .filter(waiting)
    .map((app) => (since.get(app.key) ?? now) + holdMs);
  return {
    state: { since, handled, showing: null },
    checkAt: pending.length > 0 ? Math.min(...pending) : null,
  };
}

export function dismissSuggestion(state: SuggestionState): SuggestionState {
  return { ...state, showing: null };
}
