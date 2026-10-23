export type AudioSource = 'microphone' | 'system-audio';

export type Speaker = 'me' | 'others';

export type MeetingPart = 'summary' | 'transcript';

// Speech models take 16 kHz mono PCM; the renderer resamples to it.
export const pcmSampleRate = 16_000;

export const audioSources: AudioSource[] = ['microphone', 'system-audio'];

export type AudioAccessStatus =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unknown'
  | 'not-required';

export type AudioSourceAccess = {
  status: AudioAccessStatus;
  canRequest: boolean;
  canOpenSettings: boolean;
};

export type AudioAccess = Record<AudioSource, AudioSourceAccess>;

export type ModelStatus = 'available' | 'paused' | 'downloading' | 'downloaded';

export type ModelError = 'network' | 'disk-full' | 'not-writable' | 'checksum';

export type ModelInfo = {
  id: string;
  kind: 'speech' | 'summary';
  name: string;
  description: string;
  languages: string;
  license: string;
  recommended: boolean;
  sizeBytes: number;
  downloadedBytes: number;
  status: ModelStatus;
  error: ModelError | null;
};

export type WidgetDragPhase = 'start' | 'move';

export type MeetingSummary = {
  id: string;
  title: string;
  startedAt: number;
  recordedMs: number;
  folder: string | null;
  status: 'recording' | 'paused' | 'finished';
  contentVersion: string;
};

export type MeetingDetail = {
  id: string;
  transcript: Array<{
    id: string;
    speaker: Speaker;
    startMs: number;
    endMs: number;
    text: string;
  }>;
  summary: string | null;
  summaryEdited: boolean;
  summaryStatus: SummaryStatus;
  problem: string | null;
};

export type SummaryStatus = 'idle' | 'writing' | 'failed';

export type RecordingState =
  | { status: 'idle' }
  | {
      status: 'recording';
      meetingId: string;
      segmentStartedAt: number;
      previousMs: number;
    };

export type SyncTransportInfo =
  | { kind: 'folder'; folder: string }
  | { kind: 'relay'; url: string };

export type SyncDevice = {
  id: string;
  meetings: number;
  lastChangedAt: number;
};

export type SyncState =
  | { status: 'none'; error: string | null }
  | { status: 'unavailable'; error: string }
  | {
      status: 'ready';
      vaultId: string;
      transport: SyncTransportInfo | null;
      defaultRelay: string | null;
      connected: boolean;
      devices: number;
      lastSyncedAt: number | null;
      error: string | null;
      recoveryConfirmed: boolean;
      closed: boolean;
    };

export type SharingPeer = {
  identity: string;
  code: string;
  stoppedAt: number | null;
};

export type SharedNoteInfo = {
  id: string;
  title: string;
  sharedAt: number;
  peer: string;
  peerCode: string;
};

export type SharedNoteDetail = {
  id: string;
  title: string;
  summary: string;
  sharedAt: number;
  peer: string;
};

export type SharingState =
  | { status: 'none' }
  | {
      status: 'ready';
      code: string;
      peers: SharingPeer[];
      notes: SharedNoteInfo[];
      error: string | null;
    };

export type McpScope = 'summaries' | 'transcripts';

export const mcpNameMaxLength = 60;
export const mcpActivityLimit = 50;

export type McpClientInfo = {
  id: string;
  name: string;
  scopes: McpScope[];
  createdAt: number;
  lastUsedAt: number | null;
  // Disconnected and refused already, but not yet saved: shown so it can be
  // retried, since a restart would bring it back.
  revoking: boolean;
};

export type McpActivity = {
  at: number;
  client: string;
  tool: string;
  meetings: string[];
};

export type McpState = {
  enabled: boolean;
  status: 'off' | 'running' | 'failed';
  problem: string | null;
  port: number;
  url: string;
  command: string;
  args: string[];
  setupNote: string | null;
  clients: McpClientInfo[];
  activity: McpActivity[];
};

export type McpConnection = { key: string; client: McpClientInfo };

export type MeetingImportCounts = {
  added: number;
  present: number;
  failed: number;
};

export type MeetingImportResult =
  | { status: 'cancelled' }
  | ({ status: 'imported'; skipped: number } & MeetingImportCounts);

export type MeetingsDeleteResult = { deleted: number; failed: number };

export type MeetingSuggestion = { appName: string; title: string };

export type AppState = {
  onboardingCompleted: boolean;
  suggestMeetings: boolean;
  quietMeetingApps: string[];
};

export const IpcEvent = {
  onModelsChanged: 'models:changed',
  onMeetingsChanged: 'meetings:changed',
  onRecordingChanged: 'recording:changed',
  onRecordingLevel: 'recording:level',
  onSyncChanged: 'sync:changed',
  onMcpChanged: 'mcp:changed',
  onMeetingSuggestion: 'meeting-suggestion:changed',
  onSharingChanged: 'sharing:changed',
  onDialogChanged: 'dialog:changed',
} satisfies Partial<Record<keyof AppApi, string>>;

export const IpcChannel = {
  getMcpState: 'mcp:get',
  setMcpEnabled: 'mcp:set-enabled',
  addMcpClient: 'mcp:add-client',
  revokeMcpClient: 'mcp:revoke-client',
  copyMcpSetup: 'mcp:copy-setup',
  getAppState: 'app-state:get',
  completeOnboarding: 'app-state:complete-onboarding',
  setSuggestMeetings: 'app-state:set-suggest-meetings',
  clearQuietMeetingApps: 'app-state:clear-quiet-meeting-apps',
  getMeetingSuggestion: 'meeting-suggestion:get',
  dismissMeetingSuggestion: 'meeting-suggestion:dismiss',
  getAudioAccess: 'audio-access:get',
  requestMicrophoneAccess: 'audio-access:request-microphone',
  openAudioSettings: 'audio-access:open-settings',
  expectSystemAudioCapture: 'audio-access:expect-system-audio',
  listModels: 'models:list',
  downloadModel: 'models:download',
  cancelModelDownload: 'models:cancel',
  deleteModel: 'models:delete',
  listMeetings: 'meetings:list',
  getMeeting: 'meetings:get',
  copyMeeting: 'meetings:copy',
  deleteMeeting: 'meetings:delete',
  deleteMeetings: 'meetings:delete-many',
  renameMeeting: 'meetings:rename',
  moveMeetingToFolder: 'meetings:move-to-folder',
  renameFolder: 'folders:rename',
  removeFolder: 'folders:remove',
  importMeetings: 'meetings:import',
  summarizeMeeting: 'meetings:summarize',
  editSummary: 'meetings:edit-summary',
  editTranscriptLine: 'meetings:edit-line',
  sendRecordingAudio: 'recording:send-audio',
  getRecording: 'recording:get',
  startRecording: 'recording:start',
  resumeRecording: 'recording:resume',
  pauseRecording: 'recording:pause',
  finishMeeting: 'meetings:finish',
  sendRecordingLevel: 'recording:send-level',
  sendCaptureStopped: 'recording:capture-stopped',
  showMainWindow: 'app:show-main-window',
  dragRecordingWidget: 'recording-widget:drag',
  getSyncState: 'sync:get',
  createRecoveryPhrase: 'sync:create-recovery-phrase',
  enterRecoveryPhrase: 'sync:enter-recovery-phrase',
  showRecoveryPhrase: 'sync:show-recovery-phrase',
  showPairingCode: 'sync:show-pairing-code',
  chooseSyncFolder: 'sync:choose-folder',
  connectSyncRelay: 'sync:connect-relay',
  disconnectSync: 'sync:disconnect',
  changeRecoveryPhrase: 'sync:change-recovery-phrase',
  syncNow: 'sync:now',
  listSyncDevices: 'sync:list-devices',
  forgetSyncDevice: 'sync:forget-device',
  getSharingState: 'sharing:get',
  showIdentityCard: 'sharing:show-identity-card',
  addSharingPeer: 'sharing:add-peer',
  stopSharingPeer: 'sharing:stop-peer',
  shareMeeting: 'sharing:share-meeting',
  getSharedNote: 'sharing:get-note',
  editSharedNote: 'sharing:edit-note',
  deleteSharedNote: 'sharing:delete-note',
} satisfies Record<
  Exclude<keyof AppApi, 'platform' | keyof typeof IpcEvent>,
  string
>;

export type AppApi = {
  platform: NodeJS.Platform;
  getAppState: () => Promise<AppState>;
  completeOnboarding: () => Promise<AppState>;
  setSuggestMeetings: (enabled: boolean) => Promise<AppState>;
  clearQuietMeetingApps: () => Promise<AppState>;
  getMeetingSuggestion: () => Promise<MeetingSuggestion | null>;
  dismissMeetingSuggestion: (quietApp: boolean) => Promise<void>;
  onMeetingSuggestion: (
    callback: (suggestion: MeetingSuggestion) => void,
  ) => () => void;
  getAudioAccess: () => Promise<AudioAccess>;
  requestMicrophoneAccess: () => Promise<AudioAccess>;
  openAudioSettings: (source: AudioSource) => Promise<void>;
  expectSystemAudioCapture: () => Promise<void>;
  listModels: () => Promise<ModelInfo[]>;
  downloadModel: (id: string) => Promise<void>;
  cancelModelDownload: (id: string) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  onModelsChanged: (callback: (models: ModelInfo[]) => void) => () => void;
  listMeetings: () => Promise<MeetingSummary[]>;
  getMeeting: (id: string) => Promise<MeetingDetail>;
  copyMeeting: (id: string, part: MeetingPart) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;
  deleteMeetings: (ids: string[]) => Promise<MeetingsDeleteResult>;
  renameMeeting: (id: string, title: string) => Promise<void>;
  moveMeetingToFolder: (id: string, folder: string | null) => Promise<void>;
  renameFolder: (from: string, to: string) => Promise<string>;
  removeFolder: (name: string) => Promise<void>;
  importMeetings: () => Promise<MeetingImportResult>;
  summarizeMeeting: (id: string) => Promise<void>;
  editSummary: (id: string, markdown: string) => Promise<void>;
  editTranscriptLine: (
    id: string,
    lineId: string,
    text: string,
  ) => Promise<void>;
  sendRecordingAudio: (speaker: Speaker, samples: Int16Array) => void;
  getRecording: () => Promise<RecordingState>;
  startRecording: (title: string) => Promise<void>;
  resumeRecording: (id: string) => Promise<void>;
  pauseRecording: () => Promise<void>;
  finishMeeting: (id: string) => Promise<void>;
  sendRecordingLevel: (level: number) => void;
  sendCaptureStopped: () => void;
  showMainWindow: () => Promise<void>;
  dragRecordingWidget: (phase: WidgetDragPhase, dx: number, dy: number) => void;
  onMeetingsChanged: (
    callback: (meetings: MeetingSummary[]) => void,
  ) => () => void;
  onRecordingChanged: (callback: (state: RecordingState) => void) => () => void;
  onRecordingLevel: (callback: (level: number) => void) => () => void;
  getSyncState: () => Promise<SyncState>;
  createRecoveryPhrase: () => Promise<void>;
  enterRecoveryPhrase: (phrase: string) => Promise<boolean>;
  showRecoveryPhrase: () => Promise<boolean>;
  showPairingCode: () => Promise<void>;
  chooseSyncFolder: () => Promise<void>;
  connectSyncRelay: (url: string) => Promise<void>;
  disconnectSync: () => Promise<void>;
  changeRecoveryPhrase: () => Promise<void>;
  syncNow: () => Promise<void>;
  listSyncDevices: () => Promise<SyncDevice[]>;
  forgetSyncDevice: (id: string) => Promise<void>;
  onSyncChanged: (callback: (state: SyncState) => void) => () => void;
  getSharingState: () => Promise<SharingState>;
  showIdentityCard: () => Promise<void>;
  addSharingPeer: (card: string) => Promise<boolean>;
  stopSharingPeer: (identity: string) => Promise<void>;
  shareMeeting: (meetingId: string, peer: string) => Promise<SharedNoteInfo>;
  getSharedNote: (peer: string, id: string) => Promise<SharedNoteDetail>;
  editSharedNote: (peer: string, id: string, summary: string) => Promise<void>;
  deleteSharedNote: (peer: string, id: string) => Promise<void>;
  onSharingChanged: (callback: (state: SharingState) => void) => () => void;
  onDialogChanged: (callback: (open: boolean) => void) => () => void;
  getMcpState: () => Promise<McpState>;
  setMcpEnabled: (enabled: boolean) => Promise<void>;
  addMcpClient: (name: string, scopes: McpScope[]) => Promise<McpConnection>;
  revokeMcpClient: (id: string) => Promise<void>;
  copyMcpSetup: (text: string) => Promise<void>;
  onMcpChanged: (callback: (state: McpState) => void) => () => void;
};
