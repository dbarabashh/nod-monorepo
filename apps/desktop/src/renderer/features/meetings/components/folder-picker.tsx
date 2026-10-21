import { useEffect, useId, useRef, useState } from 'react';
import { Button, Icon, Input, cx } from '../../../components/ui/index.ts';
import { moveMeetingToFolder } from '../api.ts';
import {
  cleanFolderName,
  existingFolder,
  folderNameMaxLength,
  matchingFolders,
} from '../lib/folders.ts';
import {
  Popover,
  PopoverItem,
  PopoverSeparator,
  usePopoverOpen,
} from './popover.tsx';

type FolderPickerProps = {
  meetingId: string;
  meetingTitle: string;
  folder: string | null;
  folders: string[];
  variant?: 'ghost' | 'outline';
  className?: string;
};

export function FolderPicker({
  meetingId,
  meetingTitle,
  folder,
  folders,
  variant = 'ghost',
  className,
}: FolderPickerProps) {
  const popoverId = useId();
  const popover = useRef<HTMLDivElement>(null);
  const open = usePopoverOpen(popover);

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className={cx('folder-picker', className)}
        popoverTarget={popoverId}
        aria-label={`Folder for ${meetingTitle}: ${folder ?? 'My notes'}`}
        title={folder === null ? 'Move to a folder' : `In ${folder}`}
      >
        <Icon name="folder" />
        <span className="folder-picker__name">{folder ?? 'Folder'}</span>
        <Icon name="chevron-down" />
      </Button>
      <Popover
        id={popoverId}
        ref={popover}
        aria-label={`Move ${meetingTitle} to a folder`}
      >
        {open && (
          <FolderChoices
            meetingId={meetingId}
            folder={folder}
            folders={folders}
            close={() => popover.current?.hidePopover()}
          />
        )}
      </Popover>
    </>
  );
}

function FolderChoices({
  meetingId,
  folder,
  folders,
  close,
}: {
  meetingId: string;
  folder: string | null;
  folders: string[];
  close: () => void;
}) {
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    search.current?.focus();
  }, []);

  const typed = cleanFolderName(query);
  const shown = matchingFolders(folders, query);
  const existing = existingFolder(folders, typed);

  function choose(next: string | null) {
    if (saving) {
      return;
    }
    if (next === folder) {
      close();
      return;
    }
    setSaving(true);
    setFailed(false);
    moveMeetingToFolder(meetingId, next).then(close, () => {
      setSaving(false);
      setFailed(true);
    });
  }

  function create() {
    if (typed === '') {
      setNaming(true);
      search.current?.focus();
      return;
    }
    choose(existing ?? typed);
  }

  return (
    <>
      <Input
        ref={search}
        className="menu-popover__search"
        aria-label={naming ? 'New folder name' : 'Search folders'}
        placeholder={naming ? 'Name the new folder' : 'Search'}
        value={query}
        maxLength={folderNameMaxLength}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
            return;
          }
          event.preventDefault();
          create();
        }}
      />
      {!naming && typed === '' && (
        <PopoverItem
          icon="document"
          checked={folder === null}
          disabled={saving}
          onClick={() => choose(null)}
        >
          My notes
        </PopoverItem>
      )}
      {!naming &&
        shown.map((name) => (
          <PopoverItem
            key={name}
            icon="folder"
            checked={name === folder}
            disabled={saving}
            className="menu-popover__nested"
            onClick={() => choose(name)}
          >
            {name}
          </PopoverItem>
        ))}
      <PopoverSeparator />
      <PopoverItem
        icon="folder-plus"
        variant="accent"
        disabled={saving}
        onClick={create}
      >
        {existing
          ? `Move to “${existing}”`
          : typed !== ''
            ? `New folder “${typed}”`
            : 'New folder'}
      </PopoverItem>
      {failed && (
        <p className="menu-popover__note" role="alert">
          The folder couldn’t be saved. Try again.
        </p>
      )}
    </>
  );
}
