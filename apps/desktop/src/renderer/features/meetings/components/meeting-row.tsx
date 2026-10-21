import { Icon, ListRow } from '../../../components/ui/index.ts';
import { formatDuration } from '../lib/format-duration.ts';
import type { Meeting } from '../types.ts';
import { FolderPicker } from './folder-picker.tsx';
import { MeetingMenu } from './meeting-menu.tsx';
import { MeetingStatusBadge } from './meeting-status-badge.tsx';
import { SelectBox } from './select-box.tsx';
import { clockFormat } from '../../../lib/formats.ts';

type MeetingRowProps = {
  meeting: Meeting;
  folders: string[];
  checked: boolean;
  locked: boolean;
  onCheck: (id: string, checked: boolean) => void;
  onSelect: (id: string) => void;
};

export function MeetingRow({
  meeting,
  folders,
  checked,
  locked,
  onCheck,
  onSelect,
}: MeetingRowProps) {
  const recording = meeting.status === 'recording';
  return (
    <ListRow
      data-meeting-id={meeting.id}
      onClick={() => onSelect(meeting.id)}
      leading={
        <SelectBox
          label={
            recording
              ? `${meeting.title} is being recorded`
              : `Select ${meeting.title}`
          }
          checked={checked && !recording}
          disabled={recording || locked}
          onChange={(next) => onCheck(meeting.id, next)}
        />
      }
      trailing={
        <span className="meeting-row__when">
          {meeting.folder !== null && (
            <Icon name="folder" label={`In ${meeting.folder}`} />
          )}
          <time dateTime={meeting.startedAt.toISOString()}>
            {clockFormat.format(meeting.startedAt)}
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
            recording={recording}
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
