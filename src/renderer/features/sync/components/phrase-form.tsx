import { useState, type SubmitEvent } from 'react';
import { Button, Field, Textarea } from '../../../components/ui/index.ts';
import { enterRecoveryPhrase } from '../api.ts';
import { countWords, phraseLength } from '../lib/count-words.ts';
import { useAction } from '../lib/use-action.ts';

type PhraseFormProps = {
  submitLabel: string;
  onDone?: () => void;
  onCancel?: () => void;
};

export function PhraseForm({ submitLabel, onDone, onCancel }: PhraseFormProps) {
  const { busy, error, run } = useAction();
  const [phrase, setPhrase] = useState('');
  const words = countWords(phrase);

  function submit(event: SubmitEvent) {
    event.preventDefault();
    run(async () => {
      if (await enterRecoveryPhrase(phrase)) {
        onDone?.();
      }
    });
  }

  return (
    <form className="sync__form" onSubmit={submit}>
      <Field
        label="Recovery phrase"
        hint={`${words} of ${phraseLength} words. Type or paste them in order, separated by spaces; numbers, commas and line breaks don’t matter. Nod then shows the words and their vault code in a system window to compare.`}
        error={error ?? undefined}
      >
        {(control) => (
          <Textarea
            {...control}
            value={phrase}
            rows={4}
            placeholder="word word word …"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(event) => setPhrase(event.target.value)}
          />
        )}
      </Field>
      <div className="sync__actions">
        <Button
          type="submit"
          variant="primary"
          disabled={busy || words !== phraseLength}
        >
          {submitLabel}
        </Button>
        {onCancel && (
          <Button disabled={busy} onClick={onCancel}>
            Back
          </Button>
        )}
      </div>
    </form>
  );
}
