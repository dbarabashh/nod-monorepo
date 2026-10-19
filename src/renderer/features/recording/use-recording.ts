import { useEffect, useState } from 'react';
import type { RecordingState } from '../../../shared/ipc.ts';
import { useAsync } from '../../lib/use-async.ts';
import { getRecording, onRecordingChanged } from './api.ts';
import { elapsedMs } from './lib/clock.ts';

export function useRecording(): RecordingState {
  const { state } = useAsync(getRecording, onRecordingChanged);
  return state.status === 'ready' ? state.value : { status: 'idle' };
}

export function useElapsed(recording: RecordingState): number {
  const [now, setNow] = useState(() => Date.now());
  const recordingNow = recording.status === 'recording';
  useEffect(() => {
    if (!recordingNow) {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [recordingNow]);
  return elapsedMs(recording, now);
}
