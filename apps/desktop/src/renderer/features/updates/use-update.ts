import { useAsync } from '../../lib/use-async.ts';
import { getUpdateState, onUpdateChanged } from './api.ts';

export function useUpdate() {
  return useAsync(getUpdateState, onUpdateChanged);
}
