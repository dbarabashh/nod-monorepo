import { useEffect, useState } from 'react';

export type CopyStatus = 'idle' | 'copied' | 'failed';

const shownMs = 2_000;

export function useCopyStatus(copy: () => Promise<void>) {
  const [status, setStatus] = useState<CopyStatus>('idle');

  useEffect(() => {
    if (status === 'idle') {
      return;
    }
    const timer = setTimeout(() => setStatus('idle'), shownMs);
    return () => clearTimeout(timer);
  }, [status]);

  return {
    status,
    copy: () =>
      void copy().then(
        () => setStatus('copied'),
        () => setStatus('failed'),
      ),
  };
}
