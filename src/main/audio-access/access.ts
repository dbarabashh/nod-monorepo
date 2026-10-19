import {
  audioSources,
  type AudioAccess,
  type AudioAccessStatus,
  type AudioSource,
  type AudioSourceAccess,
} from '../../shared/ipc.ts';

const notRequired: AudioSourceAccess = {
  status: 'not-required',
  canRequest: false,
  canOpenSettings: false,
};

export function describeAudioAccess(
  platform: NodeJS.Platform,
  microphone: AudioAccessStatus,
): AudioAccess {
  switch (platform) {
    case 'darwin':
      return {
        microphone: {
          status: microphone,
          canRequest: microphone === 'not-determined',
          canOpenSettings: microphone !== 'restricted',
        },
        'system-audio': {
          status: 'unknown',
          canRequest: false,
          canOpenSettings: true,
        },
      };
    case 'win32':
      return {
        microphone: {
          status: microphone,
          canRequest: false,
          canOpenSettings: true,
        },
        'system-audio': notRequired,
      };
    default:
      return { microphone: notRequired, 'system-audio': notRequired };
  }
}

export function audioSettingsUrl(
  platform: NodeJS.Platform,
  source: AudioSource,
): string | null {
  if (platform === 'darwin') {
    const pane =
      source === 'microphone' ? 'Privacy_Microphone' : 'Privacy_AudioCapture';
    return `x-apple.systempreferences:com.apple.preference.security?${pane}`;
  }
  if (platform === 'win32' && source === 'microphone') {
    return 'ms-settings:privacy-microphone';
  }
  return null;
}

export function isAudioSource(value: unknown): value is AudioSource {
  return audioSources.some((source) => source === value);
}
