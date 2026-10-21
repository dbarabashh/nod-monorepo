import type { RecordingState } from '../../../../shared/ipc.ts';

export function elapsedMs(state: RecordingState, now: number): number {
  if (state.status !== 'recording') {
    return 0;
  }
  return state.previousMs + Math.max(0, now - state.segmentStartedAt);
}
