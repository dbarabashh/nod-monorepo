import { useCallback, useState } from 'react';
import type { MeetingDetail, SharedCopyInfo } from '../../../../shared/ipc.ts';
import {
  Button,
  Icon,
  MarkdownEditor,
  Tabs,
} from '../../../components/ui/index.ts';
import { dateTimeFormat } from '../../../lib/formats.ts';
import type { ShareTargets } from '../../../lib/share-targets.ts';
import { useAsync } from '../../../lib/use-async.ts';
import {
  editSummary,
  getMeeting,
  onMeetingsChanged,
  summarizeMeeting,
} from '../api.ts';
import type { MeetingStatus } from '../types.ts';
import { CopyButton } from './copy-button.tsx';
import { TranscriptLine } from './transcript-line.tsx';

export function MeetingTranscript({
  meetingId,
  status,
  shareTargets,
  onOpenSharedNote,
}: {
  meetingId: string;
  status: MeetingStatus;
  shareTargets: ShareTargets | null;
  onOpenSharedNote: (target: string, id: string) => void;
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
    <>
      {detail.sharedAs.length > 0 && (
        <SharedCopies
          copies={detail.sharedAs}
          shareTargets={shareTargets}
          onOpen={onOpenSharedNote}
        />
      )}
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
                    <div className="meeting-detail__toolbar">
                      {detail.summaryEdited && (
                        <span className="meeting-detail__note">Edited</span>
                      )}
                      <CopyButton meetingId={meetingId} part="summary" />
                    </div>
                    <MarkdownEditor
                      label="Summary"
                      markdown={detail.summary}
                      version={detail.version ?? ''}
                      readOnly={detail.version === null}
                      onSave={(markdown, version) =>
                        editSummary(meetingId, markdown, version)
                      }
                    />
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
                    <div className="meeting-detail__toolbar">
                      <CopyButton meetingId={meetingId} part="transcript" />
                    </div>
                    <ol className="meeting-detail__transcript" data-selectable>
                      {detail.transcript.map((line) => (
                        <TranscriptLine
                          key={line.id}
                          meetingId={meetingId}
                          line={line}
                        />
                      ))}
                    </ol>
                  </>
                )}
              </section>
            ),
          },
        ]}
      />
    </>
  );
}

// Where this meeting's notes went. The label comes from the current share
// targets; a person sharing was stopped with, or a team that was left, is
// named for what it was.
function SharedCopies({
  copies,
  shareTargets,
  onOpen,
}: {
  copies: SharedCopyInfo[];
  shareTargets: ShareTargets | null;
  onOpen: (target: string, id: string) => void;
}) {
  const labelOf = (copy: SharedCopyInfo) => {
    const known = shareTargets?.known.find(
      (entry) => entry.target === copy.target,
    );
    if (known) {
      return copy.kind === 'team' ? `“${known.name}”` : known.name;
    }
    return copy.kind === 'team'
      ? 'a team you left'
      : 'someone you no longer share with';
  };
  return (
    <ul className="meeting-detail__shared" aria-label="Shared copies">
      {copies.map((copy) => (
        <li key={copy.noteId} className="meeting-detail__shared-copy">
          <Icon name={copy.kind === 'team' ? 'people' : 'person'} />
          <span className="meeting-detail__note">
            {copy.kind === 'team' ? 'In team' : 'Shared with'} {labelOf(copy)} ·{' '}
            {dateTimeFormat.format(new Date(copy.sharedAt))}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpen(copy.target, copy.noteId)}
          >
            Open
          </Button>
        </li>
      ))}
    </ul>
  );
}
