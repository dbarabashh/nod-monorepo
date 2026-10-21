import type {
  AppState,
  MeetingSuggestion,
  ModelInfo,
  RecordingState,
  Speaker,
  WidgetDragPhase,
} from '../../../shared/ipc.ts';

export function getRecording(): Promise<RecordingState> {
  return window.api.getRecording();
}

export function onRecordingChanged(
  callback: (state: RecordingState) => void,
): () => void {
  return window.api.onRecordingChanged(callback);
}

export function listModels(): Promise<ModelInfo[]> {
  return window.api.listModels();
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

export function sendCaptureStopped(): void {
  window.api.sendCaptureStopped();
}

export function dragRecordingWidget(
  phase: WidgetDragPhase,
  dx: number,
  dy: number,
): void {
  window.api.dragRecordingWidget(phase, dx, dy);
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

export function getMeetingSuggestion(): Promise<MeetingSuggestion | null> {
  return window.api.getMeetingSuggestion();
}

export function onMeetingSuggestion(
  callback: (suggestion: MeetingSuggestion) => void,
): () => void {
  return window.api.onMeetingSuggestion(callback);
}

export function dismissMeetingSuggestion(quietApp: boolean): Promise<void> {
  return window.api.dismissMeetingSuggestion(quietApp);
}

export function getAppState(): Promise<AppState> {
  return window.api.getAppState();
}

export function setSuggestMeetings(enabled: boolean): Promise<AppState> {
  return window.api.setSuggestMeetings(enabled);
}

export function clearQuietMeetingApps(): Promise<AppState> {
  return window.api.clearQuietMeetingApps();
}
