import { useState, type FormEvent } from 'react';
import { Button, Field, Input } from '../../../components/ui/index.ts';
import { restoreSyncFromFolder, restoreSyncFromRelay } from '../api.ts';
import { useAction } from '../lib/use-action.ts';

export function RestoreForm() {
  const { busy, error, run } = useAction();
  const [phrase, setPhrase] = useState('');
  const [url, setUrl] = useState('');
  const [vaultId, setVaultId] = useState('');

  function fromRelay(event: FormEvent) {
    event.preventDefault();
    run(() => restoreSyncFromRelay(url, vaultId.trim(), phrase));
  }

  return (
    <details className="sync__relay">
      <summary>Restore with a recovery phrase</summary>
      <form className="sync__form" onSubmit={fromRelay}>
        <Field
          label="Recovery phrase"
          hint="The 24 words shown on a device that synced, in order."
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
            disabled={busy || phrase.trim() === ''}
            onClick={() => run(() => restoreSyncFromFolder(phrase))}
          >
            Restore from a folder…
          </Button>
        </div>
        <Field label="Relay address" hint="Or restore from a relay.">
          {(control) => (
            <Input
              {...control}
              type="url"
              value={url}
              placeholder="https://"
              onChange={(event) => setUrl(event.target.value)}
            />
          )}
        </Field>
        <Field label="Vault ID">
          {(control) => (
            <Input
              {...control}
              value={vaultId}
              onChange={(event) => setVaultId(event.target.value)}
            />
          )}
        </Field>
        <div className="sync__actions">
          <Button
            type="submit"
            disabled={
              busy ||
              phrase.trim() === '' ||
              url === '' ||
              vaultId.trim() === ''
            }
          >
            Restore from the relay
          </Button>
        </div>
        {error && (
          <p className="sync__note" role="alert">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
