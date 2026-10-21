import { useEffect, useState } from 'react';
import type { MeetingSummary } from '../../../../shared/ipc.ts';
import { Button } from '../../../components/ui/index.ts';
import {
  finishMeeting,
  onRecordingLevel,
  pauseRecording,
  resumeRecording,
} from '../api.ts';
import { useRecording } from '../use-recording.ts';
import { LevelBars } from './level-bars.tsx';
import { StartNotice } from './start-notice.tsx';
import { useStart } from './use-start.ts';

type MeetingRecordingActionsProps = {
  meetingId: string;
  status: MeetingSummary['status'];
};

function useCaptureLevel(live: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!live) {
      return undefined;
    }
    const stop = onRecordingLevel(setLevel);
    return () => {
      stop();
      setLevel(0);
    };
  }, [live]);
  return live ? level : 0;
}

export function MeetingRecordingActions({
  meetingId,
  status,
}: MeetingRecordingActionsProps) {
  const recording = useRecording();
  const { start, starting, notice } = useStart();
  const live = status === 'recording';
  const level = useCaptureLevel(live);

  if (status === 'finished') {
    return null;
  }

  return (
    <div className="voice-dock">
      <StartNotice notice={notice} />
      <div className="voice-pill">
        <LevelBars level={level} live={live} />
        {live ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Pause recording"
            title="Pause recording"
            onClick={() => void pauseRecording()}
          >
            <span className="voice-pill__stop-mark" aria-hidden />
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="voice-pill__resume"
              disabled={starting || recording.status === 'recording'}
              onClick={() => void start(() => resumeRecording(meetingId))}
            >
              {starting ? (
                'Starting…'
              ) : (
                <span className="voice-pill__resume-label">Resume</span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void finishMeeting(meetingId)}
            >
              Finish
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
