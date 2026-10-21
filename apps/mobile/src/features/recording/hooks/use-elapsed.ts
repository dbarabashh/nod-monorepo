import { useEffect, useState } from 'react';
import type { RecorderState } from '../../../lib/recording/recording.ts';

// What the meeting has recorded so far, counting earlier segments, ticking
// each second while the microphone is on.
export function useElapsed(recorder: RecorderState): number {
  const live = recorder.status === 'recording' ? recorder : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [live]);
  return live ? live.previousMs + Math.max(now - live.segmentStartedAt, 0) : 0;
}
