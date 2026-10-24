import { useState } from 'react';
import type { SyncState } from '../../../../shared/ipc.ts';
import {
  Button,
  Field,
  Input,
  Textarea,
} from '../../../components/ui/index.ts';
import { useAction } from '../../../lib/use-action.ts';
import { useAsync } from '../../../lib/use-async.ts';
import {
  addKnownTeam,
  createTeam,
  getSyncState,
  joinTeam,
  onSyncChanged,
} from '../api.ts';

// The relay this device syncs through, where a new team lives without
// asking; otherwise the team needs a relay of its own.
function syncRelayOf(sync: SyncState | null): string | null {
  return sync?.status === 'ready' &&
    !sync.closed &&
    sync.transport?.kind === 'relay'
    ? sync.transport.url
    : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function CreateTeam() {
  const { state } = useAsync(getSyncState, onSyncChanged);
  const sync = state.status === 'ready' ? state.value : null;
  const syncRelay = syncRelayOf(sync);
  const offered = sync?.status === 'ready' ? sync.defaultRelay : null;
  const [name, setName] = useState('');
  const [myName, setMyName] = useState('');
  const [relay, setRelay] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const relayShown = relay ?? offered ?? '';

  return (
    <form
      className="sharing__box"
      aria-label="Create a team"
      onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          if (await createTeam(name, myName, syncRelay ? null : relayShown)) {
            setName('');
          }
        });
      }}
    >
      <h3 className="sharing__box-title">Create a team</h3>
      <p className="sharing__note">
        A team is a shared notebook on a relay. You own it, give each member a
        role, and invite people by link or identity card.{' '}
        {syncRelay
          ? `It lives on ${hostOf(syncRelay)}, the relay you sync through.`
          : 'Teams need a relay in this version, and this device doesn’t sync through one, so enter the relay to keep the team on.'}
      </p>
      {!syncRelay && (
        <Field label="Relay address">
          {(control) => (
            <Input
              {...control}
              type="url"
              value={relayShown}
              spellCheck={false}
              placeholder="https://"
              onChange={(event) => setRelay(event.target.value)}
            />
          )}
        </Field>
      )}
      <div className="sharing__form-row">
        <Field label="Team name">
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Your name in the team">
          {(control) => (
            <Input
              {...control}
              value={myName}
              maxLength={120}
              onChange={(event) => setMyName(event.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="sharing__actions">
        <Button
          type="submit"
          variant="primary"
          disabled={
            busy ||
            name.trim() === '' ||
            (syncRelay === null && relayShown.trim() === '')
          }
        >
          {syncRelay ? 'Create team' : 'Create team…'}
        </Button>
      </div>
      {error && (
        <p className="sharing__note" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

const teamLinkPrefix = 'nod-team:';

export function JoinTeam() {
  const [link, setLink] = useState('');
  const [myName, setMyName] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const known = link.trim().startsWith(teamLinkPrefix);

  return (
    <form
      className="sharing__box"
      aria-label="Join a team"
      onSubmit={(event) => {
        event.preventDefault();
        setDone(null);
        run(async () => {
          if (known) {
            if (await addKnownTeam(link)) {
              setDone(
                'The team is added. Its list is read on the next sync, once an owner or admin has added your identity card.',
              );
              setLink('');
            }
            return;
          }
          const joined = await joinTeam(link, myName);
          if (joined) {
            setDone(
              joined.pending
                ? 'Your request is sent. The team shows up here once an owner or admin accepts it.'
                : 'You joined the team.',
            );
            setLink('');
          }
        });
      }}
    >
      <h3 className="sharing__box-title">Join a team</h3>
      <p className="sharing__note">
        Paste an invite link (nod-join:…). Nod shows the team and who invited
        you before anything is sent. A team link (nod-team:…) from someone who
        added your identity card only tells this device where the team is.
      </p>
      <Field label="Link">
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            value={link}
            spellCheck={false}
            placeholder="nod-join:v1:…"
            onChange={(event) => setLink(event.target.value)}
          />
        )}
      </Field>
      {!known && (
        <Field
          label="Your name in the team"
          hint="Travels encrypted to the person who invited you."
        >
          {(control) => (
            <Input
              {...control}
              value={myName}
              maxLength={120}
              onChange={(event) => setMyName(event.target.value)}
            />
          )}
        </Field>
      )}
      <div className="sharing__actions">
        <Button
          type="submit"
          variant="primary"
          disabled={busy || link.trim() === ''}
        >
          {known ? 'Add team…' : 'Join…'}
        </Button>
      </div>
      {done && (
        <p className="sharing__note" role="status">
          {done}
        </p>
      )}
      {error && (
        <p className="sharing__note" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
