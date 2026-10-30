import type {
  JoinOutcome,
  SharedNoteDetail,
  SharedNoteInfo,
  SharingState,
  SyncState,
  TeamGrantedRole,
} from '../../../shared/ipc.ts';
import { cleanSharedNote, cleanSharingState } from './lib/clean-state.ts';

export async function getSharingState(): Promise<SharingState> {
  return cleanSharingState(await window.api.getSharingState());
}

export function onSharingChanged(
  callback: (state: SharingState) => void,
): () => void {
  return window.api.onSharingChanged((state) =>
    callback(cleanSharingState(state)),
  );
}

export function getSyncState(): Promise<SyncState> {
  return window.api.getSyncState();
}

export function onSyncChanged(
  callback: (state: SyncState) => void,
): () => void {
  return window.api.onSyncChanged(callback);
}

export function showIdentityCard(): Promise<void> {
  return window.api.showIdentityCard();
}

export function addSharingPeer(card: string): Promise<boolean> {
  return window.api.addSharingPeer(card);
}

export function stopSharingPeer(identity: string): Promise<void> {
  return window.api.stopSharingPeer(identity);
}

export function shareMeeting(
  meetingId: string,
  target: string,
): Promise<SharedNoteInfo> {
  return window.api.shareMeeting(meetingId, target);
}

export function getSharedNote(
  target: string,
  id: string,
): Promise<SharedNoteDetail> {
  return window.api.getSharedNote(target, id).then(cleanSharedNote);
}

export function editSharedNote(
  target: string,
  id: string,
  summary: string,
  version: string,
): Promise<string> {
  return window.api.editSharedNote(target, id, summary, version);
}

export function deleteSharedNote(target: string, id: string): Promise<void> {
  return window.api.deleteSharedNote(target, id);
}

export function createTeam(
  name: string,
  myName: string,
  relay: string | null,
): Promise<string | null> {
  return window.api.createTeam(name, myName, relay);
}

export function joinTeam(
  link: string,
  myName: string,
): Promise<JoinOutcome | null> {
  return window.api.joinTeam(link, myName);
}

export function addKnownTeam(link: string): Promise<string | null> {
  return window.api.addKnownTeam(link);
}

export function showTeamInvite(
  vaultId: string,
  role: TeamGrantedRole,
  approval: boolean,
): Promise<void> {
  return window.api.showTeamInvite(vaultId, role, approval);
}

export function revokeTeamInvite(
  vaultId: string,
  inviteId: string,
): Promise<boolean> {
  return window.api.revokeTeamInvite(vaultId, inviteId);
}

export function answerTeamRequest(
  vaultId: string,
  requestId: string,
  accept: boolean,
  role: TeamGrantedRole,
): Promise<boolean> {
  return window.api.answerTeamRequest(vaultId, requestId, accept, role);
}

export function addTeamMember(
  vaultId: string,
  card: string,
  role: TeamGrantedRole,
  name: string,
): Promise<boolean> {
  return window.api.addTeamMember(vaultId, card, role, name);
}

export function setTeamMemberRole(
  vaultId: string,
  identity: string,
  role: TeamGrantedRole,
): Promise<boolean> {
  return window.api.setTeamMemberRole(vaultId, identity, role);
}

export function removeTeamMember(
  vaultId: string,
  identity: string,
): Promise<boolean> {
  return window.api.removeTeamMember(vaultId, identity);
}

export function leaveTeam(vaultId: string): Promise<boolean> {
  return window.api.leaveTeam(vaultId);
}

export function transferTeam(
  vaultId: string,
  identity: string,
  role: 'admin' | 'writer',
): Promise<boolean> {
  return window.api.transferTeam(vaultId, identity, role);
}

export function rotateTeamKey(vaultId: string): Promise<boolean> {
  return window.api.rotateTeamKey(vaultId);
}

export function showTeamLink(vaultId: string): Promise<void> {
  return window.api.showTeamLink(vaultId);
}

export function renameTeam(vaultId: string, name: string): Promise<void> {
  return window.api.renameTeam(vaultId, name);
}

export function nameTeamMember(
  vaultId: string,
  identity: string,
  name: string,
): Promise<void> {
  return window.api.nameTeamMember(vaultId, identity, name);
}
