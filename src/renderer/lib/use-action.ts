import { useState } from 'react';

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    action()
      .catch((failure: unknown) =>
        setError(
          failure instanceof Error
            ? failure.message.replace(
                /^Error invoking remote method '[^']+': (Error: )?/,
                '',
              )
            : 'Something went wrong',
        ),
      )
      .finally(() => setBusy(false));
  };
  return { busy, error, run };
}
