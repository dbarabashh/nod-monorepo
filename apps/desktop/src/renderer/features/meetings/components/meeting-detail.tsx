import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, Icon } from '../../../components/ui/index.ts';
import { formatDuration } from '../lib/format-duration.ts';
import { dayLabel } from '../lib/group-by-day.ts';
import type { Meeting } from '../types.ts';
import { FolderPicker } from './folder-picker.tsx';
import type { ShareTargets } from '../../../lib/share-targets.ts';
import { MeetingMenu } from './meeting-menu.tsx';
import { MeetingStatusBadge } from './meeting-status-badge.tsx';
import { MeetingTitle } from './meeting-title.tsx';
import { MeetingTranscript } from './meeting-transcript.tsx';
import { clockFormat } from '../../../lib/formats.ts';

type MeetingDetailProps = {
  meeting: Meeting;
  folders: string[];
  now: Date;
  actions: ReactNode;
  shareTargets: ShareTargets | null;
  onBack: () => void;
};

export function MeetingDetail({
  meeting,
  folders,
  now,
  actions,
  shareTargets,
  onBack,
}: MeetingDetailProps) {
  const titleId = useId();
  const page = useRef<HTMLElement>(null);

  useEffect(() => {
    page.current?.focus();
  }, []);

  useEffect(() => {
    if (document.activeElement === document.body) {
      page.current?.focus();
    }
  }, [meeting.status]);

  return (
    <article
      ref={page}
      tabIndex={-1}
      className="meeting-detail"
      aria-labelledby={titleId}
    >
      <header className="meeting-detail__bar">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <Icon name="chevron-left" />
          Meetings
        </Button>
        <MeetingMenu
          meetingId={meeting.id}
          title={meeting.title}
          recording={meeting.status === 'recording'}
          shareTargets={shareTargets}
        />
      </header>
      {meeting.status !== 'finished' && (
        <footer className="meeting-detail__dock">{actions}</footer>
      )}
      <div className="meeting-detail__body" data-scroll>
        <div className="meeting-detail__column">
          <div className="meeting-detail__heading">
            <MeetingTitle
              id={titleId}
              meetingId={meeting.id}
              title={meeting.title}
            />
            <ul className="meeting-detail__chips">
              <li className="meeting-detail__chip">
                <Icon name="clock" />
                <time dateTime={meeting.startedAt.toISOString()}>
                  {dayLabel(meeting.startedAt, now, navigator.language)},{' '}
                  {clockFormat.format(meeting.startedAt)}
                </time>
              </li>
              <li>
                <FolderPicker
                  meetingId={meeting.id}
                  meetingTitle={meeting.title}
                  folder={meeting.folder}
                  folders={folders}
                  variant="outline"
                  className="meeting-detail__folder"
                />
              </li>
              <li className="meeting-detail__chip">
                <Icon name="mic" />
                {formatDuration(meeting.durationSeconds)}
              </li>
              {meeting.status !== 'finished' && (
                <li className="meeting-detail__chip">
                  <MeetingStatusBadge status={meeting.status} />
                </li>
              )}
            </ul>
          </div>
          <MeetingTranscript meetingId={meeting.id} status={meeting.status} />
        </div>
      </div>
    </article>
  );
}
