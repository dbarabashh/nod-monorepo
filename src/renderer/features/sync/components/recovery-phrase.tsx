import { useState } from 'react';
import { Button } from '../../../components/ui/index.ts';
import { confirmRecoveryPhrase, getRecoveryPhrase } from '../api.ts';
import { useAction } from '../lib/use-action.ts';

export function RecoveryPhrase({ confirming }: { confirming: boolean }) {
  const [words, setWords] = useState<string[] | null>(null);
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
        {confirming &&
          'If you lose every device, these 24 words restore sync on a new one. '}
        Anyone who has them can read your synced meetings, so keep them on
        paper, not in a note or a screenshot.
      </p>
      {words && (
        <ol className="sync__words" data-selectable>
          {words.map((word, index) => (
            <li key={index}>{word}</li>
          ))}
        </ol>
      )}
      {error && (
        <p className="sync__note" role="alert">
          {error}
        </p>
      )}
      <div className="sync__actions">
        {words ? (
          <>
            {confirming && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => run(confirmRecoveryPhrase)}
              >
                I’ve written it down
              </Button>
            )}
            <Button onClick={() => setWords(null)}>Hide</Button>
          </>
        ) : (
          <Button
            variant={confirming ? 'primary' : 'default'}
            disabled={busy}
            onClick={() =>
              run(async () => setWords((await getRecoveryPhrase()).split(' ')))
            }
          >
            Show recovery phrase
          </Button>
        )}
      </div>
    </section>
  );
}
