export type AudioSource = 'microphone' | 'system-audio';

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

export type AppState = {
  onboardingCompleted: boolean;
};

export const IpcEvent = {
  onModelsChanged: 'models:changed',
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
};
