import { useState } from 'react';
import { Button } from '../../components/ui/index.ts';
import { useAsync } from '../../lib/use-async.ts';
import { changeRecoveryPhrase, getSyncState, onSyncChanged } from './api.ts';
import { KeySetup } from './components/key-setup.tsx';
import { PhraseChanged } from './components/phrase-changed.tsx';
import { PhraseForm } from './components/phrase-form.tsx';
import { RecoveryPhrase } from './components/recovery-phrase.tsx';
import { Unavailable } from './components/unavailable.tsx';
import { useAction } from '../../lib/use-action.ts';
import './sync.css';

export function RecoveryPanel() {
  const { state } = useAsync(getSyncState, onSyncChanged);
  const [switching, setSwitching] = useState(false);
  const { busy, error, run } = useAction();
  if (state.status !== 'ready') {
    return null;
  }
  const sync = state.value;
  if (sync.status === 'none') {
    return <KeySetup />;
  }
  if (sync.status === 'unavailable') {
    return <Unavailable error={sync.error} />;
  }
  if (sync.closed) {
    return <PhraseChanged syncing={sync.transport !== null} />;
  }
  return (
    <div className="sync">
      <RecoveryPhrase key={sync.vaultId} confirming={!sync.recoveryConfirmed} />
      <section className="sync__choice" aria-label="Change the phrase">
        <h3 className="sync__choice-title">Change recovery phrase</h3>
        <p className="sync__note">
          If the words may have been seen by someone else, or a device was lost,
          change them, then enter the new phrase on each device you keep right
          away. Until a device has it, what it syncs can still be read with the
          old phrase.
        </p>
        {error && (
          <p className="sync__note" role="alert">
            {error}
          </p>
        )}
        <div className="sync__actions">
          <Button disabled={busy} onClick={() => run(changeRecoveryPhrase)}>
            Change recovery phrase…
          </Button>
        </div>
      </section>
      <section className="sync__choice" aria-label="Use another phrase">
        <h3 className="sync__choice-title">Use a different phrase</h3>
        <p className="sync__note">
          If your other devices show different words, enter theirs here. This
          device then syncs with them, and the meetings on it move along.
        </p>
        {switching ? (
          <PhraseForm
            submitLabel="Switch to this phrase"
            onDone={() => setSwitching(false)}
            onCancel={() => setSwitching(false)}
          />
        ) : (
          <div className="sync__actions">
            <Button onClick={() => setSwitching(true)}>
              Enter another phrase
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
