import { Platform } from 'react-native';
import type { LiveActivity } from 'expo-widgets';
import { colors, icon, space, type Colors } from '../../theme/index.ts';
import type {
  ActivityPalette,
  RecordingActivityProps,
} from './live-activity.tsx';
import type { RecorderState } from './recorder.ts';
import {
  activityContent,
  nextActivityStep,
  type ActivityContent,
} from './recording-activity.ts';

function palette(scheme: Colors): ActivityPalette {
  return {
    bg: scheme.surface,
    text: scheme.text,
    muted: scheme.textMuted,
    live: scheme.toneSuccessFg,
  };
}

function props(content: ActivityContent): RecordingActivityProps {
  return {
    since: content.since,
    light: palette(colors.light),
    dark: palette(colors.dark),
    gap: space[3],
    inset: space[4],
    iconSize: icon.lg,
  };
}

// While recording, the banner is renewed well before it goes stale; if the
// system kills the app, it stops claiming a recording within minutes.
const renewEveryMs = 60_000;
const staleAfterMs = 3 * 60_000;

type Shown = {
  content: ActivityContent;
  activity: LiveActivity<RecordingActivityProps>;
};

let current: Shown | null = null;
let renewing: ReturnType<typeof setInterval> | null = null;
let queue: Promise<void> = Promise.resolve();

// Live Activities are iOS only; the module is loaded there alone, since
// Android doesn't link expo-widgets.
function factory() {
  return import('./live-activity.tsx').then((module) => module.default);
}

function staleDate() {
  return new Date(Date.now() + staleAfterMs);
}

function enqueue(step: () => Promise<void>) {
  queue = queue.then(step).catch(() => undefined);
}

async function endAll() {
  const left = (await factory()).getInstances();
  await Promise.all(left.map((activity) => activity.end('immediate')));
}

function stopRenewing() {
  if (renewing !== null) {
    clearInterval(renewing);
    renewing = null;
  }
}

async function apply(wanted: ActivityContent | null) {
  const step = nextActivityStep(current?.content ?? null, wanted);
  if (step === null) {
    return;
  }
  if (step.kind === 'end') {
    stopRenewing();
    const ending = current;
    current = null;
    await ending?.activity.end('immediate').catch(endAll);
    return;
  }
  const activity = (await factory()).start(
    props(step.content),
    undefined,
    staleDate(),
  );
  current = { content: step.content, activity };
  renewing = setInterval(() => enqueue(renew), renewEveryMs);
}

async function renew() {
  if (current !== null) {
    await current.activity.update(props(current.content), staleDate());
  }
}

// A refusal (Live Activities turned off in Settings) leaves recording as it
// is; the banner is only a reminder.
export function showRecordingActivity(state: RecorderState) {
  if (Platform.OS !== 'ios') {
    return;
  }
  const wanted = activityContent(state);
  enqueue(() => apply(wanted));
}

// One left from a recording the system cut short with the app.
export function clearRecordingActivities() {
  if (Platform.OS !== 'ios') {
    return;
  }
  enqueue(async () => {
    if (current === null) {
      await endAll();
    }
  });
}
