import type { AudioAccess, AudioSource } from '../../../shared/ipc.ts';

export function getAudioAccess(): Promise<AudioAccess> {
  return window.api.getAudioAccess();
}

export function requestMicrophoneAccess(): Promise<AudioAccess> {
  return window.api.requestMicrophoneAccess();
}

export function openAudioSettings(source: AudioSource): Promise<void> {
  return window.api.openAudioSettings(source);
}

export function expectSystemAudioCapture(): Promise<void> {
  return window.api.expectSystemAudioCapture();
}
