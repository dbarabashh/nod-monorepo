import type { Event, WebContents } from 'electron';
import { isAppUrl } from './navigation.ts';

export function secureWindow(webContents: WebContents, appUrl: string): void {
  const blockForeign = (event: Event<{ url: string }>) => {
    if (!isAppUrl(event.url, appUrl)) {
      event.preventDefault();
    }
  };
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', blockForeign);
  webContents.on('will-redirect', blockForeign);
}
