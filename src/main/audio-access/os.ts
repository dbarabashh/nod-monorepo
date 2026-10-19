import { shell, systemPreferences } from 'electron';
import type {
  AudioAccess,
  AudioAccessStatus,
  AudioSource,
} from '../../shared/ipc.ts';
import { audioSettingsUrl, describeAudioAccess } from './access.ts';

function readMicrophoneStatus(): AudioAccessStatus {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return systemPreferences.getMediaAccessStatus('microphone');
  }
  return 'not-required';
}

export function readAudioAccess(): AudioAccess {
  return describeAudioAccess(process.platform, readMicrophoneStatus());
}

export async function requestMicrophoneAccess(): Promise<AudioAccess> {
  if (readAudioAccess().microphone.canRequest) {
    await systemPreferences.askForMediaAccess('microphone');
  }
  return readAudioAccess();
}

export async function openAudioSettings(source: AudioSource): Promise<void> {
  const url = audioSettingsUrl(process.platform, source);
  if (url === null) {
    throw new Error('This system has no settings page for that permission');
  }
  await shell.openExternal(url);
}
