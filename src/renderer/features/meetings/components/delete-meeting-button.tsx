import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/index.ts';
import { deleteMeeting } from '../api.ts';

const confirmWindowMs = 5_000;

export function DeleteMeetingButton({ meetingId }: { meetingId: string }) {
  const [step, setStep] = useState<'idle' | 'confirming' | 'failed'>('idle');

  useEffect(() => {
    if (step === 'idle') {
      return;
    }
    const timer = setTimeout(() => setStep('idle'), confirmWindowMs);
    return () => clearTimeout(timer);
  }, [step]);

  if (step === 'confirming') {
    return (
      <>
        <Button
          variant="danger"
          onClick={() =>
            void deleteMeeting(meetingId).catch(() => setStep('failed'))
          }
        >
          Delete for good
        </Button>
        <Button variant="ghost" onClick={() => setStep('idle')}>
          Keep
        </Button>
      </>
    );
  }

  return (
    <Button variant="ghost" onClick={() => setStep('confirming')}>
      {step === 'failed' ? 'Couldn’t delete, try again' : 'Delete meeting'}
    </Button>
  );
}
