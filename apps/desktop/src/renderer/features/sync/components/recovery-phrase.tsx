import { Button } from '../../../components/ui/index.ts';
import { showRecoveryPhrase } from '../api.ts';
import { useAction } from '../../../lib/use-action.ts';

type RecoveryPhraseProps = {
  confirming: boolean;
  onConfirmed?: () => void;
};

export function RecoveryPhrase({
  confirming,
  onConfirmed,
}: RecoveryPhraseProps) {
  const { busy, error, run } = useAction();

  return (
    <section
      className="sync__recovery"
      data-variant={confirming ? 'confirm' : undefined}
      aria-label="Recovery phrase"
    >
      {confirming && (
        <h3 className="sync__recovery-title">
          Write down your recovery phrase
        </h3>
      )}
      <p className="sync__note">
        Twenty-four words and a vault code. Enter the words on your other
        devices to sync your meetings there, or on a new device if you lose this
        one; Nod shows the code there to compare. Nod shows them in a separate
        system window, out of reach of this page. Anyone who has the words can
        read your meetings, so keep them on paper.
      </p>
      {error && (
        <p className="sync__note" role="alert">
          {error}
        </p>
      )}
      <div className="sync__actions">
        <Button
          variant={confirming ? 'primary' : 'default'}
          disabled={busy}
          onClick={() =>
            run(async () => {
              if ((await showRecoveryPhrase()) && confirming) {
                onConfirmed?.();
              }
            })
          }
        >
          Show recovery phrase
        </Button>
      </div>
    </section>
  );
}
