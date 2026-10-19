import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  net,
  safeStorage,
  session,
  type OpenDialogOptions,
} from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { modelCatalog } from '../core/models/index.ts';
import { createAppStateStore } from './app-state/store.ts';
import { ignoreClosedOutput } from './closed-output.ts';
import { registerAppStateIpc } from './ipc/app-state.ts';
import { registerAudioAccessIpc } from './ipc/audio-access.ts';
import { broadcastModels, registerModelsIpc } from './ipc/models.ts';
import { broadcastRecording, registerRecordingIpc } from './ipc/recording.ts';
import { broadcastSync, registerSyncIpc } from './ipc/sync.ts';
import { createRecorder } from './meetings/recorder.ts';
import { createMeetingSession } from './meetings/session.ts';
import { createTranscriber } from './transcription/service.ts';
import { createMeetingStore } from './meetings/store.ts';
import { createModelManager } from './models/manager.ts';
import { open, seal } from '../core/crypto/index.ts';
import { loadDataKey, type KeyWrap } from './security/data-key.ts';
import { linuxPasswordStore } from './security/password-store.ts';
import { createDisplayCaptureGate } from './security/display-capture-gate.ts';
import { secureSession } from './security/session.ts';
import { IpcEvent } from '../shared/ipc.ts';
import { createMainWindow } from './windows/main-window.ts';
import { openRecordingWidget } from './windows/recording-widget.ts';
import { createSyncController } from './sync/controller.ts';
import { createSyncScheduler } from './sync/scheduler.ts';
import { createSyncSettings } from './sync/settings.ts';

ignoreClosedOutput();

// Has to be set before the app is ready; an explicit --password-store wins.
if (
  process.platform === 'linux' &&
  !app.commandLine.hasSwitch('password-store')
) {
  const store = linuxPasswordStore(process.env);
  if (store) {
    app.commandLine.appendSwitch('password-store', store);
  }
}

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
const quitFlushMs = 10_000;

let mainWindow: BrowserWindow | null = null;
let widget: BrowserWindow | null = null;
let quitting = false;
let pauseRecording = () => recorder.pause();

const keychain: KeyWrap = {
  wrap: (plain) => {
    requireSecureStorage();
    return safeStorage.encryptString(plain);
  },
  unwrap: (data) => {
    requireSecureStorage();
    return safeStorage.decryptString(data);
  },
};

const meetingStore = createMeetingStore({
  directory: path.join(app.getPath('userData'), 'meetings'),
  cipher: async (hasStoredMeetings) => {
    const key = await loadDataKey(
      path.join(app.getPath('userData'), 'keys', 'data.key'),
      keychain,
      async () => hasStoredMeetings,
    );
    return {
      encrypt: (plain, context) => seal(key, plain, context),
      decrypt: (data, context) => open(key, data, context),
    };
  },
  legacy: {
    file: path.join(app.getPath('userData'), 'meetings.bin'),
    decrypt: keychain.unwrap,
  },
  onWrite: () => syncScheduler.soon(),
});

const syncController = createSyncController({
  settings: createSyncSettings({
    directory: app.getPath('userData'),
    keychain,
  }),
  store: meetingStore,
  onRemote: (state) => recorder.applyRemote(state),
  fetch: (url, init) => net.fetch(url, init),
  newId: randomUUID,
  now: Date.now,
  onChange: () => broadcastSync(syncController),
});

const syncScheduler = createSyncScheduler({
  refresh: syncController.refresh,
  idleDelayMs: () => {
    const state = syncController.state();
    return state.status === 'joining' ||
      (state.status === 'on' && state.requests.length > 0)
      ? 2_000
      : 15_000;
  },
});

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

// Without a keyring, Linux falls back to a key built into Chromium, which would
// leave meetings readable by anyone who copies the file. Elsewhere safeStorage
// throws by itself when the keychain can't be used.
function requireSecureStorage() {
  if (
    process.platform === 'linux' &&
    safeStorage.getSelectedStorageBackend() === 'basic_text'
  ) {
    throw new Error(
      'Meetings can’t be saved securely because no system keyring is available.',
    );
  }
}

function recording(): boolean {
  return recorder.state().status === 'recording';
}

function syncWidget() {
  if (recording() && !widget) {
    widget = openRecordingWidget(appUrl);
    widget.on('closed', () => {
      widget = null;
      if (recording() && !quitting) {
        showMainWindow();
      }
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
    onFailure: (message, stopped) =>
      meetingSession.transcriptionFailed(message, stopped),
  });
  const meetingSession = createMeetingSession({
    recorder,
    models,
    transcriber,
    now: Date.now,
    captureGraceMs: 1_000,
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
  registerSyncIpc({
    appUrl,
    controller: syncController,
    chooseFolder: async () => {
      const options: OpenDialogOptions = {
        title: 'Choose a folder to sync meetings through',
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    syncSoon: () => syncScheduler.soon(),
  });
  // Sync only starts on top of meetings that were read, so a failed load can
  // never be overwritten by copies from other devices.
  const loaded = await recorder.load().then(
    () => true,
    () => false,
  );
  await syncController.load();
  if (loaded) {
    syncScheduler.start();
  }
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
  void Promise.race([
    pauseRecording(),
    new Promise((resolve) => setTimeout(resolve, quitFlushMs)),
  ])
    .catch(() => undefined)
    .then(() => meetingStore.flush())
    .finally(() => app.exit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
