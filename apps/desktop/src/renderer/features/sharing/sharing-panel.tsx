import { useState } from 'react';
import type { SharingPeer } from '../../../shared/ipc.ts';
import { Button, Field, Textarea } from '../../components/ui/index.ts';
import { useAction } from '../../lib/use-action.ts';
import { useAsync } from '../../lib/use-async.ts';
import {
  addSharingPeer,
  getSharingState,
  onSharingChanged,
  showIdentityCard,
  stopSharingPeer,
} from './api.ts';
import './sharing.css';

function AddPerson() {
  const [card, setCard] = useState('');
  const { busy, error, run } = useAction();

  return (
    <section className="sharing__box" aria-label="Add a person">
      <h3 className="sharing__box-title">Add a person</h3>
      <p className="sharing__note">
        Paste the identity card they sent you. Nod shows its code; check it with
        them before you continue.
      </p>
      <Field label="Identity card">
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            value={card}
            spellCheck={false}
            placeholder="nod-id:v1:…"
            onChange={(event) => setCard(event.target.value)}
          />
        )}
      </Field>
      <div className="sharing__actions">
        <Button
          variant="primary"
          disabled={busy || card.trim() === ''}
          onClick={() =>
            run(async () => {
              if (await addSharingPeer(card)) {
                setCard('');
              }
            })
          }
        >
          Add…
        </Button>
      </div>
      {error && (
        <p className="sharing__note" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function People({ peers }: { peers: SharingPeer[] }) {
  const { busy, error, run } = useAction();
  const active = peers.filter((peer) => peer.stoppedAt === null);

  return (
    <section className="sharing__box" aria-label="People you share with">
      <h3 className="sharing__box-title">People you share with</h3>
      {active.length === 0 ? (
        <p className="sharing__note">
          Nobody yet. Add a person below, and have them add your card.
        </p>
      ) : (
        <ul className="sharing__people">
          {active.map((peer) => (
            <li key={peer.identity} className="sharing__person">
              <span className="sharing__person-code" data-selectable>
                {peer.code}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => run(() => stopSharingPeer(peer.identity))}
              >
                Stop sharing…
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="sharing__note" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function SharingPanel() {
  const { state } = useAsync(getSharingState, onSharingChanged);
  const { busy, error, run } = useAction();

  if (state.status === 'loading') {
    return <p className="sharing__note">Checking sharing…</p>;
  }
  if (state.status === 'error') {
    return (
      <p className="sharing__note" role="alert">
        Couldn’t check sharing.
      </p>
    );
  }
  const sharing = state.value;
  if (sharing.status === 'none') {
    return (
      <p className="sharing__note">
        Sharing needs a recovery phrase. Set one up under Sync first.
      </p>
    );
  }
  return (
    <div className="sharing">
      <dl className="sharing__facts">
        <dt>Your identity code</dt>
        <dd data-selectable>{sharing.code}</dd>
      </dl>
      <p className="sharing__note">
        Your identity comes from your recovery phrase, so every device of yours
        has it. Send your card to someone and add theirs, and the two of you can
        share notes. Notes travel encrypted through the folder or relay you sync
        with, and only the two of you can read them.
      </p>
      <div className="sharing__actions">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => run(showIdentityCard)}
        >
          Show my identity card…
        </Button>
      </div>
      {(error ?? sharing.error) && (
        <p className="sharing__note" role="alert">
          {error ?? sharing.error}
        </p>
      )}
      <People peers={sharing.peers} />
      <AddPerson />
    </div>
  );
}
