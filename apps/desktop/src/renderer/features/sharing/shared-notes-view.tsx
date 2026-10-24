import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { SharedNoteDetail, SharedNoteInfo } from '../../../shared/ipc.ts';
import {
  Button,
  EmptyState,
  Icon,
  List,
  ListRow,
  MarkdownEditor,
} from '../../components/ui/index.ts';
import { dateTimeFormat } from '../../lib/formats.ts';
import { useAction } from '../../lib/use-action.ts';
import { useAsync } from '../../lib/use-async.ts';
import {
  deleteSharedNote,
  editSharedNote,
  getSharedNote,
  getSharingState,
  onSharingChanged,
} from './api.ts';
import './sharing.css';

function homeOf(note: SharedNoteInfo): string {
  return note.kind === 'team'
    ? `In team “${note.label === '' ? 'Unnamed team' : note.label}”`
    : `Shared with ${note.label}`;
}

type NoteRef = { target: string; id: string };

// A note id is only unique within its home: two people or teams can hold
// notes under the same id.
function sameNote(note: NoteRef, ref: NoteRef | null): boolean {
  return ref !== null && note.target === ref.target && note.id === ref.id;
}

function keyOf(note: NoteRef): string {
  return `${note.target}:${note.id}`;
}

function NoteDetail({
  info,
  readOnly,
  onBack,
}: {
  info: SharedNoteInfo;
  readOnly: boolean;
  onBack: () => void;
}) {
  const titleId = useId();
  const page = useRef<HTMLElement>(null);
  const { busy, error, run } = useAction();
  // Stable across renders: a new loader each render would make the hook
  // refetch after every state change it causes.
  const load = useCallback(
    () => getSharedNote(info.target, info.id),
    [info.target, info.id],
  );
  const subscribe = useCallback(
    (show: (note: SharedNoteDetail) => void) =>
      onSharingChanged(() => {
        getSharedNote(info.target, info.id).then(show, () => undefined);
      }),
    [info.target, info.id],
  );
  const { state } = useAsync(load, subscribe);

  useEffect(() => {
    page.current?.focus();
  }, []);

  const note: SharedNoteDetail | null =
    state.status === 'ready' ? state.value : null;

  return (
    <article
      ref={page}
      tabIndex={-1}
      className="shared-note"
      aria-labelledby={titleId}
    >
      <header className="shared-note__bar">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <Icon name="chevron-left" />
          Shared notes
        </Button>
        {note && !readOnly && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              run(() => deleteSharedNote(note.target, note.id).then(onBack))
            }
          >
            <Icon name="trash" />
            Delete
          </Button>
        )}
      </header>
      <div className="shared-note__body" data-scroll>
        <div className="shared-note__column">
          <div className="shared-note__heading">
            <h1 id={titleId} className="shared-note__title" data-selectable>
              {info.title}
            </h1>
            <p className="sharing__note">
              {homeOf(info)} on {dateTimeFormat.format(new Date(info.sharedAt))}
              .{' '}
              {readOnly
                ? 'You can read it but not change it.'
                : 'Everyone who can write there can edit it; edits merge.'}
            </p>
          </div>
          {state.status === 'error' ? (
            <p className="sharing__note" role="alert">
              This note couldn’t be read.
            </p>
          ) : (
            note && (
              <MarkdownEditor
                label="Summary"
                markdown={note.summary}
                readOnly={readOnly}
                onSave={(markdown) =>
                  editSharedNote(note.target, note.id, markdown)
                }
              />
            )
          )}
          {error && (
            <p className="sharing__note" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

// `open` names a note to show first, for a meeting that opens its shared
// copy; the shell remounts the view when it changes.
export function SharedNotesView({ open = null }: { open?: NoteRef | null }) {
  const { state } = useAsync(getSharingState, onSharingChanged);
  const [selected, setSelected] = useState<NoteRef | null>(open);

  if (state.status === 'loading') {
    return <p className="sharing__note">Loading shared notes…</p>;
  }
  if (state.status === 'error' || state.value.status === 'none') {
    return (
      <EmptyState
        icon="document"
        title="No shared notes"
        description="Set up a recovery phrase, then add a person under Settings → People or make a team under Settings → Teams."
      />
    );
  }
  const { notes, teams } = state.value;
  const shown = notes.find((note) => sameNote(note, selected)) ?? null;
  if (shown) {
    return (
      <NoteDetail
        key={keyOf(shown)}
        info={shown}
        readOnly={teams.some(
          (team) => team.vaultId === shown.target && team.role === 'reader',
        )}
        onBack={() => setSelected(null)}
      />
    );
  }
  if (notes.length === 0) {
    return (
      <EmptyState
        icon="document"
        title="No shared notes yet"
        description="Open a meeting and choose “Share with…” from its menu. Notes others share with you show up here too."
      />
    );
  }
  return (
    <section className="shared-notes" aria-label="Shared notes" data-scroll>
      <div className="shared-notes__column">
        <h1 className="shared-notes__title">Shared notes</h1>
        <List>
          {notes.map((note) => (
            <ListRow
              key={keyOf(note)}
              onClick={() => setSelected({ target: note.target, id: note.id })}
              trailing={
                <span className="shared-notes__meta">
                  {dateTimeFormat.format(new Date(note.sharedAt))}
                </span>
              }
            >
              <span className="shared-notes__tile" aria-hidden>
                <Icon name={note.kind === 'team' ? 'people' : 'person'} />
              </span>
              <span className="shared-notes__row">
                <span className="shared-notes__name">{note.title}</span>
                <span className="shared-notes__meta">{homeOf(note)}</span>
              </span>
            </ListRow>
          ))}
        </List>
      </div>
    </section>
  );
}
