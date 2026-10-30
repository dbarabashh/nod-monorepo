import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, IpcEvent, type AppApi } from '../shared/ipc.ts';

function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

// Calls that unlock meetings (the vault key, an assistant's key) or change many
// at once (importing, deleting in bulk) each take a click, so a page script
// can't make them on its own.
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
  setSuggestMeetings: (enabled) =>
    ipcRenderer.invoke(IpcChannel.setSuggestMeetings, enabled),
  clearQuietMeetingApps: () =>
    ipcRenderer.invoke(IpcChannel.clearQuietMeetingApps),
  setCheckForUpdates: (enabled) =>
    ipcRenderer.invoke(IpcChannel.setCheckForUpdates, enabled),
  setTestUpdates: (enabled) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.setTestUpdates, enabled)),
  getUpdateState: () => ipcRenderer.invoke(IpcChannel.getUpdateState),
  checkForUpdatesNow: () => ipcRenderer.invoke(IpcChannel.checkForUpdatesNow),
  installUpdate: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.installUpdate)),
  openUpdatePage: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.openUpdatePage)),
  onUpdateChanged: (callback) => subscribe(IpcEvent.onUpdateChanged, callback),
  getMeetingSuggestion: () =>
    ipcRenderer.invoke(IpcChannel.getMeetingSuggestion),
  dismissMeetingSuggestion: (quietApp) =>
    ipcRenderer.invoke(IpcChannel.dismissMeetingSuggestion, quietApp),
  onMeetingSuggestion: (callback) =>
    subscribe(IpcEvent.onMeetingSuggestion, callback),
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
  useModel: (id) => ipcRenderer.invoke(IpcChannel.useModel, id),
  onModelsChanged: (callback) => subscribe(IpcEvent.onModelsChanged, callback),
  listMeetings: () => ipcRenderer.invoke(IpcChannel.listMeetings),
  getMeeting: (id) => ipcRenderer.invoke(IpcChannel.getMeeting, id),
  importMeetings: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.importMeetings)),
  editSummary: (id, markdown, version) =>
    ipcRenderer.invoke(IpcChannel.editSummary, id, markdown, version),
  editTranscriptLine: (id, lineId, text) =>
    ipcRenderer.invoke(IpcChannel.editTranscriptLine, id, lineId, text),
  summarizeMeeting: (id) => ipcRenderer.invoke(IpcChannel.summarizeMeeting, id),
  deleteMeeting: (id) => ipcRenderer.invoke(IpcChannel.deleteMeeting, id),
  deleteMeetings: (ids) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.deleteMeetings, ids)),
  renameMeeting: (id, title) =>
    ipcRenderer.invoke(IpcChannel.renameMeeting, id, title),
  moveMeetingToFolder: (id, folder) =>
    ipcRenderer.invoke(IpcChannel.moveMeetingToFolder, id, folder),
  renameFolder: (from, to) =>
    ipcRenderer.invoke(IpcChannel.renameFolder, from, to),
  removeFolder: (name) => ipcRenderer.invoke(IpcChannel.removeFolder, name),
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
  dragRecordingWidget: (phase, dx, dy) =>
    ipcRenderer.send(IpcChannel.dragRecordingWidget, phase, dx, dy),
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
  listSyncDevices: () => ipcRenderer.invoke(IpcChannel.listSyncDevices),
  forgetSyncDevice: (id) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.forgetSyncDevice, id)),
  showRecoveryPhrase: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.showRecoveryPhrase)),
  showPairingCode: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.showPairingCode)),
  onSyncChanged: (callback) => subscribe(IpcEvent.onSyncChanged, callback),
  getSharingState: () => ipcRenderer.invoke(IpcChannel.getSharingState),
  showIdentityCard: () =>
    clicked(() => ipcRenderer.invoke(IpcChannel.showIdentityCard)),
  addSharingPeer: (card) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.addSharingPeer, card)),
  stopSharingPeer: (identity) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.stopSharingPeer, identity)),
  shareMeeting: (meetingId, target) =>
    clicked(() =>
      ipcRenderer.invoke(IpcChannel.shareMeeting, meetingId, target),
    ),
  getSharedNote: (target, id) =>
    ipcRenderer.invoke(IpcChannel.getSharedNote, target, id),
  editSharedNote: (target, id, summary, version) =>
    ipcRenderer.invoke(IpcChannel.editSharedNote, target, id, summary, version),
  deleteSharedNote: (target, id) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.deleteSharedNote, target, id)),
  createTeam: (name, myName, relay) =>
    clicked(() =>
      ipcRenderer.invoke(IpcChannel.createTeam, name, myName, relay),
    ),
  joinTeam: (link, myName) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.joinTeam, link, myName)),
  showTeamInvite: (vaultId, role, approval) =>
    clicked(() =>
      ipcRenderer.invoke(IpcChannel.showTeamInvite, vaultId, role, approval),
    ),
  revokeTeamInvite: (vaultId, inviteId) =>
    clicked(() =>
      ipcRenderer.invoke(IpcChannel.revokeTeamInvite, vaultId, inviteId),
    ),
  answerTeamRequest: (vaultId, requestId, accept, role) =>
    clicked(() =>
      ipcRenderer.invoke(
        IpcChannel.answerTeamRequest,
        vaultId,
        requestId,
        accept,
        role,
      ),
    ),
  addTeamMember: (vaultId, card, role, name) =>
    clicked(() =>
      ipcRenderer.invoke(IpcChannel.addTeamMember, vaultId, card, role, name),
    ),
  setTeamMemberRole: (vaultId, identity, role) =>
    clicked(() =>
      ipcRenderer.invoke(IpcChannel.setTeamMemberRole, vaultId, identity, role),
    ),
  removeTeamMember: (vaultId, identity) =>
    clicked(() =>
      ipcRenderer.invoke(IpcChannel.removeTeamMember, vaultId, identity),
    ),
  leaveTeam: (vaultId) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.leaveTeam, vaultId)),
  transferTeam: (vaultId, identity, role) =>
    clicked(() =>
      ipcRenderer.invoke(IpcChannel.transferTeam, vaultId, identity, role),
    ),
  rotateTeamKey: (vaultId) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.rotateTeamKey, vaultId)),
  showTeamLink: (vaultId) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.showTeamLink, vaultId)),
  addKnownTeam: (link) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.addKnownTeam, link)),
  renameTeam: (vaultId, name) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.renameTeam, vaultId, name)),
  nameTeamMember: (vaultId, identity, name) =>
    clicked(() =>
      ipcRenderer.invoke(IpcChannel.nameTeamMember, vaultId, identity, name),
    ),
  onSharingChanged: (callback) =>
    subscribe(IpcEvent.onSharingChanged, callback),
  onDialogChanged: (callback) => subscribe(IpcEvent.onDialogChanged, callback),
  getMcpState: () => ipcRenderer.invoke(IpcChannel.getMcpState),
  setMcpEnabled: (enabled) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.setMcpEnabled, enabled)),
  addMcpClient: (name, scopes) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.addMcpClient, name, scopes)),
  revokeMcpClient: (id) => ipcRenderer.invoke(IpcChannel.revokeMcpClient, id),
  copyMcpSetup: (text) =>
    clicked(() => ipcRenderer.invoke(IpcChannel.copyMcpSetup, text)),
  onMcpChanged: (callback) => subscribe(IpcEvent.onMcpChanged, callback),
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
