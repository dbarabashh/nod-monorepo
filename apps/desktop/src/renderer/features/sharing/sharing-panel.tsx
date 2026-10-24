import { useState, type ReactNode } from 'react';
import type {
  SharingPeer,
  SharingState,
  TeamInfo,
} from '../../../shared/ipc.ts';

type SharingReady = Extract<SharingState, { status: 'ready' }>;
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
import { TeamCard } from './components/team-card.tsx';
import { CreateTeam, JoinTeam } from './components/team-forms.tsx';
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

function Teams({ teams, me }: { teams: TeamInfo[]; me: string }) {
  return (
    <section className="sharing__box" aria-label="Teams">
      <h3 className="sharing__box-title">Teams</h3>
      {teams.length === 0 ? (
        <p className="sharing__note">
          No teams yet. Create one below, or join one from a link someone sent
          you.
        </p>
      ) : (
        <div className="sharing__teams">
          {teams.map((team) => (
            <TeamCard key={team.vaultId} team={team} me={me} />
          ))}
        </div>
      )}
    </section>
  );
}

// Both pages need the identity's sharing state, and neither exists before
// a recovery phrase does.
function WithSharing({
  children,
}: {
  children: (sharing: SharingReady) => ReactNode;
}) {
  const { state } = useAsync(getSharingState, onSharingChanged);

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
  return <div className="sharing">{children(sharing)}</div>;
}

function Identity({
  sharing,
  about,
}: {
  sharing: SharingReady;
  about: string;
}) {
  const { busy, error, run } = useAction();

  return (
    <>
      <dl className="sharing__facts">
        <dt>Your identity code</dt>
        <dd data-selectable>{sharing.code}</dd>
      </dl>
      <p className="sharing__note">{about}</p>
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
    </>
  );
}

export function PeoplePanel() {
  return (
    <WithSharing>
      {(sharing) => (
        <>
          <Identity
            sharing={sharing}
            about="Your identity comes from your recovery phrase, so every device of yours has it. Send your card to the person and add theirs. Notes you share travel encrypted through the folder or relay you sync with."
          />
          <People peers={sharing.peers} />
          <AddPerson />
        </>
      )}
    </WithSharing>
  );
}

export function TeamsPanel() {
  return (
    <WithSharing>
      {(sharing) => (
        <>
          <Identity
            sharing={sharing}
            about="An owner or admin can add you to their team by your identity card, or send you an invite link. A team’s notes travel encrypted through its relay."
          />
          <Teams teams={sharing.teams} me={sharing.code} />
          <CreateTeam />
          <JoinTeam />
        </>
      )}
    </WithSharing>
  );
}
