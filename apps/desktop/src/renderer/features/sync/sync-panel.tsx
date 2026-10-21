import type { SyncState } from '../../../shared/ipc.ts';
import { Button } from '../../components/ui/index.ts';
import { useAsync } from '../../lib/use-async.ts';
import {
  disconnectSync,
  getSyncState,
  onSyncChanged,
  showPairingCode,
  syncNow,
} from './api.ts';
import { ChoosePlace } from './components/choose-place.tsx';
import { Devices } from './components/devices.tsx';
import { KeySetup } from './components/key-setup.tsx';
import { PhraseChanged } from './components/phrase-changed.tsx';
import { RecoveryPhrase } from './components/recovery-phrase.tsx';
import { Unavailable } from './components/unavailable.tsx';
import { useAction } from '../../lib/use-action.ts';
import './sync.css';
import { clockFormat } from '../../lib/formats.ts';

type Ready = Extract<SyncState, { status: 'ready' }>;

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
            : clockFormat.format(new Date(state.lastSyncedAt))}
        </dd>
      </dl>
      {transport.kind === 'relay' ? (
        <p className="sync__note">
          To add your phone, install Nod there and scan the pairing code. To add
          a computer, choose “Already use Nod” there, enter your recovery phrase
          and connect this same relay.
        </p>
      ) : (
        state.connected &&
        state.devices === 0 && (
          <p className="sync__note">
            To add a device, install Nod there, choose “Already use Nod” and
            enter your recovery phrase, then choose this same folder. A phone
            pairs only through a relay.
          </p>
        )
      )}
      {(error ?? state.error) && (
        <p className="sync__note" role="alert">
          {error ?? state.error}
        </p>
      )}
      <div className="sync__actions">
        {transport.kind === 'relay' && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => run(showPairingCode)}
          >
            Pair a phone…
          </Button>
        )}
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
      {state.connected && <Devices key={state.devices} />}
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
  if (sync.closed) {
    return <PhraseChanged syncing={sync.transport !== null} />;
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
