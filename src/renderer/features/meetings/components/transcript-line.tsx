import { memo, type FocusEvent, type KeyboardEvent } from 'react';
import type { MeetingDetail } from '../../../../shared/ipc.ts';
import { formatClock } from '../../../lib/format-clock.ts';
import { editableText } from '../../../lib/markdown-dom.ts';
import { editTranscriptLine } from '../api.ts';

type Line = MeetingDetail['transcript'][number];

type TranscriptLineProps = { meetingId: string; line: Line };

export const TranscriptLine = memo(
  TranscriptLineView,
  (before, after) =>
    before.meetingId === after.meetingId &&
    before.line.speaker === after.line.speaker &&
    before.line.startMs === after.line.startMs &&
    before.line.text === after.line.text,
);

function TranscriptLineView({ meetingId, line }: TranscriptLineProps) {
  const speaker = line.speaker === 'me' ? 'Me' : 'Others';
  const time = formatClock(line.startMs);

  function keys(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.currentTarget.textContent = line.text;
      event.currentTarget.blur();
    }
  }

  function save(event: FocusEvent<HTMLSpanElement>) {
    const element = event.currentTarget;
    const text = editableText(element);
    if (text === line.text) {
      return;
    }
    editTranscriptLine(meetingId, line, text).catch(() => {
      element.textContent = line.text;
    });
  }

  return (
    <li className="meeting-detail__line">
      <span className="meeting-detail__speaker">
        {speaker}
        <time className="meeting-detail__time">{time}</time>
      </span>
      <span
        key={line.text}
        className="ui-editable"
        // An inline span keeps the line reading as text, not as a form field.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="textbox"
        tabIndex={0}
        aria-label={`What ${speaker} said at ${time}`}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        onKeyDown={keys}
        onBlur={save}
      >
        {line.text}
      </span>
    </li>
  );
}
