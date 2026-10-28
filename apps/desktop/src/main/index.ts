import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  net,
  safeStorage,
  session,
  type OpenDialogOptions,
  type WebContents,
} from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { modelCatalog } from '@nod/core/models';
import { createAppStateStore } from './app-state/store.ts';
import { ignoreClosedOutput } from './closed-output.ts';
import { dataFolderName, moveDataFolder } from './storage/data-folder.ts';
import { registerAppStateIpc } from './ipc/app-state.ts';
import { broadcastUpdate, registerUpdatesIpc } from './ipc/updates.ts';
import { updateBase, updateFeed } from './updates/feed.ts';
import {
  electronSquirrel,
  fetchFeedBytes,
  fetchFeedJson,
  platformStage,
} from './updates/electron.ts';
import { releaseKeys } from './updates/manifest.ts';
import { createUpdater } from './updates/updater.ts';
import { registerMeetingSuggestionIpc } from './ipc/meeting-suggestion.ts';
import { registerAudioAccessIpc } from './ipc/audio-access.ts';
import { broadcastMcp, registerMcpIpc } from './ipc/mcp.ts';
import { registerMeetingImportIpc } from './ipc/meeting-import.ts';
import { loopbackExchange, runStdioBridge } from './mcp/bridge.ts';
import { createMcpSettingsFile } from './mcp/settings-file.ts';
import { createMcpService } from './mcp/service.ts';
import { broadcastModels, registerModelsIpc } from './ipc/models.ts';
import { broadcastRecording, registerRecordingIpc } from './ipc/recording.ts';
import { broadcastSync, registerSyncIpc } from './ipc/sync.ts';
import { createSyncHandlers } from './sync/handlers.ts';
import { createDialogGate, type Question } from './sync/dialog-gate.ts';
import { pairingPage } from './sync/pairing-page.ts';
import { listenForPairing, localAddresses } from './sync/pairing-server.ts';
import { showPairingWindow } from './windows/pairing-window.ts';
import { showDialogWindow } from './windows/dialog-window.ts';
import { processAlive, quitWithParent } from './dev/quit-with-parent.ts';
import { createMeetingDetection } from './meeting-detection/service.ts';
import { platformMonitor } from './meeting-detection/monitor.ts';
import type { MicUser } from './meeting-detection/parse.ts';
import { createCapturePage } from './meetings/capture-page.ts';
import { createMeetingImport } from './meetings/import-file.ts';
import { createRecorder } from './meetings/recorder.ts';
import { createArrivedSummaries } from './meetings/arrived-summaries.ts';
import { createMeetingSession } from './meetings/session.ts';
import { createTranscriber } from './transcription/service.ts';
import { createMeetingStore } from './meetings/store.ts';
import { createModelManager } from './models/manager.ts';
import { open, seal } from '@nod/core/crypto';
import { meetingName, type Cipher } from '@nod/core/meetings';
import { loadDataKey, type KeyWrap } from './security/data-key.ts';
import { linuxPasswordStore } from './security/password-store.ts';
import { createDisplayCaptureGate } from './security/display-capture-gate.ts';
import { secureSession } from './security/session.ts';
import { recordingTitle } from '@nod/core/meeting-detection';
import { IpcEvent, type AppState } from '../shared/ipc.ts';
import { createMainWindow } from './windows/main-window.ts';
import {
  createWidgetDrag,
  openRecordingWidget,
} from './windows/recording-widget.ts';
import { openSuggestionWindow } from './windows/meeting-suggestion.ts';
import { createSuggestionWindowControl } from './meeting-detection/suggestion-window.ts';
import { createSyncController } from './sync/controller.ts';
import { createSharingController } from './sharing/controller.ts';
import { createSharingHandlers } from './sharing/handlers.ts';
import { broadcastSharing, registerSharingIpc } from './ipc/sharing.ts';
import { createSyncScheduler } from './sync/scheduler.ts';
import { relayBase, type Fetch } from '@nod/core/sync';
import { createPublishedLogs } from './sync/published-log.ts';
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

// Before anything reads it, and before the single-instance lock, which lives
// there too; an explicit --user-data-dir (a second copy in development) wins.
// Only macOS had the Swift app; elsewhere the folder stays, and on Windows it
// also holds the key safeStorage encrypts with.
const legacyDataFolder =
  process.platform !== 'darwin' || app.commandLine.hasSwitch('user-data-dir')
    ? null
    : path.join(app.getPath('appData'), app.getName());
if (legacyDataFolder) {
  app.setPath('userData', path.join(app.getPath('appData'), dataFolderName));
}
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
} else if (legacyDataFolder) {
  // Synchronous because the stores below open the folder as this module
  // loads; each move is a rename within one folder.
  const move = moveDataFolder(
    legacyDataFolder,
    app.getPath('userData'),
    modelCatalog.map((model) => model.id),
  );
  if (move === 'kept') {
    app.setPath('userData', legacyDataFolder);
  } else if (move === 'stuck') {
    dialog.showErrorBox(
      'Nod could not move its data',
      `Nod was moving its data to ${app.getPath('userData')} and could not finish. Nothing was lost; open Nod again to finish the move.`,
    );
    app.exit(1);
  }
}

const appUrl =
  MAIN_WINDOW_VITE_DEV_SERVER_URL ||
  pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  ).href;

const heartbeatMs = 5_000;
const relayTimeoutMs = 60_000;
const quitFlushMs = 10_000;

let mainWindow: BrowserWindow | null = null;
let widget: BrowserWindow | null = null;
let quitting = false;
let pauseRecording = () => recorder.pause();
let summaryArrived = (_id: string) => {};
let scanForSummaries = () => {};

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

// One key seals everything on this computer: meetings, shares and shared
// notes. It is read once; the meeting store reads it first and decides
// whether a missing key means a first run or a lost one.
let dataKey: Promise<Uint8Array> | null = null;
function dataCipher(hasEncryptedData: () => Promise<boolean>): Promise<Cipher> {
  dataKey ??= loadDataKey(
    path.join(app.getPath('userData'), 'keys', 'data.key'),
    keychain,
    hasEncryptedData,
  ).catch((failure: unknown) => {
    dataKey = null;
    throw failure;
  });
  return dataKey.then((key) => ({
    encrypt: (plain, context) => seal(key, plain, context),
    decrypt: (data, context) => open(key, data, context),
  }));
}

const meetingStore = createMeetingStore({
  directory: path.join(app.getPath('userData'), 'meetings'),
  cipher: (hasStoredMeetings) => dataCipher(async () => hasStoredMeetings),
  onWrite: () => syncScheduler.soon(),
});

const publishedLogs = createPublishedLogs(
  path.join(app.getPath('userData'), 'published'),
);

// Set when the app is built, so a fork can offer its own relay without
// anything in the source naming one. It is offered, never used unasked.
const defaultRelay = offeredRelay(__DEFAULT_RELAY_URL__);

// Set when the app is built, like the relay: a fork publishes its own releases
// and signs them with its own key.
const updateSource =
  app.isPackaged && releaseKeys(__UPDATE_PUBLIC_KEY__) !== null
    ? updateBase(__UPDATE_URL__)
    : null;
const updateFeedOf = updateSource ? updateFeed(updateSource) : null;

function offeredRelay(url: string): string | null {
  try {
    return url ? relayBase(url).href : null;
  } catch {
    return null;
  }
}

// A request that never ends would hold sync busy until a restart. Relays,
// including ones named by a link, get no cookies or HTTP credentials from
// the app's session and can't store any in it, so none can track this
// device across requests or hosts.
const relayFetch: Fetch = (url, init) =>
  net.fetch(url, {
    ...init,
    credentials: 'omit',
    signal: AbortSignal.timeout(relayTimeoutMs),
  });

const sharingOptions = {
  directory: path.join(app.getPath('userData'), 'sharing'),
  cipher: () => dataCipher(async () => true),
  publishedLogs,
  fetch: relayFetch,
  newId: randomUUID,
  now: Date.now,
};

const sharingController = createSharingController({
  ...sharingOptions,
  onChange: () => broadcastSharing(sharingController),
});

const syncController = createSyncController({
  sharing: sharingController,
  endingSharing: () =>
    createSharingController({ ...sharingOptions, onChange: () => {} }),
  settings: createSyncSettings({
    directory: app.getPath('userData'),
    keychain,
  }),
  publishedLogs,
  store: meetingStore,
  onRemote: (state) => {
    recorder.applyRemote(state);
    if (state.kind === 'meeting') {
      summaryArrived(state.id);
    }
  },
  fetch: relayFetch,
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
    if (recording() !== wasRecording) {
      wasRecording = recording();
      meetingDetection.refresh();
    }
  },
});
let wasRecording = false;

const suggestionWindow = createSuggestionWindowControl({
  open: () => openSuggestionWindow(appUrl),
  capturing: (page) => capturePage.is(page),
  onGone: () => meetingDetection.dismiss(),
});

const capturePage = createCapturePage<WebContents>({
  watch: (page, onEnd) => {
    page.on('did-start-loading', onEnd);
    page.on('render-process-gone', onEnd);
    page.on('destroyed', onEnd);
    return () => {
      page.removeListener('did-start-loading', onEnd);
      page.removeListener('render-process-gone', onEnd);
      page.removeListener('destroyed', onEnd);
    };
  },
  recording,
  pause: () => void pauseRecording().catch(() => undefined),
  onChange: () => suggestionWindow.captureChanged(),
});

// Electron records from a helper process of its own, which the system
// reports like any other app.
function selfFilter(): (user: MicUser) => boolean {
  const pids = new Set(app.getAppMetrics().map((metric) => metric.pid));
  const executable = process.execPath.replaceAll('\\', '#').toLowerCase();
  return (user) =>
    user.pid !== null
      ? pids.has(user.pid)
      : process.platform === 'win32' && user.id.toLowerCase() === executable;
}

const meetingDetection = createMeetingDetection({
  monitor: platformMonitor(
    app.isPackaged
      ? path.join(process.resourcesPath, 'nod-mic-monitor')
      : path.join(app.getAppPath(), 'build', 'native', 'nod-mic-monitor'),
  ),
  now: Date.now,
  selfFilter,
  recording,
  show: (meeting) =>
    suggestionWindow.show({
      appName: meeting.name,
      title: recordingTitle(meeting),
    }),
  hide: () => suggestionWindow.hide(),
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
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function choosePath(options: OpenDialogOptions): Promise<string | null> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

app.whenReady().then(async () => {
  if (mcpBridge) {
    return;
  }
  const launcher = Number(process.env.NOD_DEV_LAUNCHER);
  if (!app.isPackaged && Number.isInteger(launcher) && launcher > 0) {
    quitWithParent({
      parent: launcher,
      isAlive: processAlive,
      every: (callback) => {
        const timer = setInterval(callback, 1_000);
        return () => clearInterval(timer);
      },
      quit: () => app.quit(),
    });
  }
  const displayCapture = createDisplayCaptureGate(Date.now, 5000);
  secureSession(session.defaultSession, appUrl, displayCapture);
  registerAudioAccessIpc(appUrl, displayCapture);
  const applySuggestionSettings = (state: AppState) =>
    meetingDetection.setSettings({
      enabled: state.suggestMeetings,
      quiet: state.quietMeetingApps,
    });
  const appState = createAppStateStore(
    path.join(app.getPath('userData'), 'app-state.json'),
    applySuggestionSettings,
  );
  registerAppStateIpc(appUrl, appState);
  const updater = createUpdater({
    current: app.getVersion(),
    feed: updateFeedOf,
    releaseKeys: __UPDATE_PUBLIC_KEY__,
    unavailable:
      process.platform === 'darwin' && !app.isInApplicationsFolder()
        ? 'Move Nod to the Applications folder to get updates.'
        : null,
    squirrel: electronSquirrel(process.platform),
    stage: updateFeedOf
      ? platformStage({
          platform: process.platform,
          productName: app.getName(),
          arch: process.arch,
          feed: updateFeedOf,
          directory: path.join(app.getPath('userData'), 'updates'),
        })
      : null,
    fetchBytes: fetchFeedBytes,
    fetchJson: fetchFeedJson,
    channel: async () =>
      (await appState.read()).testUpdates ? 'test' : 'stable',
    automatic: async () => (await appState.read()).checkForUpdates,
    recording,
    now: Date.now,
    every: (ms, run) => {
      const timer = setInterval(run, ms);
      return () => clearInterval(timer);
    },
    later: (ms, run) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    onChange: broadcastUpdate,
  });
  registerUpdatesIpc(appUrl, updater);
  registerMeetingSuggestionIpc(appUrl, {
    owns: suggestionWindow.owns,
    current: suggestionWindow.current,
    dismiss: async (quietApp) => {
      const app = meetingDetection.showing();
      meetingDetection.dismiss();
      suggestionWindow.hide();
      if (quietApp && app) {
        await appState.update((state) => ({
          quietMeetingApps: [...state.quietMeetingApps, app.key],
        }));
      }
    },
  });
  void appState.read().then(applySuggestionSettings);
  const modelsChanged = broadcastModels();
  const models = createModelManager({
    catalog: modelCatalog,
    directory: path.join(app.getPath('userData'), 'models'),
    fetch: (url, init) => net.fetch(url, init),
    onChange: (installed) => {
      modelsChanged(installed);
      scanForSummaries();
    },
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
    onCaptureFinished: () => capturePage.release(),
  });
  pauseRecording = meetingSession.pause;
  const arrivedSummaries = createArrivedSummaries({
    meeting: recorder.transcriptOf,
    summarize: meetingSession.summarize,
    recording: () => recorder.state().status === 'recording',
    now: Date.now,
    later: (ms, run) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  summaryArrived = arrivedSummaries.arrived;
  scanForSummaries = () =>
    arrivedSummaries.scan(recorder.meetings().map((meeting) => meeting.id));
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
    capture: capturePage,
  });
  registerMeetingImportIpc(
    appUrl,
    createMeetingImport({
      recorder,
      chooseFile: () =>
        choosePath({
          title: 'Choose a meetings export to import',
          properties: ['openFile'],
          filters: [{ name: 'Meetings export', extensions: ['json'] }],
        }),
    }),
  );
  const confirmInMain = (question: Question) =>
    showDialogWindow(question, mainWindow, (open) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcEvent.onDialogChanged, open);
      }
    });
  const dialogGate = createDialogGate({
    confirm: confirmInMain,
    now: Date.now,
  });
  registerSharingIpc(
    appUrl,
    createSharingHandlers({
      controller: sharingController,
      place: () => syncController.sharedPlace(),
      syncRelay: () => {
        const state = syncController.state();
        return state.status === 'ready' &&
          !state.closed &&
          state.transport?.kind === 'relay'
          ? state.transport.url
          : null;
      },
      meeting: (id) => recorder.meetings().find((entry) => entry.id === id),
      meetingName,
      recordShare: (id, copy) => recorder.recordShare(id, copy),
      gate: dialogGate,
      copyText: (text) => clipboard.writeText(text),
      syncSoon: () => syncScheduler.soon(),
      now: Date.now,
    }),
  );
  registerSyncIpc(
    appUrl,
    createSyncHandlers({
      controller: syncController,
      chooseFolder: () =>
        choosePath({
          title: 'Choose a folder to sync meetings through',
          properties: ['openDirectory', 'createDirectory'],
        }),
      showPairing: (screen, done) =>
        showPairingWindow(
          pairingPage(screen, process.platform),
          mainWindow,
          done,
        ),
      listenForPairing: ({ sealed, proofFor, confirm }) =>
        listenForPairing({
          offer: sealed,
          proofFor,
          confirm,
          hosts: localAddresses(),
        }),
      syncSoon: () => syncScheduler.soon(),
      gate: dialogGate,
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
    scanForSummaries();
    syncScheduler.start();
  }
  registerMcpIpc(appUrl, mcpService, clipboard);
  await mcpService.load();
  app.on('second-instance', showMainWindow);
  showMainWindow();
  updater.start();

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
