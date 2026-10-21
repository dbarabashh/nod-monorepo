import type { Meeting } from '@nod/core/meetings';
import type { RecorderState } from './recorder.ts';

export type MeetingRecording =
  | 'finished'
  | 'recording'
  | 'paused'
  | 'elsewhere';

// Another device recording a meeting saves it every few seconds; a meeting
// unfinished but quiet for longer is paused, and this phone may resume it.
const liveWithinMs = 20_000;

export function meetingRecording(
  meeting: Meeting,
  recorder: RecorderState,
  now: number,
): MeetingRecording {
  if (meeting.finishedAt !== null) {
    return 'finished';
  }
  if (recorder.status !== 'idle' && recorder.meetingId === meeting.id) {
    return recorder.status;
  }
  const lastSaved = meeting.segments.at(-1)?.endedAt ?? 0;
  return now - lastSaved < liveWithinMs ? 'elsewhere' : 'paused';
}
