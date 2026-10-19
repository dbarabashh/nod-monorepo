import { meetingText } from '../../core/meetings/index.ts';
import {
  IpcChannel,
  IpcEvent,
  pcmSampleRate,
  type MeetingPart,
  type Speaker,
  type TranscriptLineKey,
} from '../../shared/ipc.ts';
import { createAudioBudget } from '../meetings/audio-budget.ts';
import type { Recorder } from '../meetings/recorder.ts';
import type { MeetingSession } from '../meetings/session.ts';
import { broadcast, handleFromApp, listenFromApp } from '../security/sender.ts';
import type { Transcriber } from '../transcription/service.ts';

const maxAudioSamples = pcmSampleRate;
const maxIdLength = 64;
const levelIntervalMs = 30;
const maxSummaryChars = 100_000;
const maxLineChars = 10_000;
const tooLong = 'That text is too long to save';

function text(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim().slice(0, 200);
  return trimmed === '' ? fallback : trimmed;
}

function boundedString(value: unknown, max: number, message: string): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(message);
  }
  return value;
}

function meetingId(value: unknown): string {
  return boundedString(value, maxIdLength, 'Unknown meeting');
}

function meetingPart(value: unknown): MeetingPart {
  if (value !== 'summary' && value !== 'transcript') {
    throw new Error('Unknown part of a meeting');
  }
  return value;
}

function isSpeaker(value: unknown): value is Speaker {
  return value === 'me' || value === 'others';
}

function lineKey(value: unknown): TranscriptLineKey {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Unknown transcript line');
  }
  const speaker = Reflect.get(value, 'speaker');
  const startMs = Reflect.get(value, 'startMs');
  if (
    !isSpeaker(speaker) ||
    typeof startMs !== 'number' ||
    !Number.isFinite(startMs)
  ) {
    throw new Error('Unknown transcript line');
  }
  return { speaker, startMs };
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
  handleFromApp(appUrl, IpcChannel.editSummary, (id, markdown) =>
    recorder.editSummary(
      meetingId(id),
      boundedString(markdown, maxSummaryChars, tooLong),
    ),
  );
  handleFromApp(appUrl, IpcChannel.editTranscriptLine, (id, line, text) =>
    recorder.editLine(
      meetingId(id),
      lineKey(line),
      boundedString(text, maxLineChars, tooLong),
    ),
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
      isSpeaker(speaker) &&
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
