import type {
  SharedNoteDetail,
  SharedNoteInfo,
  SharingState,
} from '../../../shared/ipc.ts';

export function getSharingState(): Promise<SharingState> {
  return window.api.getSharingState();
}

export function onSharingChanged(
  callback: (state: SharingState) => void,
): () => void {
  return window.api.onSharingChanged(callback);
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
  peer: string,
): Promise<SharedNoteInfo> {
  return window.api.shareMeeting(meetingId, peer);
}

export function getSharedNote(
  peer: string,
  id: string,
): Promise<SharedNoteDetail> {
  return window.api.getSharedNote(peer, id);
}

export function editSharedNote(
  peer: string,
  id: string,
  summary: string,
): Promise<void> {
  return window.api.editSharedNote(peer, id, summary);
}

export function deleteSharedNote(peer: string, id: string): Promise<void> {
  return window.api.deleteSharedNote(peer, id);
}
