import {
  dismissSuggestion,
  meetingApp,
  nextSuggestion,
  noSuggestion,
  type MeetingApp,
  type SuggestionState,
} from '../../core/meeting-detection/index.ts';
import type { MicMonitor } from './monitor.ts';
import type { MicUse, MicUser } from './parse.ts';

const holdMs = 2_000;

export function createMeetingDetection(options: {
  monitor: MicMonitor | null;
  now: () => number;
  // Built once per report, as finding this app's own processes is not free.
  selfFilter: () => (user: MicUser) => boolean;
  recording: () => boolean;
  show: (app: MeetingApp) => void;
  hide: () => void;
}) {
  let apps: MeetingApp[] = [];
  let state: SuggestionState = noSuggestion;
  let enabled = false;
  let quiet = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stop: (() => void) | null = null;

  function meetingApps(use: MicUse): MeetingApp[] {
    if (!use) {
      return [];
    }
    const isSelf = options.selfFilter();
    return use
      .filter((user) => !isSelf(user))
      .map((user) => meetingApp(user.id))
      .filter((app) => app !== null);
  }

  function evaluate() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const before = state.showing;
    const next = nextSuggestion(
      state,
      {
        apps,
        recording: options.recording(),
        enabled,
        muted: quiet,
      },
      options.now(),
      holdMs,
    );
    state = next.state;
    if (state.showing && state.showing.key !== before?.key) {
      options.show(state.showing);
    } else if (!state.showing && before) {
      options.hide();
    }
    if (next.checkAt !== null) {
      timer = setTimeout(evaluate, Math.max(0, next.checkAt - options.now()));
    }
  }

  // Turned off, nothing watches the microphone at all: no helper, no
  // subscription, no polling.
  function watch(on: boolean) {
    if (on && !stop && options.monitor) {
      stop = options.monitor((use) => {
        apps = meetingApps(use);
        evaluate();
      });
    } else if (!on && stop) {
      stop();
      stop = null;
      apps = [];
    }
  }

  return {
    setSettings: (settings: { enabled: boolean; quiet: readonly string[] }) => {
      enabled = settings.enabled;
      quiet = new Set(settings.quiet);
      watch(enabled);
      evaluate();
    },
    refresh: evaluate,
    dismiss: () => {
      state = dismissSuggestion(state);
    },
    showing: () => state.showing,
  };
}
