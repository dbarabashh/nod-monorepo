import { Button } from '../../../components/ui/index.ts';
import { useAsync } from '../../../lib/use-async.ts';
import { getSyncState, onSyncChanged } from '../api.ts';
import { ChoosePlace } from './choose-place.tsx';

type SyncStepProps = {
  onDone: () => void;
};

export function SyncStep({ onDone }: SyncStepProps) {
  const { state, retry } = useAsync(getSyncState, onSyncChanged);

  if (state.status === 'loading') {
    return null;
  }
  if (state.status === 'error' || state.value.status !== 'ready') {
    return (
      <div className="sync">
        <p className="sync__note" role="alert">
          Couldn’t check sync.
        </p>
        <div className="sync__actions">
          <Button onClick={retry}>Try again</Button>
          <Button variant="ghost" onClick={onDone}>
            Not now
          </Button>
        </div>
      </div>
    );
  }
  const sync = state.value;
  if (sync.transport) {
    return (
      <div className="sync">
        <p className="sync__note">
          Meetings sync through{' '}
          <span data-selectable>
            {sync.transport.kind === 'folder'
              ? sync.transport.folder
              : sync.transport.url}
          </span>
          . Choose the same place on each of your devices.
        </p>
        <div className="sync__actions">
          <Button variant="primary" onClick={onDone}>
            Continue
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="sync">
      <ChoosePlace state={sync} />
      <div className="sync__actions">
        <Button variant="ghost" onClick={onDone}>
          Not now
        </Button>
      </div>
      <p className="sync__note">
        Without a place, meetings stay on this device only. You can choose one
        later in Settings → Sync.
      </p>
    </div>
  );
}
