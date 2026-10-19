import {
  app,
  BrowserWindow,
  clipboard,
  net,
  safeStorage,
  session,
} from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { modelCatalog } from '../core/models/index.ts';
import { createAppStateStore } from './app-state/store.ts';
import { registerAppStateIpc } from './ipc/app-state.ts';
import { registerAudioAccessIpc } from './ipc/audio-access.ts';
import { broadcastModels, registerModelsIpc } from './ipc/models.ts';
import { broadcastRecording, registerRecordingIpc } from './ipc/recording.ts';
import { createRecorder } from './meetings/recorder.ts';
import { createMeetingSession } from './meetings/session.ts';
import { createTranscriber } from './transcription/service.ts';
import { createMeetingStore } from './meetings/store.ts';
import { createModelManager } from './models/manager.ts';
import { createDisplayCaptureGate } from './security/display-capture-gate.ts';
import { secureSession } from './security/session.ts';
import { IpcEvent } from '../shared/ipc.ts';
import { createMainWindow } from './windows/main-window.ts';
import { openRecordingWidget } from './windows/recording-widget.ts';

// A second process would load and rewrite the same meetings file, so every
// launch after the first hands over to the running app.
if (started || !app.requestSingleInstanceLock()) {
  app.quit();
}

const appUrl =
  MAIN_WINDOW_VITE_DEV_SERVER_URL ||
  pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  ).href;

const heartbeatMs = 5_000;

let mainWindow: BrowserWindow | null = null;
let widget: BrowserWindow | null = null;
let quitting = false;
let pauseRecording = () => recorder.pause();

const meetingStore = createMeetingStore(
  path.join(app.getPath('userData'), 'meetings.bin'),
  {
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  },
);

const recorder = createRecorder({
  store: meetingStore,
  now: Date.now,
  newId: randomUUID,
  every: (callback) => {
    const timer = setInterval(callback, heartbeatMs);
    return () => clearInterval(timer);
  },
  onChange: () => {
    broadcastRecording(recorder);
    syncWidget();
  },
});

function recording(): boolean {
  return recorder.state().status === 'recording';
}

function syncWidget() {
  if (recording() && !widget) {
    widget = openRecordingWidget(appUrl);
    widget.on('closed', () => {
      widget = null;
    });
  } else if (!recording() && widget) {
    widget.destroy();
    if (mainWindow && !mainWindow.isVisible()) {
      showMainWindow();
    }
  }
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = createMainWindow({
    appUrl,
    keepAlive: () => recording() && !quitting,
    onReload: () => void pauseRecording(),
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
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
  const transcriber = createTranscriber({
    workerPath: path.join(__dirname, 'transcriber.cjs'),
    onLines: (meetingId, lines) => {
      recorder.appendLines(meetingId, lines).catch(() => undefined);
    },
  });
  const meetingSession = createMeetingSession({
    recorder,
    models,
    transcriber,
  });
  pauseRecording = meetingSession.pause;
  registerRecordingIpc({
    appUrl,
    recorder,
    session: meetingSession,
    transcriber,
    showMainWindow,
    sendLevel: (level) =>
      widget?.webContents.send(IpcEvent.onRecordingLevel, level),
    copyText: (text) => clipboard.writeText(text),
  });
  await recorder.load().catch(() => undefined);
  app.on('second-instance', showMainWindow);
  showMainWindow();

  app.on('activate', showMainWindow);
});

app.on('before-quit', (event) => {
  if (quitting) {
    return;
  }
  event.preventDefault();
  quitting = true;
  // Everything is on disk by then; exit() avoids a second quit request,
  // which Electron ignores after a quit started by a signal was cancelled.
  void pauseRecording()
    .catch(() => undefined)
    .then(() => meetingStore.flush())
    .finally(() => app.exit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
