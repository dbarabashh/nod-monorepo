import { useEffect, useState } from 'react';
import type { MeetingPart } from '../../../../shared/ipc.ts';
import { Button, Icon } from '../../../components/ui/index.ts';
import { copyMeeting } from '../api.ts';

const confirmMs = 2_000;

export function CopyButton({
  meetingId,
  part,
}: {
  meetingId: string;
  part: MeetingPart;
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (status === 'idle') {
      return;
    }
    const timer = setTimeout(() => setStatus('idle'), confirmMs);
    return () => clearTimeout(timer);
  }, [status]);

  function copy() {
    copyMeeting(meetingId, part).then(
      () => setStatus('copied'),
      () => setStatus('failed'),
    );
  }

  return (
    <Button variant="ghost" size="sm" onClick={copy}>
      <Icon name={status === 'copied' ? 'check' : 'copy'} />
      <span aria-live="polite">
        {status === 'copied'
          ? 'Copied'
          : status === 'failed'
            ? 'Couldn’t copy'
            : part === 'summary'
              ? 'Copy summary'
              : 'Copy transcript'}
      </span>
    </Button>
  );
}
