import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: T };

export function useAsync<T>(
  load: () => Promise<T>,
  subscribe?: (show: (value: T) => void) => () => void,
) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const show = (value: T) => active && setState({ status: 'ready', value });
    const unsubscribe = subscribe?.(show);
    load().then(show, () => active && setState({ status: 'error' }));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [load, subscribe, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  const refresh = useCallback(() => setAttempt((count) => count + 1), []);

  const track = useCallback((next: Promise<unknown>) => {
    next.catch(() => setState({ status: 'error' }));
  }, []);

  return { state, setState, retry, refresh, track };
}
