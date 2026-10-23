import type { ShareTargets } from '../../lib/share-targets.ts';
import { useAsync } from '../../lib/use-async.ts';
import { getSharingState, onSharingChanged, shareMeeting } from './api.ts';

async function share(meetingId: string, peer: string): Promise<void> {
  await shareMeeting(meetingId, peer);
}

export function useShareTargets(): ShareTargets | null {
  const { state } = useAsync(getSharingState, onSharingChanged);
  if (state.status !== 'ready' || state.value.status !== 'ready') {
    return null;
  }
  const peers = state.value.peers
    .filter((peer) => peer.stoppedAt === null)
    .map((peer) => ({ identity: peer.identity, code: peer.code }));
  return peers.length === 0 ? null : { peers, share };
}
