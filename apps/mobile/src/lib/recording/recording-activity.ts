import type { RecorderState } from './recorder.ts';

// What the Lock Screen may show: that this phone records, and since when.
// Never the meeting's name or words, which anyone holding the phone could read.
export type ActivityContent = { since: number };

export type ActivityStep =
  | { kind: 'start'; content: ActivityContent }
  | { kind: 'end' };

export function activityContent(state: RecorderState): ActivityContent | null {
  return state.status === 'recording'
    ? { since: state.segmentStartedAt - state.previousMs }
    : null;
}

export function nextActivityStep(
  shown: ActivityContent | null,
  wanted: ActivityContent | null,
): ActivityStep | null {
  if (wanted === null) {
    return shown === null ? null : { kind: 'end' };
  }
  return shown === null ? { kind: 'start', content: wanted } : null;
}
