import {
  rankOf,
  type SharingState,
  type ShareTargetKind,
  type TeamInfo,
} from '../../shared/ipc.ts';

// What a meeting's menu needs to offer "Share with…": the people and teams
// to pick from and the call that shares, handed down by the app shell so
// the meetings feature never imports sharing.
export type ShareTarget = {
  target: string;
  kind: ShareTargetKind;
  // A person's code, or a team's name.
  name: string;
  // What a list of targets shows: a team is always marked as one, so a team
  // named like an identity code can't pass for a person.
  label: string;
};

export type ShareTargets = {
  // Where a meeting can be shared now.
  targets: ShareTarget[];
  // Everyone and every team this person shares with, readers included, to
  // name where a meeting's copies went.
  known: ShareTarget[];
  share: (meetingId: string, target: string) => Promise<void>;
};

const unnamedTeam = 'Unnamed team';

// An owner or admin manages the team's members and invites.
export function isManager(team: TeamInfo): boolean {
  return team.role !== null && rankOf(team.role) >= rankOf('admin');
}

// Readers hold the key but can't write, and a request still waiting has
// no key at all.
export function canWriteIn(team: TeamInfo): boolean {
  return (
    !team.pending && team.role !== null && rankOf(team.role) >= rankOf('writer')
  );
}

function teamTarget(team: TeamInfo): ShareTarget {
  const name = team.name === '' ? unnamedTeam : team.name;
  return {
    target: team.vaultId,
    kind: 'team',
    name,
    label: `Team “${name}”`,
  };
}

export function shareTargetsOf(
  sharing: Extract<SharingState, { status: 'ready' }>,
): Pick<ShareTargets, 'targets' | 'known'> {
  const people: ShareTarget[] = sharing.peers
    .filter((peer) => peer.stoppedAt === null)
    .map((peer) => ({
      target: peer.identity,
      kind: 'person',
      name: peer.code,
      label: peer.code,
    }));
  return {
    targets: [...people, ...sharing.teams.filter(canWriteIn).map(teamTarget)],
    known: [
      ...people,
      ...sharing.teams.filter((team) => !team.pending).map(teamTarget),
    ],
  };
}
