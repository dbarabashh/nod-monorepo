import { useEffect, useId, useRef, useState } from 'react';
import { Button, Icon, Input, NavItem } from '../../components/ui/index.ts';
import { removeFolder, renameFolder } from './api.ts';
import {
  ConfirmItems,
  Popover,
  PopoverItem,
  usePopoverOpen,
} from './components/popover.tsx';
import {
  cleanFolderName,
  existingFolder,
  folderNameMaxLength,
} from './lib/folders.ts';
import type { MeetingList } from './use-meeting-list.ts';
import './meetings.css';

type FolderNavProps = {
  meetings: MeetingList;
  current: string | null;
  onSelect: (folder: string | null) => void;
  onRenamed: (from: string, to: string) => void;
};

export function FolderNav({
  meetings,
  current,
  onSelect,
  onRenamed,
}: FolderNavProps) {
  const { state, folders } = meetings;
  const headingId = useId();
  const list = useRef<HTMLUListElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [focusOn, setFocusOn] = useState<string | null>(null);

  useEffect(() => {
    if (
      current !== null &&
      renaming === null &&
      state.status === 'ready' &&
      !folders.some((folder) => folder.name === current)
    ) {
      onSelect(null);
    }
  }, [current, renaming, folders, state.status, onSelect]);

  useEffect(() => {
    if (focusOn === null) {
      return;
    }
    setFocusOn(null);
    const active = document.activeElement;
    if (active !== null && active !== document.body) {
      return;
    }
    const item =
      list.current?.querySelector<HTMLElement>(
        `[data-folder="${CSS.escape(focusOn)}"]`,
      ) ??
      list.current?.closest('nav')?.querySelector<HTMLElement>('.ui-nav-item');
    item?.focus();
  }, [focusOn, folders]);

  if (folders.length === 0) {
    return null;
  }

  return (
    <section className="folder-nav" aria-labelledby={headingId}>
      <h2 id={headingId} className="folder-nav__title">
        Folders
      </h2>
      <ul ref={list} className="folder-nav__list">
        {folders.map((folder) => (
          <li key={folder.name} className="folder-nav__item">
            {renaming === folder.name ? (
              <RenameField
                name={folder.name}
                others={folders
                  .map((other) => other.name)
                  .filter((other) => other !== folder.name)}
                onDone={(next) => {
                  setRenaming(null);
                  if (next !== null) {
                    onRenamed(folder.name, next);
                  }
                  setFocusOn(next ?? folder.name);
                }}
              />
            ) : (
              <>
                <NavItem
                  icon="folder"
                  data-folder={folder.name}
                  current={current === folder.name}
                  onClick={() => onSelect(folder.name)}
                >
                  {folder.name}
                  <span className="visually-hidden">
                    , {folder.count}{' '}
                    {folder.count === 1 ? 'meeting' : 'meetings'}
                  </span>
                </NavItem>
                <span className="folder-nav__count" aria-hidden>
                  {folder.count}
                </span>
                <FolderMenu
                  name={folder.name}
                  count={folder.count}
                  onRename={() => setRenaming(folder.name)}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RenameField({
  name,
  others,
  onDone,
}: {
  name: string;
  others: string[];
  onDone: (next: string | null) => void;
}) {
  const [value, setValue] = useState(name);
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const noteId = useId();
  const joins = existingFolder(others, value);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  function save() {
    if (saving.current) {
      return;
    }
    const next = joins ?? cleanFolderName(value);
    if (next === '' || next === name) {
      onDone(null);
      return;
    }
    saving.current = true;
    setFailed(false);
    renameFolder(name, next).then(onDone, () => {
      saving.current = false;
      setFailed(true);
    });
  }

  return (
    <div className="folder-nav__rename">
      <Input
        ref={field}
        data-size="sm"
        value={value}
        maxLength={folderNameMaxLength}
        aria-label={`New name for ${name}`}
        aria-describedby={joins || failed ? noteId : undefined}
        aria-invalid={failed || undefined}
        onChange={(event) => setValue(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onDone(null);
          }
        }}
      />
      {(failed || joins) && (
        <p id={noteId} className="folder-nav__note" role="status">
          {failed
            ? 'The folder couldn’t be renamed. Some meetings may have moved; try again.'
            : `Its meetings join “${joins}”.`}
        </p>
      )}
    </div>
  );
}

function FolderMenu({
  name,
  count,
  onRename,
}: {
  name: string;
  count: number;
  onRename: () => void;
}) {
  const popoverId = useId();
  const popover = useRef<HTMLDivElement>(null);
  const open = usePopoverOpen(popover);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="folder-nav__menu"
        popoverTarget={popoverId}
        aria-label={`More actions for the ${name} folder`}
        title="More"
      >
        <Icon name="more" />
      </Button>
      <Popover
        id={popoverId}
        ref={popover}
        aria-label={`Actions for the ${name} folder`}
        data-size="sm"
      >
        {open && (
          <FolderMenuItems
            name={name}
            count={count}
            onRename={() => {
              popover.current?.hidePopover();
              onRename();
            }}
            fallback={() =>
              popover.current
                ?.closest('nav')
                ?.querySelector<HTMLElement>('.ui-nav-item') ?? null
            }
          />
        )}
      </Popover>
    </>
  );
}

function FolderMenuItems({
  name,
  count,
  onRename,
  fallback,
}: {
  name: string;
  count: number;
  onRename: () => void;
  fallback: () => HTMLElement | null;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <ConfirmItems
        note={`${count === 1 ? 'Its meeting moves' : `Its ${count} meetings move`} to My notes. No meeting is deleted.`}
        failedNote="The folder couldn’t be deleted."
        label="Delete folder"
        onConfirm={() => {
          const landing = fallback();
          return removeFolder(name).then(() => landing?.focus());
        }}
        onCancel={() => setConfirming(false)}
      />
    );
  }
  return (
    <>
      <PopoverItem icon="pencil" onClick={onRename}>
        Rename
      </PopoverItem>
      <PopoverItem
        icon="trash"
        variant="danger"
        onClick={() => setConfirming(true)}
      >
        Delete folder
      </PopoverItem>
    </>
  );
}
