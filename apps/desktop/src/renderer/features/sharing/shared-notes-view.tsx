import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { SharedNoteDetail, SharedNoteInfo } from '../../../shared/ipc.ts';
import {
  Button,
  EmptyState,
  Icon,
  List,
  ListRow,
  Textarea,
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

function NoteDetail({
  info,
  onBack,
}: {
  info: SharedNoteInfo;
  onBack: () => void;
}) {
  const titleId = useId();
  const page = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  // Stable across renders: a new loader each render would make the hook
  // refetch after every state change it causes.
  const load = useCallback(
    () => getSharedNote(info.peer, info.id),
    [info.peer, info.id],
  );
  const subscribe = useCallback(
    (show: (note: SharedNoteDetail) => void) =>
      onSharingChanged(() => {
        getSharedNote(info.peer, info.id).then(show, () => undefined);
      }),
    [info.peer, info.id],
  );
  const { state } = useAsync(load, subscribe);

  useEffect(() => {
    page.current?.focus();
  }, []);

  const note: SharedNoteDetail | null =
    state.status === 'ready' ? state.value : null;
  const summary = draft ?? note?.summary ?? '';

  const save = () => {
    if (draft === null || !note || draft === note.summary) {
      setDraft(null);
      return;
    }
    run(() =>
      editSharedNote(note.peer, note.id, draft).then(() => setDraft(null)),
    );
  };

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
        {note && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              run(() => deleteSharedNote(note.peer, note.id).then(onBack))
            }
          >
            <Icon name="trash" />
            Delete
          </Button>
        )}
      </header>
      <div className="shared-note__body" data-scroll>
        <h1 id={titleId} className="shared-note__title" data-selectable>
          {info.title}
        </h1>
        <p className="sharing__note">
          Shared with {info.peerCode} on{' '}
          {dateTimeFormat.format(new Date(info.sharedAt))}. Both of you can edit
          it; your edits merge.
        </p>
        {state.status === 'error' ? (
          <p className="sharing__note" role="alert">
            This note couldn’t be read.
          </p>
        ) : (
          <Textarea
            aria-label="Summary"
            rows={16}
            value={summary}
            disabled={!note}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={save}
          />
        )}
        {error && (
          <p className="sharing__note" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

export function SharedNotesView() {
  const { state } = useAsync(getSharingState, onSharingChanged);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (state.status === 'loading') {
    return <p className="sharing__note">Loading shared notes…</p>;
  }
  if (state.status === 'error' || state.value.status === 'none') {
    return (
      <EmptyState
        icon="document"
        title="No shared notes"
        description="Set up a recovery phrase and add a person under Settings → Sharing to share a meeting’s notes."
      />
    );
  }
  const notes = state.value.notes;
  const selected = notes.find((note) => note.id === selectedId) ?? null;
  if (selected) {
    return (
      <NoteDetail
        key={selected.id}
        info={selected}
        onBack={() => setSelectedId(null)}
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
      <h1 className="shared-notes__title">Shared notes</h1>
      <List>
        {notes.map((note) => (
          <ListRow key={note.id} onClick={() => setSelectedId(note.id)}>
            <span className="shared-notes__name">{note.title}</span>
            <span className="sharing__note">
              With {note.peerCode} ·{' '}
              {dateTimeFormat.format(new Date(note.sharedAt))}
            </span>
          </ListRow>
        ))}
      </List>
    </section>
  );
}
