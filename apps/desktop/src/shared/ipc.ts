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
  inUse: boolean;
  tooLarge: boolean;
};

export type ChosenModels = Record<ModelInfo['kind'], string | null>;

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
  sharedAs: SharedCopyInfo[];
};

// Where the meeting's notes went: a note in a one-to-one vault or a team.
export type SharedCopyInfo = {
  noteId: string;
  target: string;
  kind: ShareTargetKind;
  sharedAt: number;
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

export type ShareTargetKind = 'person' | 'team';

export type SharedNoteInfo = {
  id: string;
  title: string;
  sharedAt: number;
  // The person it is shared with (their identity as hex) or the team it is
  // shared in (the team vault's id), and what to call that home.
  target: string;
  kind: ShareTargetKind;
  label: string;
};

export type SharedNoteDetail = {
  id: string;
  title: string;
  summary: string;
  sharedAt: number;
  target: string;
  kind: ShareTargetKind;
};

export type TeamRole = 'owner' | 'admin' | 'writer' | 'reader';

export type TeamGrantedRole = Exclude<TeamRole, 'owner'>;

// Lowest first: a role's position is its rank.
export const teamGrantedRoles: TeamGrantedRole[] = [
  'reader',
  'writer',
  'admin',
];

export const teamRoles: TeamRole[] = [...teamGrantedRoles, 'owner'];

export function rankOf(role: TeamRole): number {
  return teamRoles.indexOf(role);
}

export function isTeamGrantedRole(value: unknown): value is TeamGrantedRole {
  return teamGrantedRoles.some((role) => role === value);
}

export type TeamMemberInfo = {
  identity: string;
  code: string;
  name: string | null;
  role: TeamRole;
  leaving: boolean;
};

export type TeamInviteInfo = {
  id: string;
  role: TeamGrantedRole;
  approval: boolean;
};

export type TeamRequestInfo = {
  id: string;
  identity: string;
  code: string;
  name: string | null;
  role: TeamGrantedRole;
};

export type TeamInfo = {
  vaultId: string;
  name: string;
  // The relay the team lives on.
  host: string;
  role: TeamRole | null;
  pending: boolean;
  members: TeamMemberInfo[];
  invites: TeamInviteInfo[];
  requests: TeamRequestInfo[];
  error: string | null;
};

export type JoinOutcome = { vaultId: string; pending: boolean };

export type SharingState =
  | { status: 'none' }
  | {
      status: 'ready';
      code: string;
      peers: SharingPeer[];
      teams: TeamInfo[];
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
  checkForUpdates: boolean;
  testUpdates: boolean;
  chosenModels: ChosenModels;
};

export type UpdateStatus =
  | { status: 'unavailable'; reason: string }
  | { status: 'idle'; error: string | null }
  | { status: 'checking' }
  | { status: 'downloading'; version: string }
  | { status: 'ready'; version: string }
  | { status: 'available'; version: string };

export type UpdateState = UpdateStatus & {
  current: string;
  checkedAt: number | null;
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
  onUpdateChanged: 'updates:changed',
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
  setCheckForUpdates: 'app-state:set-check-for-updates',
  setTestUpdates: 'app-state:set-test-updates',
  getUpdateState: 'updates:get',
  checkForUpdatesNow: 'updates:check',
  installUpdate: 'updates:install',
  openUpdatePage: 'updates:open-page',
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
  useModel: 'models:use',
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
  createTeam: 'sharing:create-team',
  joinTeam: 'sharing:join-team',
  showTeamInvite: 'sharing:show-team-invite',
  revokeTeamInvite: 'sharing:revoke-team-invite',
  answerTeamRequest: 'sharing:answer-team-request',
  addTeamMember: 'sharing:add-team-member',
  setTeamMemberRole: 'sharing:set-team-member-role',
  removeTeamMember: 'sharing:remove-team-member',
  leaveTeam: 'sharing:leave-team',
  transferTeam: 'sharing:transfer-team',
  rotateTeamKey: 'sharing:rotate-team-key',
  showTeamLink: 'sharing:show-team-link',
  addKnownTeam: 'sharing:add-known-team',
  renameTeam: 'sharing:rename-team',
  nameTeamMember: 'sharing:name-team-member',
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
  setCheckForUpdates: (enabled: boolean) => Promise<AppState>;
  setTestUpdates: (enabled: boolean) => Promise<AppState>;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdatesNow: () => Promise<void>;
  installUpdate: () => Promise<void>;
  openUpdatePage: () => Promise<void>;
  onUpdateChanged: (callback: (state: UpdateState) => void) => () => void;
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
  useModel: (id: string) => Promise<void>;
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
  shareMeeting: (meetingId: string, target: string) => Promise<SharedNoteInfo>;
  getSharedNote: (target: string, id: string) => Promise<SharedNoteDetail>;
  editSharedNote: (
    target: string,
    id: string,
    summary: string,
  ) => Promise<void>;
  deleteSharedNote: (target: string, id: string) => Promise<void>;
  createTeam: (
    name: string,
    myName: string,
    relay: string | null,
  ) => Promise<string | null>;
  joinTeam: (link: string, myName: string) => Promise<JoinOutcome | null>;
  showTeamInvite: (
    vaultId: string,
    role: TeamGrantedRole,
    approval: boolean,
  ) => Promise<void>;
  revokeTeamInvite: (vaultId: string, inviteId: string) => Promise<boolean>;
  answerTeamRequest: (
    vaultId: string,
    requestId: string,
    accept: boolean,
    role: TeamGrantedRole,
  ) => Promise<boolean>;
  addTeamMember: (
    vaultId: string,
    card: string,
    role: TeamGrantedRole,
    name: string,
  ) => Promise<boolean>;
  setTeamMemberRole: (
    vaultId: string,
    identity: string,
    role: TeamGrantedRole,
  ) => Promise<boolean>;
  removeTeamMember: (vaultId: string, identity: string) => Promise<boolean>;
  leaveTeam: (vaultId: string) => Promise<boolean>;
  transferTeam: (
    vaultId: string,
    identity: string,
    role: 'admin' | 'writer',
  ) => Promise<boolean>;
  rotateTeamKey: (vaultId: string) => Promise<boolean>;
  showTeamLink: (vaultId: string) => Promise<void>;
  addKnownTeam: (link: string) => Promise<string | null>;
  renameTeam: (vaultId: string, name: string) => Promise<void>;
  nameTeamMember: (
    vaultId: string,
    identity: string,
    name: string,
  ) => Promise<void>;
  onSharingChanged: (callback: (state: SharingState) => void) => () => void;
  onDialogChanged: (callback: (open: boolean) => void) => () => void;
  getMcpState: () => Promise<McpState>;
  setMcpEnabled: (enabled: boolean) => Promise<void>;
  addMcpClient: (name: string, scopes: McpScope[]) => Promise<McpConnection>;
  revokeMcpClient: (id: string) => Promise<void>;
  copyMcpSetup: (text: string) => Promise<void>;
  onMcpChanged: (callback: (state: McpState) => void) => () => void;
};
