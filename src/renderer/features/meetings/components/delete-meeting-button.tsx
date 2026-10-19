import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '../../../components/ui/index.ts';
import { deleteMeeting } from '../api.ts';

const confirmWindowMs = 5_000;

type Step = 'idle' | 'confirming' | 'failed';

export function DeleteMeetingButton({
  meetingId,
  title,
}: {
  meetingId: string;
  title: string;
}) {
  const [step, setStep] = useState<Step>('idle');
  const returnFocus = useRef(false);
  const confirm = useRef<HTMLButtonElement>(null);
  const trash = useRef<HTMLButtonElement>(null);

  // Each button takes the place of the other, so focus follows the swap
  // instead of falling back to the start of the page.
  useEffect(() => {
    if (step === 'idle') {
      if (returnFocus.current) {
        trash.current?.focus();
        returnFocus.current = false;
      }
      return;
    }
    confirm.current?.focus();
    if (step === 'failed') {
      return;
    }
    const timer = setTimeout(() => {
      returnFocus.current = true;
      setStep('idle');
    }, confirmWindowMs);
    return () => clearTimeout(timer);
  }, [step]);

  if (step !== 'idle') {
    return (
      <Button
        variant="danger"
        size="sm"
        ref={confirm}
        onBlur={() => setStep('idle')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            returnFocus.current = true;
            setStep('idle');
          }
        }}
        onClick={() => {
          deleteMeeting(meetingId).catch(() => setStep('failed'));
        }}
      >
        {step === 'failed' ? 'Try again' : 'Delete'}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      ref={trash}
      aria-label={`Delete ${title}`}
      onClick={() => setStep('confirming')}
    >
      <Icon name="trash" />
    </Button>
  );
}
