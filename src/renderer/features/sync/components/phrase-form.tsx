import { useState, type SubmitEvent } from 'react';
import { Button, Field, Input } from '../../../components/ui/index.ts';
import { enterRecoveryPhrase } from '../api.ts';
import { useAction } from '../lib/use-action.ts';

type PhraseFormProps = {
  submitLabel: string;
  onDone?: () => void;
  onCancel?: () => void;
};

export function PhraseForm({ submitLabel, onDone, onCancel }: PhraseFormProps) {
  const { busy, error, run } = useAction();
  const [phrase, setPhrase] = useState('');

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
        hint="The 24 words from Settings → Recovery phrase on your other device, in order. Nod then shows the words and their vault code in a system window to compare."
        error={error ?? undefined}
      >
        {(control) => (
          <Input
            {...control}
            value={phrase}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setPhrase(event.target.value)}
          />
        )}
      </Field>
      <div className="sync__actions">
        <Button
          type="submit"
          variant="primary"
          disabled={busy || phrase.trim() === ''}
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
