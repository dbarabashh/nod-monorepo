import type {
  SharedNoteDetail,
  SharingState,
  TeamInfo,
} from '../../../../shared/ipc.ts';
import { displayName } from '../../../lib/display-name.ts';

function cleanName(name: string | null): string | null {
  const shown = name === null ? '' : displayName(name);
  return shown === '' ? null : shown;
}

function cleanTeam(team: TeamInfo): TeamInfo {
  return {
    ...team,
    name: displayName(team.name),
    error: team.error === null ? null : displayName(team.error),
    members: team.members.map((member) => ({
      ...member,
      name: cleanName(member.name),
    })),
    requests: team.requests.map((request) => ({
      ...request,
      name: cleanName(request.name),
    })),
  };
}

// Everything named by another person, as the views show it: the team, its
// members and the people asking to join, the notes they shared, and the
// errors that quote a team's name.
export function cleanSharingState(state: SharingState): SharingState {
  if (state.status !== 'ready') {
    return state;
  }
  return {
    ...state,
    error: state.error === null ? null : displayName(state.error),
    teams: state.teams.map(cleanTeam),
    notes: state.notes.map((note) => ({
      ...note,
      title: displayName(note.title),
      label: displayName(note.label),
    })),
  };
}

export function cleanSharedNote(note: SharedNoteDetail): SharedNoteDetail {
  return { ...note, title: displayName(note.title) };
}
