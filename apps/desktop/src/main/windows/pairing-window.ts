import type { BrowserWindow } from 'electron';
import { openPage } from './page-window.ts';

const openForMs = 3 * 60_000;

// The code holds the one-time secret that unlocks the vault key, so it is
// drawn here rather than in the app page, which is untrusted.
export function showPairingWindow(
  html: string,
  parent: BrowserWindow | null,
  done: Promise<unknown>,
): Promise<void> {
  const { window, closed } = openPage({
    partition: 'nod-pairing',
    scheme: 'nod-pairing',
    html,
    protect: true,
    window: {
      width: 420,
      height: 600,
      title: 'Pair a phone',
      parent: parent ?? undefined,
    },
  });
  const timer = setTimeout(() => window.close(), openForMs);
  void done.then(() => {
    if (!window.isDestroyed()) {
      window.close();
    }
  });
  return closed.then(() => clearTimeout(timer));
}
