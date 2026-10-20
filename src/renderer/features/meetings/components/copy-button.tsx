import type { MeetingPart } from '../../../../shared/ipc.ts';
import { Button, Icon } from '../../../components/ui/index.ts';
import { useCopyStatus } from '../../../lib/use-copy-status.ts';
import { copyMeeting } from '../api.ts';

export function CopyButton({
  meetingId,
  part,
}: {
  meetingId: string;
  part: MeetingPart;
}) {
  const { status, copy } = useCopyStatus(() => copyMeeting(meetingId, part));

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
