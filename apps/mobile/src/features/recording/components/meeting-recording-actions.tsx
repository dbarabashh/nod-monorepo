import {
  finishPaused,
  pauseRecording,
  useRecorder,
} from '../../../lib/recording/recording.ts';
import { meetingRecording } from '../../../lib/recording/status.ts';
import { useMeeting } from '../../../lib/sync/sync.ts';
import { useElapsed } from '../hooks/use-elapsed.ts';
import { useNow } from '../hooks/use-now.ts';
import { useRecordingStart } from '../hooks/use-recording-start.ts';
import { LevelBars } from './level-bars.tsx';
import {
  PausedControls,
  PillNote,
  RecordingControls,
  VoiceDock,
} from './voice-pill.tsx';

export function MeetingRecordingActions({ meetingId }: { meetingId: string }) {
  const meeting = useMeeting(meetingId);
  const recorder = useRecorder();
  const elapsed = useElapsed(recorder);
  const now = useNow(5_000);
  const { resume, starting, error, blocked } = useRecordingStart();
  if (!meeting) {
    return null;
  }
  const status = meetingRecording(meeting, recorder, now);
  if (status === 'finished') {
    return null;
  }
  const busyElsewhere =
    recorder.status === 'recording' && recorder.meetingId !== meetingId;
  const interrupted = recorder.status === 'recording' && recorder.interrupted;

  return (
    <VoiceDock
      problem={error ?? (status === 'recording' ? recorder.problem : null)}
      blocked={blocked}
    >
      <LevelBars live={status === 'recording' && !interrupted} />
      {status === 'elsewhere' ? (
        <PillNote>Recording on another device</PillNote>
      ) : status === 'recording' ? (
        <RecordingControls
          interrupted={interrupted}
          elapsed={elapsed}
          onPause={() => void pauseRecording()}
        />
      ) : (
        <PausedControls
          starting={starting}
          disabled={busyElsewhere}
          onResume={() => resume(meetingId)}
          onFinish={() => void finishPaused(meetingId)}
        />
      )}
    </VoiceDock>
  );
}
