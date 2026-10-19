import { useState, type SubmitEvent } from 'react';
import type { SyncState } from '../../../shared/ipc.ts';
import { Button, Field, Input } from '../../components/ui/index.ts';
import { useAsync } from '../../lib/use-async.ts';
import {
  chooseSyncFolder,
  connectSyncRelay,
  disconnectSync,
  getSyncState,
  onSyncChanged,
  syncNow,
} from './api.ts';
import { KeySetup } from './components/key-setup.tsx';
import { RecoveryPhrase } from './components/recovery-phrase.tsx';
import { Unavailable } from './components/unavailable.tsx';
import { useAction } from './lib/use-action.ts';
import './sync.css';

type Ready = Extract<SyncState, { status: 'ready' }>;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

function ChoosePlace({ state }: { state: Ready }) {
  const { busy, error, run } = useAction();
  const [url, setUrl] = useState('');

  function connect(event: SubmitEvent) {
    event.preventDefault();
    run(() => connectSyncRelay(url));
  }

  return (
    <div className="sync">
      {state.defaultRelay && (
        <>
          <p className="sync__note">
            Meetings travel through {hostOf(state.defaultRelay)} encrypted with
            your recovery phrase, so the relay can’t read them. Turn it on here
            and on each of your devices.
          </p>
          <div className="sync__actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                const relay = state.defaultRelay;
                if (relay) {
                  run(() => connectSyncRelay(relay));
                }
              }}
            >
              Sync through {hostOf(state.defaultRelay)}
            </Button>
          </div>
        </>
      )}
      <p className="sync__note">
        {state.defaultRelay ? 'Or choose' : 'Choose'} a folder your devices
        already share, such as iCloud Drive, Dropbox or Syncthing, and choose
        the same one on each device. Meetings travel through it encrypted, and
        the service that holds the folder can’t read them.
      </p>
      <div className="sync__actions">
        <Button
          variant={state.defaultRelay ? 'default' : 'primary'}
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
            hint="An https:// address you run or trust. Use the same one on each device."
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
          <div className="sync__actions">
            <Button type="submit" disabled={busy || url === ''}>
              Connect
            </Button>
          </div>
        </form>
      </details>
      {(error ?? state.error) && (
        <p className="sync__note" role="alert">
          {error ?? state.error}
        </p>
      )}
    </div>
  );
}

function Connected({
  state,
  transport,
}: {
  state: Ready;
  transport: NonNullable<Ready['transport']>;
}) {
  const { busy, error, run } = useAction();
  const devices =
    state.devices === 1 ? '1 other device' : `${state.devices} other devices`;

  return (
    <div className="sync">
      <dl className="sync__facts">
        <dt>Through</dt>
        <dd data-selectable>
          {transport.kind === 'folder' ? transport.folder : transport.url}
        </dd>
        <dt>Devices</dt>
        <dd>{state.connected ? devices : 'Not reachable right now'}</dd>
        <dt>Last synced</dt>
        <dd>
          {state.lastSyncedAt === null
            ? 'Not yet'
            : timeFormat.format(new Date(state.lastSyncedAt))}
        </dd>
      </dl>
      {state.connected && state.devices === 0 && (
        <p className="sync__note">
          To add a device, install Nod there, choose “Already use Nod” and enter
          your recovery phrase, then choose this same{' '}
          {transport.kind === 'folder' ? 'folder' : 'relay'}.
        </p>
      )}
      {(error ?? state.error) && (
        <p className="sync__note" role="alert">
          {error ?? state.error}
        </p>
      )}
      <div className="sync__actions">
        <Button disabled={busy} onClick={() => run(syncNow)}>
          Sync now
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => run(disconnectSync)}
        >
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
  if (sync.status === 'unavailable') {
    return <Unavailable error={sync.error} />;
  }
  if (sync.status === 'none') {
    return (
      <div className="sync">
        <p className="sync__note">
          Your devices sync through a recovery phrase. Set one up first.
        </p>
        <KeySetup />
      </div>
    );
  }
  return (
    <div className="sync">
      {!sync.recoveryConfirmed && (
        <RecoveryPhrase key={sync.vaultId} confirming />
      )}
      {sync.transport ? (
        <Connected state={sync} transport={sync.transport} />
      ) : (
        <ChoosePlace state={sync} />
      )}
    </div>
  );
}
