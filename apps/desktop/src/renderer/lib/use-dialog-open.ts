import { useEffect } from 'react';

export function useDialogOpen(): void {
  useEffect(
    () =>
      window.api.onDialogChanged((open) => {
        if (open) {
          document.documentElement.dataset.dialog = 'open';
        } else {
          delete document.documentElement.dataset.dialog;
        }
      }),
    [],
  );
}
