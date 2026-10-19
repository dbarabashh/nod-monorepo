import { useState, type FormEvent } from 'react';
import type { SyncState } from '../../../shared/ipc.ts';
import { Button, Field, Input } from '../../components/ui/index.ts';
import { useAsync } from '../../lib/use-async.ts';
import {
  approveSyncDevice,
  cancelSyncJoin,
  chooseSyncFolder,
  confirmSyncJoin,
  connectSyncRelay,
  getSyncState,
  onSyncChanged,
  rejectSyncDevice,
  stopSync,
  syncNow,
} from './api.ts';
import { RecoveryPhrase } from './components/recovery-phrase.tsx';
import { formatCode } from './lib/format-code.ts';
import { useAction } from './lib/use-action.ts';
import './sync.css';

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

function Off({ state }: { state: Extract<SyncState, { status: 'off' }> }) {
  const { busy, error, run } = useAction();
  const [url, setUrl] = useState('');
  const [vaultId, setVaultId] = useState('');

  function connect(event: FormEvent) {
    event.preventDefault();
    run(() => connectSyncRelay(url, vaultId.trim()));
  }

  return (
    <div className="sync">
      <p className="sync__note">
        Choose a folder your devices already share, such as iCloud Drive,
        Dropbox or Syncthing. Meetings travel through it encrypted, and the
        service that holds the folder can't read them.
      </p>
      <div className="sync__actions">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => run(chooseSyncFolder)}
        >
          Sync through a folder…
        </Button>
      </div>
      <details className="sync__relay">
        <summary>Use a relay server instead</summary>
        <form className="sync__form" onSubmit={connect}>
          <Field
            label="Relay address"
            hint="An https:// address you run or trust."
          >
            {(control) => (
              <Input
                {...control}
                type="url"
                required
                value={url}
                placeholder="https://"
                onChange={(event) => setUrl(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Vault ID"
            hint="Leave empty to start syncing here; enter the ID another device shows to join it."
          >
            {(control) => (
              <Input
                {...control}
                value={vaultId}
                onChange={(event) => setVaultId(event.target.value)}
              />
            )}
          </Field>
          <div className="sync__actions">
            <Button type="submit" disabled={busy || url === ''}>
              {vaultId.trim() === '' ? 'Start syncing' : 'Join'}
            </Button>
          </div>
        </form>
      </details>
      <p className="sync__note">
        Lost the devices that synced? Restore them under Recovery phrase.
      </p>
      {(error ?? state.error) && (
        <p className="sync__note" role="alert">
          {error ?? state.error}
        </p>
      )}
    </div>
  );
}

function Joining({
  state,
}: {
  state: Extract<SyncState, { status: 'joining' }>;
}) {
  const { busy, error, run } = useAction();
  const code = state.code;
  return (
    <div className="sync">
      {code === null ? (
        <output className="sync__note">
          Asking your other devices to let this one in. Keep the app open on one
          of them.
        </output>
      ) : state.confirmed ? (
        <>
          <p className="sync__code" data-selectable>
            {formatCode(code)}
          </p>
          <output className="sync__note">
            Waiting for the other device to allow this one.
          </output>
        </>
      ) : (
        <>
          <p className="sync__note">
            On a device that already syncs, open Settings. Continue only if it
            shows the same code, then allow this device there.
          </p>
          <p className="sync__code" data-selectable>
            {formatCode(code)}
          </p>
        </>
      )}
      {error && (
        <p className="sync__note" role="alert">
          {error}
        </p>
      )}
      <div className="sync__actions">
        {code !== null && !state.confirmed && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => run(() => confirmSyncJoin(code))}
          >
            Codes match
          </Button>
        )}
        <Button disabled={busy} onClick={() => run(cancelSyncJoin)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function On({ state }: { state: Extract<SyncState, { status: 'on' }> }) {
  const { busy, error, run } = useAction();
  const where =
    state.transport.kind === 'folder'
      ? state.transport.folder
      : state.transport.url;
  const devices =
    state.devices === 1 ? '1 other device' : `${state.devices} other devices`;

  return (
    <div className="sync">
      {!state.recoveryConfirmed && <RecoveryPhrase confirming />}
      <dl className="sync__facts">
        <dt>Through</dt>
        <dd data-selectable>{where}</dd>
        <dt>Devices</dt>
        <dd>{devices}</dd>
        <dt>Last synced</dt>
        <dd>
          {state.lastSyncedAt === null
            ? 'Not yet'
            : timeFormat.format(new Date(state.lastSyncedAt))}
        </dd>
        {state.transport.kind === 'relay' && (
          <>
            <dt>Vault ID</dt>
            <dd data-selectable>{state.vaultId}</dd>
          </>
        )}
      </dl>
      {state.requests.map((request) => (
        <section
          key={request.requestId}
          className="sync__request"
          aria-label="Device asking to join"
        >
          <p className="sync__note">
            A device is asking to join. Allow it only if it shows this code:
          </p>
          <p className="sync__code" data-selectable>
            {formatCode(request.code)}
          </p>
          <div className="sync__actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                run(() => approveSyncDevice(request.requestId, request.code))
              }
            >
              Codes match, allow
            </Button>
            <Button
              disabled={busy}
              onClick={() => run(() => rejectSyncDevice(request.requestId))}
            >
              Don’t allow
            </Button>
          </div>
        </section>
      ))}
      {(error ?? state.error) && (
        <p className="sync__note" role="alert">
          {error ?? state.error}
        </p>
      )}
      <div className="sync__actions">
        <Button disabled={busy} onClick={() => run(syncNow)}>
          Sync now
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(stopSync)}>
          Stop syncing on this device
        </Button>
      </div>
    </div>
  );
}

export function SyncPanel() {
  const { state } = useAsync(getSyncState, onSyncChanged);
  if (state.status === 'loading') {
    return <p className="sync__note">Checking sync…</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="sync__note" role="alert">
        Couldn’t check sync.
      </p>
    );
  }
  const sync = state.value;
  switch (sync.status) {
    case 'off':
      return <Off state={sync} />;
    case 'joining':
      return <Joining state={sync} />;
    case 'on':
      return <On state={sync} />;
  }
}
