import { requireNativeModule, type EventSubscription } from 'expo';

export type MicrophonePermission = 'granted' | 'denied' | 'undetermined';

export type Interruption = 'began' | 'ended' | 'lost';

type AudioCaptureModule = {
  permission: () => MicrophonePermission;
  requestPermission: () => Promise<{ granted: boolean }>;
  requestNotifications: () => Promise<{ granted: boolean }>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  release: () => Promise<void>;
  addListener: {
    (
      event: 'onAudio',
      listener: (part: { pcm: string }) => void,
    ): EventSubscription;
    (
      event: 'onInterruption',
      listener: (change: { state: Interruption }) => void,
    ): EventSubscription;
  };
};

export const AudioCapture =
  requireNativeModule<AudioCaptureModule>('AudioCapture');
