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

export type AppState = {
  onboardingCompleted: boolean;
};

export const IpcChannel = {
  getAppState: 'app-state:get',
  completeOnboarding: 'app-state:complete-onboarding',
  getAudioAccess: 'audio-access:get',
  requestMicrophoneAccess: 'audio-access:request-microphone',
  openAudioSettings: 'audio-access:open-settings',
  expectSystemAudioCapture: 'audio-access:expect-system-audio',
} satisfies Record<Exclude<keyof AppApi, 'platform'>, string>;

export type AppApi = {
  platform: NodeJS.Platform;
  getAppState: () => Promise<AppState>;
  completeOnboarding: () => Promise<AppState>;
  getAudioAccess: () => Promise<AudioAccess>;
  requestMicrophoneAccess: () => Promise<AudioAccess>;
  openAudioSettings: (source: AudioSource) => Promise<void>;
  expectSystemAudioCapture: () => Promise<void>;
};
