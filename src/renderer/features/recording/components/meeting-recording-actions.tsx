import type { MeetingSummary } from '../../../../shared/ipc.ts';
import { Button } from '../../../components/ui/index.ts';
import { finishMeeting, pauseRecording, resumeRecording } from '../api.ts';
import { useRecording } from '../use-recording.ts';
import { StartNotice } from './start-notice.tsx';
import { useStart } from './use-start.ts';

type MeetingRecordingActionsProps = {
  meetingId: string;
  status: MeetingSummary['status'];
};

export function MeetingRecordingActions({
  meetingId,
  status,
}: MeetingRecordingActionsProps) {
  const recording = useRecording();
  const { start, starting, notice } = useStart();

  if (status === 'finished') {
    return null;
  }

  const finish = (
    <Button onClick={() => void finishMeeting(meetingId)}>
      Finish meeting
    </Button>
  );

  if (status === 'recording') {
    return (
      <div className="meeting-recording-actions">
        <Button variant="outline" onClick={() => void pauseRecording()}>
          Pause
        </Button>
        {finish}
      </div>
    );
  }

  return (
    <div className="meeting-recording-actions">
      <StartNotice notice={notice} />
      <Button
        variant="primary"
        disabled={starting || recording.status === 'recording'}
        onClick={() => void start(() => resumeRecording(meetingId))}
      >
        {starting ? 'Starting…' : 'Resume recording'}
      </Button>
      {finish}
    </div>
  );
}
