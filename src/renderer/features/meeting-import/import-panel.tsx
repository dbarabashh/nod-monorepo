import { useState } from 'react';
import { Button } from '../../components/ui/index.ts';
import { useAction } from '../../lib/use-action.ts';
import { importMeetings } from './api.ts';
import { importOutcome } from './lib/outcome.ts';
import './meeting-import.css';

export function ImportPanel() {
  const { busy, error, run } = useAction();
  const [outcome, setOutcome] = useState<string | null>(null);

  return (
    <section className="meeting-import" aria-label="Import meetings">
      <p className="meeting-import__note">
        In the previous Nod app, choose Export meetings, then choose the
        nod-meetings.json file it saved. The meetings are stored on this device,
        encrypted, and sync to your other devices like the ones you record.
      </p>
      {error && (
        <p className="meeting-import__note" role="alert">
          {error}
        </p>
      )}
      {outcome && (
        <p className="meeting-import__note" role="status">
          {outcome}
        </p>
      )}
      <div className="meeting-import__actions">
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              setOutcome(null);
              const result = await importMeetings();
              if (result.status === 'imported') {
                setOutcome(importOutcome(result));
              }
            })
          }
        >
          {busy ? 'Importing…' : 'Choose file…'}
        </Button>
      </div>
    </section>
  );
}
