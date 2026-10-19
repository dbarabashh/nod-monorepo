import { meetingText } from '../../core/meetings/index.ts';
import {
  IpcChannel,
  IpcEvent,
  pcmSampleRate,
  type MeetingPart,
} from '../../shared/ipc.ts';
import type { Recorder } from '../meetings/recorder.ts';
import type { MeetingSession } from '../meetings/session.ts';
import { broadcast, handleFromApp, listenFromApp } from '../security/sender.ts';
import type { Transcriber } from '../transcription/service.ts';

const maxAudioSamples = pcmSampleRate;

function text(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim().slice(0, 200);
  return trimmed === '' ? fallback : trimmed;
}

function meetingId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Unknown meeting');
  }
  return value;
}

function meetingPart(value: unknown): MeetingPart {
  if (value !== 'summary' && value !== 'transcript') {
    throw new Error('Unknown part of a meeting');
  }
  return value;
}

export function registerRecordingIpc(options: {
  appUrl: string;
  recorder: Recorder;
  session: MeetingSession;
  transcriber: Transcriber;
  showMainWindow: () => void;
  sendLevel: (level: number) => void;
  copyText: (text: string) => void;
}): void {
  const {
    appUrl,
    recorder,
    session,
    transcriber,
    showMainWindow,
    sendLevel,
    copyText,
  } = options;
  handleFromApp(appUrl, IpcChannel.listMeetings, recorder.list);
  handleFromApp(appUrl, IpcChannel.getMeeting, (id) =>
    recorder.detail(meetingId(id)),
  );
  handleFromApp(appUrl, IpcChannel.copyMeeting, (id, part) => {
    const meeting = recorder.transcriptOf(meetingId(id));
    if (!meeting) {
      throw new Error('Unknown meeting');
    }
    const text = meetingText(meeting, meetingPart(part));
    if (text === '') {
      throw new Error('There is nothing to copy yet');
    }
    copyText(text);
  });
  handleFromApp(appUrl, IpcChannel.getRecording, recorder.state);
  handleFromApp(appUrl, IpcChannel.startRecording, (title) =>
    session.start(text(title, 'Untitled meeting')),
  );
  handleFromApp(appUrl, IpcChannel.resumeRecording, (id) =>
    session.resume(meetingId(id)),
  );
  handleFromApp(appUrl, IpcChannel.pauseRecording, session.pause);
  handleFromApp(appUrl, IpcChannel.finishMeeting, (id) =>
    session.finish(meetingId(id)),
  );
  handleFromApp(appUrl, IpcChannel.showMainWindow, showMainWindow);
  listenFromApp(appUrl, IpcChannel.sendRecordingLevel, (level) => {
    if (typeof level === 'number' && level >= 0 && level <= 1) {
      sendLevel(level);
    }
  });
  listenFromApp(appUrl, IpcChannel.sendRecordingAudio, (speaker, samples) => {
    if (
      recorder.state().status === 'recording' &&
      (speaker === 'me' || speaker === 'others') &&
      samples instanceof Int16Array &&
      samples.length <= maxAudioSamples
    ) {
      transcriber.audio(speaker, samples);
    }
  });
}

export function broadcastRecording(recorder: Recorder): void {
  broadcast(IpcEvent.onMeetingsChanged, recorder.summaries());
  broadcast(IpcEvent.onRecordingChanged, recorder.state());
}
