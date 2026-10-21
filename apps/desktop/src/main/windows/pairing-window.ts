import { BrowserWindow, nativeTheme, session } from 'electron';
import { windowIcon } from '../app-icon.ts';

const openForMs = 3 * 60_000;
const scheme = 'nod-pairing';

// The code holds the one-time secret that unlocks the vault key, so it is
// drawn here rather than in the app page, which is untrusted. The window has
// no preload and no JavaScript, and runs in a session of its own kept in
// memory. Its page is served under an opaque address: a data: URL would put
// the code in the document URL, which accessibility tools can read.
export function showPairingWindow(
  html: string,
  parent: BrowserWindow | null,
  done: Promise<unknown>,
): Promise<void> {
  const pairing = session.fromPartition('nod-pairing');
  pairing.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  pairing.setPermissionCheckHandler(() => false);
  if (pairing.protocol.isProtocolHandled(scheme)) {
    pairing.protocol.unhandle(scheme);
  }
  pairing.protocol.handle(
    scheme,
    () =>
      new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  );
  const window = new BrowserWindow({
    width: 420,
    height: 600,
    title: 'Pair a phone',
    icon: windowIcon(),
    parent: parent ?? undefined,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    // --color-surface
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181c' : '#ffffff',
    webPreferences: {
      session: pairing,
      javascript: false,
      sandbox: true,
      spellcheck: false,
      devTools: false,
    },
  });
  // macOS and Windows: keeps the code out of screenshots, recordings and a
  // shared screen. Linux has no such protection.
  window.setContentProtection(true);
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  const timer = setTimeout(() => window.close(), openForMs);
  void done.then(() => {
    if (!window.isDestroyed()) {
      window.close();
    }
  });
  const closed = new Promise<void>((resolve) => {
    window.once('closed', () => {
      clearTimeout(timer);
      pairing.protocol.unhandle(scheme);
      void pairing.clearCache();
      resolve();
    });
  });
  void window.loadURL(`${scheme}://code/`);
  return closed;
}
