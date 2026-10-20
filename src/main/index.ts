import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  net,
  safeStorage,
  session,
  type MessageBoxOptions,
  type OpenDialogOptions,
} from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { modelCatalog } from '../core/models/index.ts';
import { createAppStateStore } from './app-state/store.ts';
import { ignoreClosedOutput } from './closed-output.ts';
import { registerAppStateIpc } from './ipc/app-state.ts';
import { registerAudioAccessIpc } from './ipc/audio-access.ts';
import { broadcastMcp, registerMcpIpc } from './ipc/mcp.ts';
import { loopbackExchange, runStdioBridge } from './mcp/bridge.ts';
import { createMcpSettingsFile } from './mcp/settings-file.ts';
import { createMcpService } from './mcp/service.ts';
import { broadcastModels, registerModelsIpc } from './ipc/models.ts';
import { broadcastRecording, registerRecordingIpc } from './ipc/recording.ts';
import { broadcastSync, registerSyncIpc } from './ipc/sync.ts';
import { createSyncHandlers } from './sync/handlers.ts';
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
import {
  createWidgetDrag,
  openRecordingWidget,
} from './windows/recording-widget.ts';
import { createSyncController } from './sync/controller.ts';
import { createSyncScheduler } from './sync/scheduler.ts';
import { relayBase } from './sync/relay-transport.ts';
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

// Started by a desktop AI assistant as its MCP server: this process only
// relays to the running app and never opens the meetings itself.
const mcpBridge = process.argv.includes('--mcp-stdio');
// The bridge learns the port from the assistant's settings; the app takes an
// override only in development, where a second copy may run beside it.
const mcpPort =
  (mcpBridge || !app.isPackaged ? portFrom(process.env.NOD_MCP_PORT) : null) ??
  47823;

function portFrom(value: string | undefined): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65_535 ? port : null;
}

if (mcpBridge) {
  app.dock?.hide();
  app.disableHardwareAcceleration();
  app.setPath('sessionData', path.join(app.getPath('userData'), 'mcp-bridge'));
  // macOS hands a click on Nod in the Dock or Finder to this running process,
  // which has no windows, so it starts the real app instead.
  app.on('activate', () => {
    spawn(process.execPath, app.isPackaged ? [] : [app.getAppPath()], {
      detached: true,
      stdio: 'ignore',
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.startsWith('NOD_MCP_'),
        ),
      ),
    }).unref();
  });
  void runStdioBridge({
    input: process.stdin,
    output: process.stdout,
    key: process.env.NOD_MCP_KEY ?? '',
    exchange: loopbackExchange(mcpPort),
  }).finally(() => app.exit(0));
} else if (started || !app.requestSingleInstanceLock()) {
  // A second process would load and rewrite the same meetings file, so every
  // launch after the first hands over to the running app.
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
  onWrite: () => syncScheduler.soon(),
});

// Set when the app is built, so a fork can offer its own relay without
// anything in the source naming one. It is offered, never used unasked.
const defaultRelay = offeredRelay(__DEFAULT_RELAY_URL__);

function offeredRelay(url: string): string | null {
  try {
    return url ? relayBase(url).href : null;
  } catch {
    return null;
  }
}

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
  defaultRelay,
});

const syncScheduler = createSyncScheduler({
  refresh: syncController.refresh,
  idleDelayMs: () => 15_000,
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

const mcpService = createMcpService({
  file: createMcpSettingsFile(path.join(app.getPath('userData'), 'mcp.bin'), {
    ...keychain,
    available: () => {
      try {
        requireSecureStorage();
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
  }),
  port: mcpPort,
  version: app.getVersion(),
  stdio: app.isPackaged
    ? {
        command: process.execPath,
        args: ['--mcp-stdio'],
        note:
          process.platform === 'darwin' && !app.isInApplicationsFolder()
            ? 'Move Nod to the Applications folder first: an assistant set up now loses Nod when it moves.'
            : process.platform === 'win32'
              ? 'Nod’s program path changes with each update, so set the assistant up again after Nod updates.'
              : null,
      }
    : {
        command: process.execPath,
        args: [app.getAppPath(), '--mcp-stdio'],
        note: null,
      },
  meetings: () => recorder.meetings(),
  now: Date.now,
  onChange: () => broadcastMcp(mcpService),
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
  if (mcpBridge) {
    return;
  }
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
    onFailure: (meetingId, trouble, message, current) =>
      meetingSession.transcriptionFailed(meetingId, trouble, message, current),
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
    sendLevel: (level) => {
      for (const window of [widget, mainWindow]) {
        if (window && !window.isDestroyed()) {
          window.webContents.send(IpcEvent.onRecordingLevel, level);
        }
      }
    },
    dragWidget: createWidgetDrag(() => widget),
    copyText: (text) => clipboard.writeText(text),
  });
  registerSyncIpc(
    appUrl,
    createSyncHandlers({
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
      confirm: async ({ message, detail, confirmLabel, cancelLabel }) => {
        const options: MessageBoxOptions = {
          type: 'warning',
          message,
          detail,
          buttons: cancelLabel ? [confirmLabel, cancelLabel] : [confirmLabel],
          defaultId: cancelLabel ? 1 : 0,
          cancelId: cancelLabel ? 1 : 0,
        };
        const { response } = mainWindow
          ? await dialog.showMessageBox(mainWindow, options)
          : await dialog.showMessageBox(options);
        return response === 0;
      },
      syncSoon: () => syncScheduler.soon(),
      now: Date.now,
    }),
  );
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
  registerMcpIpc(appUrl, mcpService, clipboard);
  await mcpService.load();
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
