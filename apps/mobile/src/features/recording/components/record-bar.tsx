import {
  finishRecording,
  pauseRecording,
  useRecorder,
} from '../../../lib/recording/recording.ts';
import { useElapsed } from '../hooks/use-elapsed.ts';
import { useRecordingStart } from '../hooks/use-recording-start.ts';
import { LevelBars } from './level-bars.tsx';
import {
  PausedControls,
  PillAction,
  RecordingControls,
  VoiceDock,
} from './voice-pill.tsx';

export function RecordBar() {
  const recorder = useRecorder();
  const elapsed = useElapsed(recorder);
  const { start, resume, starting, error, blocked } = useRecordingStart();

  return (
    <VoiceDock problem={error ?? recorder.problem} blocked={blocked}>
      <LevelBars
        live={recorder.status === 'recording' && !recorder.interrupted}
      />
      {recorder.status === 'recording' ? (
        <RecordingControls
          interrupted={recorder.interrupted}
          elapsed={elapsed}
          onPause={() => void pauseRecording()}
        />
      ) : recorder.status === 'paused' ? (
        <PausedControls
          starting={starting}
          onResume={() => resume(recorder.meetingId)}
          onFinish={() => void finishRecording()}
        />
      ) : (
        <PillAction
          label={starting ? 'Starting…' : 'New recording'}
          tone="go"
          disabled={starting}
          busy={starting}
          onPress={start}
        />
      )}
    </VoiceDock>
  );
}
