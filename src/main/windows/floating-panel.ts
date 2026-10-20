import { BrowserWindow } from 'electron';
import path from 'node:path';
import { secureWindow } from '../security/window.ts';

// A small always-on-top window over other apps, shown without taking focus:
// the recording widget and the meeting suggestion.
export function openFloatingPanel(
  appUrl: string,
  options: {
    hash: string;
    width: number;
    height: number;
    x: number;
    y: number;
    // Matches the page's own background, so the window never flashes
    // another colour.
    backgroundColor: string;
  },
): BrowserWindow {
  const { hash, ...bounds } = options;
  const window = new BrowserWindow({
    ...bounds,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: true,
    // macOS: the panel never becomes the key window, so without this the
    // press that should start a drag or hit a button only focuses it.
    acceptFirstMouse: true,
    // macOS: a panel floats over full-screen apps without stealing focus.
    // Windows: a toolbar window stays out of Alt+Tab.
    type:
      process.platform === 'darwin'
        ? 'panel'
        : process.platform === 'win32'
          ? 'toolbar'
          : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
    },
  });
  window.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
  secureWindow(window.webContents, appUrl);
  window.once('ready-to-show', () => window.showInactive());
  void window.loadURL(`${appUrl}#${hash}`);
  return window;
}
