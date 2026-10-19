import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type AppApi } from '../shared/ipc.ts';

const api: AppApi = {
  platform: process.platform,
  getAppState: () => ipcRenderer.invoke(IpcChannel.getAppState),
  completeOnboarding: () => ipcRenderer.invoke(IpcChannel.completeOnboarding),
  getAudioAccess: () => ipcRenderer.invoke(IpcChannel.getAudioAccess),
  requestMicrophoneAccess: () =>
    ipcRenderer.invoke(IpcChannel.requestMicrophoneAccess),
  openAudioSettings: (source) =>
    ipcRenderer.invoke(IpcChannel.openAudioSettings, source),
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
