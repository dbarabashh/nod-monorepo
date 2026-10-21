import { Button } from '../../../components/ui/index.ts';
import { changeRecoveryPhrase, disconnectSync } from '../api.ts';
import { useAction } from '../../../lib/use-action.ts';
import { PhraseForm } from './phrase-form.tsx';

type PhraseChangedProps = {
  syncing: boolean;
};

export function PhraseChanged({ syncing }: PhraseChangedProps) {
  const { busy, error, run } = useAction();
  return (
    <div className="sync">
      <section
        className="sync__recovery"
        data-variant="confirm"
        aria-label="Recovery phrase changed"
      >
        <h3 className="sync__recovery-title">
          Your recovery phrase was changed on another device
        </h3>
        <p className="sync__note">
          Sync through the old phrase has stopped on this device. Enter the new
          phrase, reading it from the device where you changed it, never from a
          message or someone who sends it to you.
        </p>
        <PhraseForm submitLabel="Use the new phrase" />
      </section>
      <section className="sync__choice" aria-label="If you didn’t change it">
        <h3 className="sync__choice-title">Didn’t change it?</h3>
        <p className="sync__note">
          Someone with your old phrase may have. Make a new phrase here and
          enter it on the devices you keep
          {syncing ? ', or stop syncing on this device' : ''}.
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
          {syncing && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(disconnectSync)}
            >
              Stop syncing on this device
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
