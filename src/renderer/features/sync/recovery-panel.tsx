import { useAsync } from '../../lib/use-async.ts';
import { getSyncState, onSyncChanged } from './api.ts';
import { RecoveryPhrase } from './components/recovery-phrase.tsx';
import { RestoreForm } from './components/restore-form.tsx';
import './sync.css';

export function RecoveryPanel() {
  const { state } = useAsync(getSyncState, onSyncChanged);
  if (state.status !== 'ready') {
    return null;
  }
  const sync = state.value;
  if (sync.status === 'on') {
    return <RecoveryPhrase confirming={!sync.recoveryConfirmed} />;
  }
  if (sync.status === 'joining') {
    return (
      <p className="sync__note">
        Finish joining first. The phrase is the same on every device of a vault.
      </p>
    );
  }
  return (
    <div className="sync">
      <p className="sync__note">
        This device doesn’t sync yet. If you lost the devices that did, enter
        their recovery phrase to bring your meetings back.
      </p>
      <RestoreForm />
    </div>
  );
}
