import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { editableText } from '../../../lib/markdown-dom.ts';
import { renameMeeting } from '../api.ts';

export function MeetingTitle({
  id,
  meetingId,
  title,
}: {
  id: string;
  meetingId: string;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  const name = useRef<HTMLSpanElement>(null);

  // React doesn't own the text of an editable element; a new name arriving
  // while the user types is applied once they leave the field.
  useEffect(() => {
    const element = name.current;
    if (element && document.activeElement !== element) {
      element.textContent = title;
    }
  }, [title]);

  function keys(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.currentTarget.textContent = title;
      event.currentTarget.blur();
    }
  }

  function save(event: FocusEvent<HTMLSpanElement>) {
    const element = event.currentTarget;
    const next = editableText(element);
    if (next === '' || next === title) {
      element.textContent = title;
      return;
    }
    renameMeeting(meetingId, next).then(
      () => setFailed(false),
      () => {
        element.textContent = title;
        setFailed(true);
      },
    );
  }

  return (
    <>
      <h1 id={id} className="meeting-detail__title">
        <span
          ref={name}
          className="ui-editable"
          // A name edited in place keeps the panel reading as a document.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="textbox"
          aria-label="Meeting name"
          tabIndex={0}
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          onKeyDown={keys}
          onBlur={save}
        />
      </h1>
      {failed && (
        <p className="meeting-detail__note" role="alert">
          The new name couldn’t be saved. Try again.
        </p>
      )}
    </>
  );
}
