import type { RecordingState, Speaker } from '../../../shared/ipc.ts';

export function getRecording(): Promise<RecordingState> {
  return window.api.getRecording();
}

export function onRecordingChanged(
  callback: (state: RecordingState) => void,
): () => void {
  return window.api.onRecordingChanged(callback);
}

export function startRecording(title: string): Promise<void> {
  return window.api.startRecording(title);
}

export function resumeRecording(id: string): Promise<void> {
  return window.api.resumeRecording(id);
}

export function pauseRecording(): Promise<void> {
  return window.api.pauseRecording();
}

export function sendRecordingLevel(level: number): void {
  window.api.sendRecordingLevel(level);
}

export function onRecordingLevel(
  callback: (level: number) => void,
): () => void {
  return window.api.onRecordingLevel(callback);
}

export function showMainWindow(): Promise<void> {
  return window.api.showMainWindow();
}

export function expectSystemAudioCapture(): Promise<void> {
  return window.api.expectSystemAudioCapture();
}

export function finishMeeting(id: string): Promise<void> {
  return window.api.finishMeeting(id);
}

export function sendRecordingAudio(
  speaker: Speaker,
  samples: Int16Array,
): void {
  window.api.sendRecordingAudio(speaker, samples);
}
