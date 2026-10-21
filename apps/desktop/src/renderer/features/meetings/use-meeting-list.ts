import { useMemo } from 'react';
import { useAsync } from '../../lib/use-async.ts';
import { listMeetings, onMeetingsChanged } from './api.ts';
import { folderCounts } from './lib/folders.ts';

export type MeetingList = ReturnType<typeof useMeetingList>;

export function useMeetingList() {
  const { state, retry } = useAsync(listMeetings, onMeetingsChanged);
  const folders = useMemo(
    () =>
      state.status === 'ready'
        ? folderCounts(state.value, navigator.language)
        : [],
    [state],
  );
  return { state, retry, folders };
}
