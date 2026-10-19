import { useState } from 'react';
import { Button } from '../../../components/ui/index.ts';
import { useAsync } from '../../../lib/use-async.ts';
import { createRecoveryPhrase, getSyncState, onSyncChanged } from '../api.ts';
import { useAction } from '../lib/use-action.ts';
import { Unavailable } from './unavailable.tsx';
import { PhraseForm } from './phrase-form.tsx';
import { RecoveryPhrase } from './recovery-phrase.tsx';

type KeySetupProps = {
  onDone?: () => void;
};

export function KeySetup({ onDone }: KeySetupProps) {
  const { state, retry } = useAsync(getSyncState, onSyncChanged);
  const { busy, error, run } = useAction();
  const [entering, setEntering] = useState(false);

  if (state.status === 'loading') {
    return null;
  }
  if (state.status === 'error') {
    return (
      <div className="sync">
        <p className="sync__note" role="alert">
          Couldn’t check the recovery phrase.
        </p>
        <div className="sync__actions">
          <Button onClick={retry}>Try again</Button>
        </div>
      </div>
    );
  }
  const sync = state.value;
  if (sync.status === 'unavailable') {
    return <Unavailable error={sync.error} onDone={onDone} />;
  }
  if (sync.status === 'ready') {
    if (!sync.recoveryConfirmed) {
      return (
        <RecoveryPhrase key={sync.vaultId} confirming onConfirmed={onDone} />
      );
    }
    return (
      <div className="sync">
        <p className="sync__note">
          This device has your recovery phrase. You can see it any time in
          Settings → Recovery phrase.
        </p>
        {onDone && (
          <div className="sync__actions">
            <Button variant="primary" onClick={onDone}>
              Continue
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (entering) {
    return (
      <section className="sync__choice" aria-label="Enter your recovery phrase">
        <PhraseForm
          submitLabel="Use this phrase"
          onDone={onDone}
          onCancel={() => setEntering(false)}
        />
      </section>
    );
  }
  return (
    <div className="sync">
      <section className="sync__choice">
        <h3 className="sync__choice-title">New to Nod</h3>
        <p className="sync__note">
          Create a recovery phrase for your meetings. You’ll enter it on your
          other devices to sync with this one.
        </p>
        <div className="sync__actions">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => run(createRecoveryPhrase)}
          >
            Create a recovery phrase
          </Button>
        </div>
      </section>
      <section className="sync__choice">
        <h3 className="sync__choice-title">Already use Nod</h3>
        <p className="sync__note">
          Enter the recovery phrase from your other device, and this one syncs
          the same meetings.
        </p>
        <div className="sync__actions">
          <Button disabled={busy} onClick={() => setEntering(true)}>
            Enter my recovery phrase
          </Button>
        </div>
      </section>
      {(error ?? sync.error) && (
        <p className="sync__note" role="alert">
          {error ?? sync.error}
        </p>
      )}
    </div>
  );
}
