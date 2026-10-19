import { useCallback, useState } from 'react';
import type { MeetingDetail } from '../../../../shared/ipc.ts';
import { Prose, Tabs } from '../../../components/ui/index.ts';
import { formatClock } from '../../../lib/format-clock.ts';
import { useAsync } from '../../../lib/use-async.ts';
import { getMeeting, onMeetingsChanged } from '../api.ts';
import { CopyButton } from './copy-button.tsx';

export function MeetingTranscript({
  meetingId,
  recording,
}: {
  meetingId: string;
  recording: boolean;
}) {
  const load = useCallback(() => getMeeting(meetingId), [meetingId]);
  const subscribe = useCallback(
    (show: (detail: MeetingDetail) => void) => {
      let version: string | undefined;
      return onMeetingsChanged((meetings) => {
        const next = meetings.find(
          (meeting) => meeting.id === meetingId,
        )?.contentVersion;
        if (next !== version) {
          version = next;
          getMeeting(meetingId).then(show, () => undefined);
        }
      });
    },
    [meetingId],
  );
  const { state } = useAsync(load, subscribe);
  const [tab, setTab] = useState<'summary' | 'transcript' | null>(null);

  if (state.status !== 'ready') {
    return null;
  }
  const detail = state.value;

  const selected =
    tab ?? (detail.summary || detail.summarizing ? 'summary' : 'transcript');

  return (
    <Tabs
      label="Meeting notes"
      selected={selected}
      onSelect={setTab}
      tabs={[
        {
          id: 'summary',
          label: 'Summary',
          content: (
            <section className="meeting-detail__section">
              {detail.summarizing && (
                <p className="meeting-detail__note">Writing the summary…</p>
              )}
              {detail.summary ? (
                <>
                  <CopyButton meetingId={meetingId} part="summary" />
                  <Prose markdown={detail.summary} data-selectable />
                </>
              ) : (
                !detail.summarizing && (
                  <p className="meeting-detail__note">
                    A summary is written on this device when the meeting is
                    finished.
                  </p>
                )
              )}
            </section>
          ),
        },
        {
          id: 'transcript',
          label: 'Transcript',
          content: (
            <section className="meeting-detail__section">
              {detail.transcript.length === 0 ? (
                <p className="meeting-detail__note">
                  {recording
                    ? 'Listening… lines appear a few seconds after they are spoken.'
                    : 'Nothing was transcribed. Download a speech model in Settings to get transcripts.'}
                </p>
              ) : (
                <>
                  <CopyButton meetingId={meetingId} part="transcript" />
                  <ol className="meeting-detail__transcript" data-selectable>
                    {detail.transcript.map((line) => (
                      <li
                        key={`${line.speaker}-${line.startMs}`}
                        className="meeting-detail__line"
                      >
                        <span className="meeting-detail__speaker">
                          {line.speaker === 'me' ? 'Me' : 'Others'}
                          <time className="meeting-detail__time">
                            {formatClock(line.startMs)}
                          </time>
                        </span>
                        <span>{line.text}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>
          ),
        },
      ]}
    />
  );
}
