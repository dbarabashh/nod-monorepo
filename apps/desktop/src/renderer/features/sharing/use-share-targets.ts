import { useMemo } from 'react';
import { shareTargetsOf, type ShareTargets } from '../../lib/share-targets.ts';
import { useAsync } from '../../lib/use-async.ts';
import { getSharingState, onSharingChanged, shareMeeting } from './api.ts';

async function share(meetingId: string, target: string): Promise<void> {
  await shareMeeting(meetingId, target);
}

export function useShareTargets(): ShareTargets | null {
  const { state } = useAsync(getSharingState, onSharingChanged);
  const sharing =
    state.status === 'ready' && state.value.status === 'ready'
      ? state.value
      : null;
  return useMemo(() => {
    if (!sharing) {
      return null;
    }
    const { targets, known } = shareTargetsOf(sharing);
    return known.length === 0 ? null : { targets, known, share };
  }, [sharing]);
}
