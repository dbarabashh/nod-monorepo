import {
  BrowserWindow,
  nativeTheme,
  session,
  type BrowserWindowConstructorOptions,
} from 'electron';
import { windowIcon } from '../app-icon.ts';
import { surfaceColor } from './page-style.ts';

// A window for a page main writes itself: no preload, no JavaScript, a
// session of its own kept in memory, and the page served under an opaque
// address, since a data: URL would put its text in the document URL, which
// accessibility tools can read. Nothing opens from it, and every navigation
// is stopped; a page that answers through one is handed the address.
export function openPage(options: {
  partition: string;
  scheme: string;
  html: string;
  window: Omit<BrowserWindowConstructorOptions, 'webPreferences'>;
  // Keeps the window out of screenshots, recordings and a shared screen on
  // macOS and Windows; Linux has no such protection.
  protect: boolean;
  onNavigate?: (url: string) => void;
}): { window: BrowserWindow; closed: Promise<void> } {
  const { partition, scheme, html, onNavigate } = options;
  const own = session.fromPartition(partition);
  own.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  own.setPermissionCheckHandler(() => false);
  if (own.protocol.isProtocolHandled(scheme)) {
    own.protocol.unhandle(scheme);
  }
  own.protocol.handle(
    scheme,
    () =>
      new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  );
  const window = new BrowserWindow({
    icon: windowIcon(),
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: surfaceColor(nativeTheme.shouldUseDarkColors),
    ...options.window,
    webPreferences: {
      session: own,
      javascript: false,
      sandbox: true,
      spellcheck: false,
      devTools: false,
    },
  });
  window.setContentProtection(options.protect);
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    onNavigate?.(url);
  });
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  // A page that never shows would hold its caller forever.
  window.webContents.once('did-fail-load', () => window.close());
  const closed = new Promise<void>((resolve) => {
    window.once('closed', () => {
      own.protocol.unhandle(scheme);
      void own.clearCache();
      resolve();
    });
  });
  void window.loadURL(`${scheme}://page/`);
  return { window, closed };
}
