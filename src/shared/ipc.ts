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

export type MeetingSummary = {
  id: string;
  title: string;
  startedAt: number;
  recordedMs: number;
  status: 'recording' | 'paused' | 'finished';
  contentVersion: string;
};

export type MeetingDetail = {
  id: string;
  transcript: Array<{
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

export type TranscriptLineKey = Pick<
  MeetingDetail['transcript'][number],
  'speaker' | 'startMs'
>;

export type RecordingState =
  | { status: 'idle' }
  | {
      status: 'recording';
      meetingId: string;
      segmentStartedAt: number;
      previousMs: number;
    };

export type AppState = {
  onboardingCompleted: boolean;
};

export const IpcEvent = {
  onModelsChanged: 'models:changed',
  onMeetingsChanged: 'meetings:changed',
  onRecordingChanged: 'recording:changed',
  onRecordingLevel: 'recording:level',
} satisfies Partial<Record<keyof AppApi, string>>;

export const IpcChannel = {
  getAppState: 'app-state:get',
  completeOnboarding: 'app-state:complete-onboarding',
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
} satisfies Record<
  Exclude<keyof AppApi, 'platform' | keyof typeof IpcEvent>,
  string
>;

export type AppApi = {
  platform: NodeJS.Platform;
  getAppState: () => Promise<AppState>;
  completeOnboarding: () => Promise<AppState>;
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
  summarizeMeeting: (id: string) => Promise<void>;
  editSummary: (id: string, markdown: string) => Promise<void>;
  editTranscriptLine: (
    id: string,
    line: TranscriptLineKey,
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
  onMeetingsChanged: (
    callback: (meetings: MeetingSummary[]) => void,
  ) => () => void;
  onRecordingChanged: (callback: (state: RecordingState) => void) => () => void;
  onRecordingLevel: (callback: (level: number) => void) => () => void;
};
