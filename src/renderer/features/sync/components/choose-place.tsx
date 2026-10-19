import { useState, type SubmitEvent } from 'react';
import type { SyncState } from '../../../../shared/ipc.ts';
import { Button, Field, Input } from '../../../components/ui/index.ts';
import { chooseSyncFolder, connectSyncRelay } from '../api.ts';
import { useAction } from '../lib/use-action.ts';

type Ready = Extract<SyncState, { status: 'ready' }>;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ChoosePlace({ state }: { state: Ready }) {
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
