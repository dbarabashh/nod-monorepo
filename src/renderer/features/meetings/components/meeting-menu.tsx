import { useEffect, useId, useRef, useState } from 'react';
import { Button, Icon } from '../../../components/ui/index.ts';
import { deleteMeeting } from '../api.ts';
import {
  ConfirmItems,
  Popover,
  PopoverItem,
  usePopoverOpen,
} from './popover.tsx';

type MeetingMenuProps = {
  meetingId: string;
  title: string;
  recording: boolean;
};

export function MeetingMenu({ meetingId, title, recording }: MeetingMenuProps) {
  const popoverId = useId();
  const popover = useRef<HTMLDivElement>(null);
  const open = usePopoverOpen(popover);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="meeting-menu"
        popoverTarget={popoverId}
        aria-label={`More actions for ${title}`}
        title="More"
      >
        <Icon name="more" />
      </Button>
      <Popover
        id={popoverId}
        ref={popover}
        aria-label={`Actions for ${title}`}
        data-size="sm"
      >
        {open && <MenuItems meetingId={meetingId} recording={recording} />}
      </Popover>
    </>
  );
}

function MenuItems({
  meetingId,
  recording,
}: {
  meetingId: string;
  recording: boolean;
}) {
  const start = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) {
      start.current?.focus();
    }
  }, [confirming]);

  if (confirming && !recording) {
    return (
      <ConfirmItems
        note="Delete this meeting on all your devices?"
        failedNote="The meeting couldn’t be deleted."
        label="Delete meeting"
        onConfirm={() => deleteMeeting(meetingId)}
        onCancel={() => setConfirming(false)}
      />
    );
  }
  return (
    <PopoverItem
      ref={start}
      icon="trash"
      variant="danger"
      disabled={recording}
      onClick={() => setConfirming(true)}
    >
      {recording ? 'Pause to delete' : 'Delete'}
    </PopoverItem>
  );
}
