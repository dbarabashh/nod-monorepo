import type { Role, SharedNoteSummary, TeamInfo } from '@nod/core/sharing';

export function shareOrigin(
  note: Pick<SharedNoteSummary, 'kind' | 'label'>,
): string {
  return note.kind === 'team' ? `In ${note.label}` : `With ${note.label}`;
}

const roleLabels: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  writer: 'Writer',
  reader: 'Reader',
};

// A team's list is fetched and validated in a sync round; until then core
// reports no role and no members, which is not the same as being left out:
// a validated list always holds at least its owner.
export function teamStanding(
  team: Pick<TeamInfo, 'role' | 'pending' | 'members'>,
): string {
  if (team.pending) {
    return 'Waiting for approval';
  }
  if (team.role !== null) {
    return roleLabels[team.role];
  }
  return team.members.length === 0 ? 'Checking…' : 'No access';
}

export function isReaderIn(teams: TeamInfo[], target: string): boolean {
  return teams.some(
    (team) => team.vaultId === target && team.role === 'reader',
  );
}
