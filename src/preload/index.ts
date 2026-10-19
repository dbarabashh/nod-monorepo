import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, IpcEvent, type AppApi } from '../shared/ipc.ts';

function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

// The vault key unlocks every synced meeting, so a page script can't create,
// replace, reveal or move it on its own; each of these takes the user's click.
function clicked<T>(call: () => Promise<T>): Promise<T> {
  if (!navigator.userActivation.isActive) {
    return Promise.reject(new Error('This needs a click'));
  }
  return call();
}

const api: AppApi = {
  platform: process.platform,
  getAppState: () => ipcRenderer.invoke(IpcChannel.getAppState),
  completeOnboarding: () => ipcRenderer.invoke(IpcChannel.completeOnboarding),
  getAudioAccess: () => ipcRenderer.invoke(IpcChannel.getAudioAccess),
  requestMicrophoneAccess: () =>
    ipcRenderer.invoke(IpcChannel.requestMicrophoneAccess),
  openAudioSettings: (source) =>
    ipcRenderer.invoke(IpcChannel.openAudioSettings, source),
  listModels: () => ipcRenderer.invoke(IpcChannel.listModels),
  downloadModel: (id) => ipcRenderer.invoke(IpcChannel.downloadModel, id),
  cancelModelDownload: (id) =>
    ipcRenderer.invoke(IpcChannel.cancelModelDownload, id),
  deleteModel: (id) => ipcRenderer.invoke(IpcChannel.deleteModel, id),
  onModelsChanged: (callback) => subscribe(IpcEvent.onModelsChanged, callback),
  listMeetings: () => ipcRenderer.invoke(IpcChannel.listMeetings),
  getMeeting: (id) => ipcRenderer.invoke(IpcChannel.getMeeting, id),
  editSummary: (id, markdown) =>
    ipcRenderer.invoke(IpcChannel.editSummary, id, markdown),
  editTranscriptLine: (id, lineId, text) =>
    ipcRenderer.invoke(IpcChannel.editTranscriptLine, id, lineId, text),
  summarizeMeeting: (id) => ipcRenderer.invoke(IpcChannel.summarizeMeeting, id),
  deleteMeeting: (id) => ipcRenderer.invoke(IpcChannel.deleteMeeting, id),
  renameMeeting: (id, title) =>
    ipcRenderer.invoke(IpcChannel.renameMeeting, id, title),
  copyMeeting: (id, part) =>
    ipcRenderer.invoke(IpcChannel.copyMeeting, id, part),
  sendRecordingAudio: (speaker, samples) =>
    ipcRenderer.send(IpcChannel.sendRecordingAudio, speaker, samples),
  getRecording: () => ipcRenderer.invoke(IpcChannel.getRecording),
  startRecording: (title) =>
    ipcRenderer.invoke(IpcChannel.startRecording, title),
  resumeRecording: (id) => ipcRenderer.invoke(IpcChannel.resumeRecording, id),
  pauseRecording: () => ipcRenderer.invoke(IpcChannel.pauseRecording),
  finishMeeting: (id) => ipcRenderer.invoke(IpcChannel.finishMeeting, id),
  sendRecordingLevel: (level) =>
    ipcRenderer.send(IpcChannel.sendRecordingLevel, level),
  sendCaptureStopped: () => ipcRenderer.send(IpcChannel.sendCaptureStopped),
  showMainWindow: () => ipcRenderer.invoke(IpcChannel.showMainWindow),
  onMeetingsChanged: (callback) =>
    subscribe(IpcEvent.onMeetingsChanged, callback),
  onRecordingChanged: (callback) =>
    subscribe(IpcEvent.onRecordingChanged, callback),
  onRecordingLevel: (callback) =>
    subscribe(IpcEvent.onRecordingLevel, callback),
  getSyncState: () => ipcRenderer.invoke(IpcChannel.getSyncState),
  createRecoveryPhrase: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.createRecoveryPhrase)),
  enterRecoveryPhrase: (phrase) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.enterRecoveryPhrase, phrase)),
  chooseSyncFolder: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.chooseSyncFolder)),
  connectSyncRelay: (url) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.connectSyncRelay, url)),
  disconnectSync: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.disconnectSync)),
  changeRecoveryPhrase: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.changeRecoveryPhrase)),
  syncNow: () => ipcRenderer.invoke(IpcChannel.syncNow),
  showRecoveryPhrase: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.showRecoveryPhrase)),
  onSyncChanged: (callback) => subscribe(IpcEvent.onSyncChanged, callback),
  expectSystemAudioCapture: () => {
    // Main can't see user activation, so the click is checked here, out of
    // reach of page scripts, before main opens the screen-capture gate.
    if (!navigator.userActivation.isActive) {
      return Promise.reject(new Error('System audio capture needs a click'));
    }
    return ipcRenderer.invoke(IpcChannel.expectSystemAudioCapture);
  },
};

contextBridge.exposeInMainWorld('api', api);
