import { ListRow } from '../../../components/ui/index.ts';
import { formatDuration } from '../lib/format-duration.ts';
import type { Meeting } from '../types.ts';
import { DeleteMeetingButton } from './delete-meeting-button.tsx';
import { MeetingStatusBadge } from './meeting-status-badge.tsx';

type MeetingRowProps = {
  meeting: Meeting;
  selected: boolean;
  onSelect: (id: string) => void;
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

export function MeetingRow({ meeting, selected, onSelect }: MeetingRowProps) {
  return (
    <ListRow
      selected={selected}
      onClick={() => onSelect(meeting.id)}
      className="meeting-row"
      action={
        meeting.status === 'recording' ? undefined : (
          <DeleteMeetingButton meetingId={meeting.id} title={meeting.title} />
        )
      }
    >
      <span className="meeting-row__main">
        <span className="meeting-row__title">{meeting.title}</span>
        <span className="meeting-row__meta">
          <time dateTime={meeting.startedAt.toISOString()}>
            {timeFormat.format(meeting.startedAt)}
          </time>
          <span aria-hidden>·</span>
          <span>{formatDuration(meeting.durationSeconds)}</span>
        </span>
      </span>
      <MeetingStatusBadge status={meeting.status} />
    </ListRow>
  );
}
