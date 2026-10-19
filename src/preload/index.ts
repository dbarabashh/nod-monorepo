import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, IpcEvent, type AppApi } from '../shared/ipc.ts';

function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
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
  editTranscriptLine: (id, line, text) =>
    ipcRenderer.invoke(IpcChannel.editTranscriptLine, id, line, text),
  summarizeMeeting: (id) => ipcRenderer.invoke(IpcChannel.summarizeMeeting, id),
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
