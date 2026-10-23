import { useEffect, useId, useRef, useState } from 'react';
import { Button, Icon } from '../../../components/ui/index.ts';
import { useAction } from '../../../lib/use-action.ts';
import { deleteMeeting } from '../api.ts';
import {
  ConfirmItems,
  Popover,
  PopoverItem,
  PopoverSeparator,
  usePopoverOpen,
} from './popover.tsx';

import type { ShareTargets } from '../../../lib/share-targets.ts';

type MeetingMenuProps = {
  meetingId: string;
  title: string;
  recording: boolean;
  shareTargets?: ShareTargets | null;
};

export function MeetingMenu({
  meetingId,
  title,
  recording,
  shareTargets = null,
}: MeetingMenuProps) {
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
        {open && (
          <MenuItems
            meetingId={meetingId}
            recording={recording}
            shareTargets={shareTargets}
          />
        )}
      </Popover>
    </>
  );
}

function MenuItems({
  meetingId,
  recording,
  shareTargets,
}: {
  meetingId: string;
  recording: boolean;
  shareTargets: ShareTargets | null;
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
    <>
      {shareTargets && (
        <ShareItems meetingId={meetingId} targets={shareTargets} />
      )}
      <PopoverItem
        ref={start}
        icon="trash"
        variant="danger"
        disabled={recording}
        onClick={() => setConfirming(true)}
      >
        {recording ? 'Pause to delete' : 'Delete'}
      </PopoverItem>
    </>
  );
}

function ShareItems({
  meetingId,
  targets,
}: {
  meetingId: string;
  targets: ShareTargets;
}) {
  const { busy, error, run } = useAction();
  const [done, setDone] = useState(false);

  return (
    <>
      <p className="menu-popover__note" role="status">
        {shareNote(done, error)}
      </p>
      {targets.peers.map((peer) => (
        <PopoverItem
          key={peer.identity}
          icon="document"
          disabled={busy}
          onClick={() => {
            setDone(false);
            run(() =>
              targets.share(meetingId, peer.identity).then(() => setDone(true)),
            );
          }}
        >
          {peer.code}
        </PopoverItem>
      ))}
      <PopoverSeparator />
    </>
  );
}

function shareNote(done: boolean, error: string | null) {
  if (error) {
    return `The notes couldn’t be shared: ${error}`;
  }
  if (done) {
    return 'Shared. Find it under Shared notes.';
  }
  return 'Share the title and summary with:';
}
