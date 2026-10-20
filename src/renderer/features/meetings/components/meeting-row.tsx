import { Icon, ListRow } from '../../../components/ui/index.ts';
import { formatDuration } from '../lib/format-duration.ts';
import type { Meeting } from '../types.ts';
import { FolderPicker } from './folder-picker.tsx';
import { MeetingMenu } from './meeting-menu.tsx';
import { MeetingStatusBadge } from './meeting-status-badge.tsx';

type MeetingRowProps = {
  meeting: Meeting;
  folders: string[];
  onSelect: (id: string) => void;
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

export function MeetingRow({ meeting, folders, onSelect }: MeetingRowProps) {
  return (
    <ListRow
      data-meeting-id={meeting.id}
      onClick={() => onSelect(meeting.id)}
      trailing={
        <span className="meeting-row__when">
          {meeting.folder !== null && (
            <Icon name="folder" label={`In ${meeting.folder}`} />
          )}
          <time dateTime={meeting.startedAt.toISOString()}>
            {timeFormat.format(meeting.startedAt)}
          </time>
        </span>
      }
      action={
        <div className="meeting-row__actions">
          <FolderPicker
            meetingId={meeting.id}
            meetingTitle={meeting.title}
            folder={meeting.folder}
            folders={folders}
          />
          <MeetingMenu
            meetingId={meeting.id}
            title={meeting.title}
            recording={meeting.status === 'recording'}
          />
        </div>
      }
    >
      <span className="meeting-row__tile" aria-hidden>
        <Icon name="document" />
      </span>
      <span className="meeting-row__main">
        <span className="meeting-row__title">{meeting.title}</span>
        <span className="meeting-row__meta">
          <span>{formatDuration(meeting.durationSeconds)}</span>
          <MeetingStatusBadge status={meeting.status} />
        </span>
      </span>
    </ListRow>
  );
}
