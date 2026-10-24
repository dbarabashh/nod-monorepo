import { useState } from 'react';
import {
  isTeamGrantedRole,
  rankOf,
  teamGrantedRoles,
  type TeamGrantedRole,
  type TeamInfo,
  type TeamInviteInfo,
  type TeamMemberInfo,
  type TeamRequestInfo,
  type TeamRole,
} from '../../../../shared/ipc.ts';
import {
  Badge,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from '../../../components/ui/index.ts';
import { isManager } from '../../../lib/share-targets.ts';
import { useAction } from '../../../lib/use-action.ts';
import {
  addTeamMember,
  answerTeamRequest,
  leaveTeam,
  nameTeamMember,
  removeTeamMember,
  renameTeam,
  revokeTeamInvite,
  rotateTeamKey,
  setTeamMemberRole,
  showTeamInvite,
  showTeamLink,
  transferTeam,
} from '../api.ts';

const unnamedTeam = 'Unnamed team';

// What a manager may grant: only an owner makes admins.
function grantCap(team: TeamInfo): TeamGrantedRole {
  return team.role === 'owner' ? 'admin' : 'writer';
}

function lowerRole(a: TeamGrantedRole, b: TeamGrantedRole): TeamGrantedRole {
  return rankOf(a) <= rankOf(b) ? a : b;
}

function roleOptions(atMost: TeamRole) {
  return teamGrantedRoles
    .filter((role) => rankOf(role) <= rankOf(atMost))
    .toReversed()
    .map((role) => (
      <option key={role} value={role}>
        {role}
      </option>
    ));
}

function roleBadge(role: TeamRole) {
  return role === 'owner' ? 'accent' : role === 'admin' ? 'success' : 'neutral';
}

function Note({ children, alert }: { children: string; alert?: boolean }) {
  return (
    <p className="sharing__note" role={alert ? 'alert' : undefined}>
      {children}
    </p>
  );
}

function MemberName({
  team,
  member,
}: {
  team: TeamInfo;
  member: TeamMemberInfo;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  if (draft === null) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDraft(member.name ?? '')}
      >
        {member.name ? 'Rename…' : 'Name…'}
      </Button>
    );
  }
  return (
    <form
      className="sharing__form-row"
      onSubmit={(event) => {
        event.preventDefault();
        run(() =>
          nameTeamMember(team.vaultId, member.identity, draft).then(() =>
            setDraft(null),
          ),
        );
      }}
    >
      <Input
        aria-label="Member name"
        data-size="sm"
        value={draft}
        maxLength={120}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={busy}>
        Save
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
        Cancel
      </Button>
      {error && <Note alert>{error}</Note>}
    </form>
  );
}

function MemberRow({
  team,
  member,
  me,
}: {
  team: TeamInfo;
  member: TeamMemberInfo;
  me: string;
}) {
  const { busy, error, run } = useAction();
  const manager = isManager(team);
  const self = member.code === me;
  const touchable =
    manager &&
    !self &&
    member.role !== 'owner' &&
    !(team.role === 'admin' && member.role === 'admin');

  return (
    <li className="sharing-team__row">
      <span className="sharing-team__who">
        <span className="sharing-team__code" data-selectable>
          {member.code}
        </span>
        <span className="sharing__note">
          {member.name ?? (self ? 'You' : 'No name yet')}
        </span>
      </span>
      {touchable ? (
        <Select
          aria-label={`Role of ${member.code}`}
          data-size="sm"
          value={member.role}
          disabled={busy}
          onChange={(event) => {
            const role = event.target.value;
            if (isTeamGrantedRole(role)) {
              run(() =>
                setTeamMemberRole(team.vaultId, member.identity, role).then(
                  () => undefined,
                ),
              );
            }
          }}
        >
          {roleOptions(grantCap(team))}
        </Select>
      ) : (
        <Badge variant={roleBadge(member.role)}>{member.role}</Badge>
      )}
      {member.leaving && <Badge variant="warning">Leaving</Badge>}
      {manager && <MemberName team={team} member={member} />}
      {touchable && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            run(() =>
              removeTeamMember(team.vaultId, member.identity).then(
                () => undefined,
              ),
            )
          }
        >
          Remove…
        </Button>
      )}
      {error && <Note alert>{error}</Note>}
    </li>
  );
}

function RequestRow({
  team,
  request,
}: {
  team: TeamInfo;
  request: TeamRequestInfo;
}) {
  const cap = lowerRole(request.role, grantCap(team));
  const [picked, setRole] = useState<TeamGrantedRole>(cap);
  const role = lowerRole(picked, cap);
  const { busy, error, run } = useAction();
  return (
    <li className="sharing-team__row">
      <span className="sharing-team__who">
        <span className="sharing-team__code" data-selectable>
          {request.code}
        </span>
        <span className="sharing__note">
          {request.name ?? 'No name this device can read'} · invited as{' '}
          {request.role}
        </span>
      </span>
      <Select
        aria-label={`Role for ${request.code}`}
        data-size="sm"
        value={role}
        onChange={(event) => {
          const next = event.target.value;
          if (isTeamGrantedRole(next)) {
            setRole(next);
          }
        }}
      >
        {roleOptions(cap)}
      </Select>
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        onClick={() =>
          run(() =>
            answerTeamRequest(team.vaultId, request.id, true, role).then(
              () => undefined,
            ),
          )
        }
      >
        Accept…
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() =>
          run(() =>
            answerTeamRequest(team.vaultId, request.id, false, role).then(
              () => undefined,
            ),
          )
        }
      >
        Decline…
      </Button>
      {error && <Note alert>{error}</Note>}
    </li>
  );
}

function InviteRow({
  team,
  invite,
}: {
  team: TeamInfo;
  invite: TeamInviteInfo;
}) {
  const { busy, error, run } = useAction();
  return (
    <li className="sharing-team__row">
      <span className="sharing__note">
        Link for {invite.role}s,{' '}
        {invite.approval
          ? 'each request approved by an owner or admin'
          : 'joins at once; revoking it changes the key'}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() =>
          run(() =>
            revokeTeamInvite(team.vaultId, invite.id).then(() => undefined),
          )
        }
      >
        Revoke…
      </Button>
      {error && <Note alert>{error}</Note>}
    </li>
  );
}

function InviteByLink({ team }: { team: TeamInfo }) {
  const [role, setRole] = useState<TeamGrantedRole>('writer');
  const [approval, setApproval] = useState(true);
  const { busy, error, run } = useAction();
  return (
    <form
      className="sharing__form-row"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => showTeamInvite(team.vaultId, role, approval));
      }}
    >
      <Field label="Invite as">
        {(control) => (
          <Select
            {...control}
            value={role}
            onChange={(event) => {
              const next = event.target.value;
              if (isTeamGrantedRole(next)) {
                setRole(next);
              }
            }}
          >
            {roleOptions(grantCap(team))}
          </Select>
        )}
      </Field>
      <label className="sharing__check">
        <input
          type="checkbox"
          checked={approval}
          onChange={(event) => setApproval(event.target.checked)}
        />
        Approve each request
      </label>
      <Button type="submit" disabled={busy}>
        Invite by link…
      </Button>
      {error && <Note alert>{error}</Note>}
    </form>
  );
}

function AddByCard({ team }: { team: TeamInfo }) {
  const [card, setCard] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<TeamGrantedRole>('writer');
  const { busy, error, run } = useAction();
  return (
    <form
      className="sharing__stack"
      onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          if (await addTeamMember(team.vaultId, card, role, name)) {
            setCard('');
            setName('');
          }
        });
      }}
    >
      <Field label="Identity card">
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            value={card}
            spellCheck={false}
            placeholder="nod-id:v1:…"
            onChange={(event) => setCard(event.target.value)}
          />
        )}
      </Field>
      <div className="sharing__form-row">
        <Field label="Their name">
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Role">
          {(control) => (
            <Select
              {...control}
              value={role}
              onChange={(event) => {
                const next = event.target.value;
                if (isTeamGrantedRole(next)) {
                  setRole(next);
                }
              }}
            >
              {roleOptions(grantCap(team))}
            </Select>
          )}
        </Field>
        <Button type="submit" disabled={busy || card.trim() === ''}>
          Add by identity card…
        </Button>
      </div>
      {error && <Note alert>{error}</Note>}
    </form>
  );
}

function RenameTeam({ team }: { team: TeamInfo }) {
  const [name, setName] = useState(team.name);
  const { busy, error, run } = useAction();
  return (
    <form
      className="sharing__form-row"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => renameTeam(team.vaultId, name));
      }}
    >
      <Field label="Team name">
        {(control) => (
          <Input
            {...control}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Button
        type="submit"
        disabled={busy || name.trim() === '' || name.trim() === team.name}
      >
        Rename team
      </Button>
      {error && <Note alert>{error}</Note>}
    </form>
  );
}

function TransferTeam({ team, me }: { team: TeamInfo; me: string }) {
  const others = team.members.filter(
    (member) => member.code !== me && !member.leaving,
  );
  const [picked, setTo] = useState('');
  // The list is live: what the select shows must be what is submitted.
  const to = others.some((member) => member.identity === picked)
    ? picked
    : (others[0]?.identity ?? '');
  const [kept, setKept] = useState<'admin' | 'writer'>('admin');
  const { busy, error, run } = useAction();
  if (others.length === 0) {
    return null;
  }
  return (
    <form
      className="sharing__form-row"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => transferTeam(team.vaultId, to, kept).then(() => undefined));
      }}
    >
      <Field label="New owner">
        {(control) => (
          <Select
            {...control}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          >
            {others.map((member) => (
              <option key={member.identity} value={member.identity}>
                {member.name ? `${member.name} (${member.code})` : member.code}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="You stay as">
        {(control) => (
          <Select
            {...control}
            value={kept}
            onChange={(event) =>
              setKept(event.target.value === 'writer' ? 'writer' : 'admin')
            }
          >
            <option value="admin">admin</option>
            <option value="writer">writer</option>
          </Select>
        )}
      </Field>
      <Button type="submit" disabled={busy || to === ''}>
        Transfer ownership…
      </Button>
      {error && <Note alert>{error}</Note>}
    </form>
  );
}

function TeamActions({ team }: { team: TeamInfo }) {
  const { busy, error, run } = useAction();
  const manager = isManager(team);
  const mustTransfer = team.role === 'owner' && team.members.length > 1;
  return (
    <div className="sharing__actions">
      {manager && (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => run(() => showTeamLink(team.vaultId))}
        >
          Copy team link…
        </Button>
      )}
      {manager && (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            run(() => rotateTeamKey(team.vaultId).then(() => undefined))
          }
        >
          Rotate key…
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || mustTransfer}
        onClick={() => run(() => leaveTeam(team.vaultId).then(() => undefined))}
      >
        Leave team…
      </Button>
      {mustTransfer && (
        <Note>Hand the team to another member before leaving it.</Note>
      )}
      {error && <Note alert>{error}</Note>}
    </div>
  );
}

export function TeamCard({ team, me }: { team: TeamInfo; me: string }) {
  const manager = isManager(team);
  return (
    <section className="sharing-team" aria-label={team.name || unnamedTeam}>
      <header className="sharing-team__head">
        <h4 className="sharing-team__name">{team.name || unnamedTeam}</h4>
        {team.pending ? (
          <Badge variant="warning">Waiting for approval</Badge>
        ) : team.role ? (
          <Badge variant={roleBadge(team.role)}>{team.role}</Badge>
        ) : (
          <Badge variant="neutral">List not read yet</Badge>
        )}
      </header>
      {team.error && <Note alert>{team.error}</Note>}
      {team.pending && (
        <Note>
          Your request to join waits for an owner or admin. You see the team
          once they accept it.
        </Note>
      )}
      {team.members.length > 0 && (
        <ul className="sharing-team__list" aria-label="Members">
          {team.members.map((member) => (
            <MemberRow
              key={member.identity}
              team={team}
              member={member}
              me={me}
            />
          ))}
        </ul>
      )}
      {manager && team.requests.length > 0 && (
        <>
          <h5 className="sharing-team__section-title">Asking to join</h5>
          <ul className="sharing-team__list" aria-label="Join requests">
            {team.requests.map((request) => (
              <RequestRow key={request.id} team={team} request={request} />
            ))}
          </ul>
        </>
      )}
      {manager && team.invites.length > 0 && (
        <>
          <h5 className="sharing-team__section-title">Live invites</h5>
          <ul className="sharing-team__list" aria-label="Live invites">
            {team.invites.map((invite) => (
              <InviteRow key={invite.id} team={team} invite={invite} />
            ))}
          </ul>
        </>
      )}
      {manager && !team.pending && (
        <details className="sharing-team__manage">
          <summary className="sharing-team__summary">Manage team</summary>
          <div className="sharing__stack">
            <InviteByLink team={team} />
            <AddByCard team={team} />
            <RenameTeam key={team.name} team={team} />
            {team.role === 'owner' && <TransferTeam team={team} me={me} />}
          </div>
        </details>
      )}
      <TeamActions team={team} />
    </section>
  );
}
