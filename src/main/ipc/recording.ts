import { meetingText } from '../../core/meetings/index.ts';
import {
  IpcChannel,
  IpcEvent,
  pcmSampleRate,
  type MeetingPart,
} from '../../shared/ipc.ts';
import { createAudioBudget } from '../meetings/audio-budget.ts';
import type { Recorder } from '../meetings/recorder.ts';
import type { MeetingSession } from '../meetings/session.ts';
import { broadcast, handleFromApp, listenFromApp } from '../security/sender.ts';
import type { Transcriber } from '../transcription/service.ts';

const maxAudioSamples = pcmSampleRate;
const maxIdLength = 64;
const levelIntervalMs = 30;

function text(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim().slice(0, 200);
  return trimmed === '' ? fallback : trimmed;
}

function meetingId(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxIdLength) {
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
  handleFromApp(appUrl, IpcChannel.summarizeMeeting, (id) =>
    session.summarize(meetingId(id)),
  );
  handleFromApp(appUrl, IpcChannel.showMainWindow, showMainWindow);
  let levelSentAt = -Infinity;
  listenFromApp(appUrl, IpcChannel.sendRecordingLevel, (level) => {
    const now = performance.now();
    if (
      typeof level === 'number' &&
      level >= 0 &&
      level <= 1 &&
      now - levelSentAt >= levelIntervalMs
    ) {
      levelSentAt = now;
      sendLevel(level);
    }
  });
  // Headroom over real time lets a renderer catch up after a stall.
  listenFromApp(appUrl, IpcChannel.sendCaptureStopped, session.captureStopped);
  const budget = () =>
    createAudioBudget({
      now: () => performance.now(),
      samplesPerSecond: pcmSampleRate * 1.5,
      burstSeconds: 20,
    });
  const budgets = { me: budget(), others: budget() };
  listenFromApp(appUrl, IpcChannel.sendRecordingAudio, (speaker, samples) => {
    // A small view over a huge buffer would carry the whole buffer along.
    if (
      session.acceptsAudio() &&
      (speaker === 'me' || speaker === 'others') &&
      samples instanceof Int16Array &&
      samples.length <= maxAudioSamples &&
      samples.byteOffset === 0 &&
      samples.buffer.byteLength === samples.byteLength &&
      budgets[speaker].admit(samples.length)
    ) {
      transcriber.audio(speaker, samples);
    }
  });
}

export function broadcastRecording(recorder: Recorder): void {
  broadcast(IpcEvent.onMeetingsChanged, recorder.summaries());
  broadcast(IpcEvent.onRecordingChanged, recorder.state());
}
