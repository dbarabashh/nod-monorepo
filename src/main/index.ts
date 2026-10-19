import { app, BrowserWindow, net, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { windowIcon } from './app-icon.ts';
import { createAppStateStore } from './app-state/store.ts';
import { registerAppStateIpc } from './ipc/app-state.ts';
import { registerAudioAccessIpc } from './ipc/audio-access.ts';
import { broadcastModels, registerModelsIpc } from './ipc/models.ts';
import { modelCatalog } from '../core/models/index.ts';
import { createModelManager } from './models/manager.ts';
import { createDisplayCaptureGate } from './security/display-capture-gate.ts';
import { secureSession } from './security/session.ts';
import { secureWindow } from './security/window.ts';

if (started) {
  app.quit();
}

const appUrl =
  MAIN_WINDOW_VITE_DEV_SERVER_URL ||
  pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  ).href;

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  secureWindow(mainWindow.webContents, appUrl);
  mainWindow.loadURL(appUrl);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

app.whenReady().then(() => {
  const displayCapture = createDisplayCaptureGate(Date.now, 5000);
  secureSession(session.defaultSession, appUrl, displayCapture);
  registerAudioAccessIpc(appUrl, displayCapture);
  registerAppStateIpc(
    appUrl,
    createAppStateStore(path.join(app.getPath('userData'), 'app-state.json')),
  );
  const models = createModelManager({
    catalog: modelCatalog,
    directory: path.join(app.getPath('userData'), 'models'),
    fetch: (url, init) => net.fetch(url, init),
    onChange: broadcastModels(),
  });
  registerModelsIpc(appUrl, models);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
