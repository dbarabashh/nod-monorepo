import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { windowIcon } from '../app-icon.ts';
import { secureWindow } from '../security/window.ts';

export function createMainWindow(options: {
  appUrl: string;
  keepAlive: () => boolean;
  onReload: () => void;
}): BrowserWindow {
  const { appUrl, keepAlive, onReload } = options;
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Recording runs in this page; it keeps capturing while hidden.
      backgroundThrottling: false,
    },
  });

  secureWindow(window.webContents, appUrl);
  window.on('close', (event) => {
    if (keepAlive()) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.on('did-start-loading', onReload);
  window.webContents.on('render-process-gone', onReload);
  void window.loadURL(appUrl);

  if (!app.isPackaged) {
    window.webContents.openDevTools();
  }
  return window;
}
