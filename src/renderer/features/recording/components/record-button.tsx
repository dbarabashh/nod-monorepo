import { Button, Icon } from '../../../components/ui/index.ts';
import { finishMeeting, pauseRecording, startRecording } from '../api.ts';
import { formatClock } from '../../../lib/format-clock.ts';
import { useElapsed, useRecording } from '../use-recording.ts';
import { StartNotice } from './start-notice.tsx';
import { useStart } from './use-start.ts';

const titleFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function RecordButton() {
  const recording = useRecording();
  const elapsed = useElapsed(recording);
  const { start, starting, notice } = useStart();

  return (
    <div className="record-button">
      <StartNotice notice={notice} />
      {recording.status === 'recording' ? (
        <>
          <Button variant="outline" onClick={() => void pauseRecording()}>
            <span className="record-button__dot" aria-hidden />
            Pause ·{' '}
            <time className="record-button__clock">{formatClock(elapsed)}</time>
          </Button>
          <Button
            variant="danger"
            onClick={() => void finishMeeting(recording.meetingId)}
          >
            Finish
          </Button>
        </>
      ) : (
        <Button
          disabled={starting}
          onClick={() =>
            void start(() =>
              startRecording(`Meeting on ${titleFormat.format(new Date())}`),
            )
          }
        >
          <Icon name="plus" />
          {starting ? 'Starting…' : 'New recording'}
        </Button>
      )}
    </div>
  );
}
