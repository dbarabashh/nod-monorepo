import { useId, type ReactNode } from 'react';
import { formatDuration } from '../lib/format-duration.ts';
import type { Meeting } from '../types.ts';
import { MeetingStatusBadge } from './meeting-status-badge.tsx';
import { MeetingTranscript } from './meeting-transcript.tsx';

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'short',
});

type MeetingDetailProps = {
  meeting: Meeting;
  actions: ReactNode;
};

export function MeetingDetail({ meeting, actions }: MeetingDetailProps) {
  const titleId = useId();

  return (
    <aside className="meeting-detail" aria-labelledby={titleId}>
      <div className="meeting-detail__heading">
        <h2 id={titleId} className="meeting-detail__title">
          {meeting.title}
        </h2>
        <MeetingStatusBadge status={meeting.status} />
      </div>
      <dl className="meeting-detail__facts">
        <dt>Started</dt>
        <dd>
          <time dateTime={meeting.startedAt.toISOString()}>
            {dateFormat.format(meeting.startedAt)}
          </time>
        </dd>
        <dt>Recorded</dt>
        <dd>{formatDuration(meeting.durationSeconds)}</dd>
      </dl>
      <div className="meeting-detail__actions">{actions}</div>
      <MeetingTranscript
        meetingId={meeting.id}
        recording={meeting.status === 'recording'}
      />
    </aside>
  );
}
