import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../../components/ui/index.ts';
import { meetingCount } from '../../../lib/meeting-count.ts';
import { SelectBox } from './select-box.tsx';

type SelectionBarProps = {
  count: number;
  total: number;
  busy: boolean;
  problem: string | null;
  onCheckAll: (checked: boolean) => void;
  onClear: () => void;
  onDelete: () => void;
};

export function SelectionBar({
  count,
  total,
  busy,
  problem,
  onCheckAll,
  onClear,
  onDelete,
}: SelectionBarProps) {
  const [confirming, setConfirming] = useState(false);
  const start = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (confirming) {
      confirm.current?.focus();
    } else if (opened.current) {
      start.current?.focus();
    }
    opened.current = confirming;
  }, [confirming]);

  // Escape steps back from the confirmation, keeping the selection.
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setConfirming(false);
    }
  };

  if (confirming || busy) {
    return (
      <fieldset className="meetings__selection" aria-label="Confirm">
        <p className="meetings__selection-note">
          Delete {meetingCount(count)} on all devices? This can’t be undone.
        </p>
        <Button
          ref={confirm}
          variant="danger"
          size="sm"
          disabled={busy}
          onKeyDown={cancelOnEscape}
          onClick={() => {
            setConfirming(false);
            onDelete();
          }}
        >
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onKeyDown={cancelOnEscape}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </fieldset>
    );
  }

  return (
    <fieldset className="meetings__selection" aria-label="Selected meetings">
      <SelectBox
        label="Select all shown meetings"
        checked={count === total}
        mixed={count > 0 && count < total}
        onChange={onCheckAll}
      />
      <span className="meetings__selection-count">{count} selected</span>
      {problem && (
        <p className="meetings__selection-note" role="alert">
          {problem}
        </p>
      )}
      <Button
        ref={start}
        variant="danger"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        Delete…
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Cancel
      </Button>
    </fieldset>
  );
}
