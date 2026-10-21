import type { SyncDevice } from '../../../../shared/ipc.ts';
import { Button } from '../../../components/ui/index.ts';
import { useAction } from '../../../lib/use-action.ts';
import { useAsync } from '../../../lib/use-async.ts';
import { forgetSyncDevice, listSyncDevices } from '../api.ts';
import { dateTimeFormat } from '../../../lib/formats.ts';

function summary(device: SyncDevice): string {
  const meetings =
    device.meetings === 1 ? '1 meeting' : `${device.meetings} meetings`;
  return `${meetings} · last change ${dateTimeFormat.format(new Date(device.lastChangedAt))}`;
}

export function Devices() {
  const { state, refresh } = useAsync(listSyncDevices);
  const { busy, error, run } = useAction();

  if (state.status === 'loading') {
    return null;
  }
  return (
    <section className="sync__choice" aria-label="Other devices">
      <h3 className="sync__choice-title">Other devices</h3>
      {state.status === 'error' ? (
        <p className="sync__note" role="alert">
          Couldn’t list the devices in the vault.
        </p>
      ) : state.value.length === 0 ? (
        <p className="sync__note">
          No other device has meetings in the vault yet.
        </p>
      ) : (
        <ul className="sync__devices">
          {state.value.map((device) => (
            <li key={device.id} className="sync__device">
              <span className="sync__device-name" data-selectable>
                Device {device.id.slice(0, 8)}
              </span>
              <span className="sync__note">{summary(device)}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(() => forgetSyncDevice(device.id).then(refresh))
                }
              >
                Forget…
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="sync__note">
        A phone you reinstalled or no longer use keeps its copies in the vault
        until you forget it here.
      </p>
      {error && (
        <p className="sync__note" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
