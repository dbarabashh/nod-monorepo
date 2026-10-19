import { useCallback, useState } from 'react';
import type { MeetingDetail } from '../../../../shared/ipc.ts';
import { Button, Prose, Tabs } from '../../../components/ui/index.ts';
import { formatClock } from '../../../lib/format-clock.ts';
import { useAsync } from '../../../lib/use-async.ts';
import { getMeeting, onMeetingsChanged, summarizeMeeting } from '../api.ts';
import type { MeetingStatus } from '../types.ts';
import { CopyButton } from './copy-button.tsx';

export function MeetingTranscript({
  meetingId,
  status,
}: {
  meetingId: string;
  status: MeetingStatus;
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
    tab ??
    (detail.summary || detail.summaryStatus !== 'idle'
      ? 'summary'
      : 'transcript');
  const retry = () => void summarizeMeeting(meetingId).catch(() => undefined);

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
              {detail.summaryStatus === 'writing' ? (
                <p className="meeting-detail__note">Writing the summary…</p>
              ) : detail.summaryStatus === 'failed' ? (
                <>
                  <p className="meeting-detail__note" role="alert">
                    The summary couldn’t be written.
                  </p>
                  <Button size="sm" onClick={retry}>
                    Try again
                  </Button>
                </>
              ) : detail.summary ? (
                <>
                  <CopyButton meetingId={meetingId} part="summary" />
                  <Prose markdown={detail.summary} data-selectable />
                </>
              ) : status === 'finished' && detail.transcript.length > 0 ? (
                <>
                  <p className="meeting-detail__note">
                    No summary yet. Summaries need a summary model from
                    Settings.
                  </p>
                  <Button size="sm" onClick={retry}>
                    Write summary
                  </Button>
                </>
              ) : (
                <p className="meeting-detail__note">
                  A summary is written on this device when the meeting is
                  finished.
                </p>
              )}
            </section>
          ),
        },
        {
          id: 'transcript',
          label: 'Transcript',
          content: (
            <section className="meeting-detail__section">
              {detail.problem && (
                <p className="meeting-detail__note" role="alert">
                  {detail.problem}
                </p>
              )}
              {detail.transcript.length === 0 ? (
                <p className="meeting-detail__note">
                  {status === 'recording'
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
