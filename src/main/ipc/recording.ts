import type { WebContents } from 'electron';
import { meetingText } from '../../core/meetings/index.ts';
import {
  IpcChannel,
  IpcEvent,
  pcmSampleRate,
  type MeetingPart,
  type Speaker,
  type WidgetDragPhase,
} from '../../shared/ipc.ts';
import { createAudioBudget } from '../meetings/audio-budget.ts';
import type { Recorder } from '../meetings/recorder.ts';
import type { CapturePage } from '../meetings/capture-page.ts';
import type { MeetingSession } from '../meetings/session.ts';
import {
  broadcast,
  handleFromApp,
  handleFromAppPage,
  listenFromApp,
} from '../security/sender.ts';
import type { Transcriber } from '../transcription/service.ts';

const maxAudioSamples = pcmSampleRate;
const maxIdLength = 64;
const levelIntervalMs = 30;
const maxSummaryChars = 100_000;
const maxLineChars = 10_000;
const maxTitleChars = 200;
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

const maxDeleteCount = 10_000;

function meetingIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > maxDeleteCount) {
    throw new Error('Unknown meetings');
  }
  return value.map(meetingId);
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

const maxDragOffset = 20_000;

function isOffset(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= maxDragOffset
  );
}

export function registerRecordingIpc(options: {
  appUrl: string;
  recorder: Recorder;
  session: MeetingSession;
  transcriber: Transcriber;
  showMainWindow: () => void;
  sendLevel: (level: number) => void;
  dragWidget: (phase: WidgetDragPhase, dx: number, dy: number) => void;
  copyText: (text: string) => void;
  capture: CapturePage<WebContents>;
}): void {
  const {
    appUrl,
    recorder,
    session,
    transcriber,
    showMainWindow,
    sendLevel,
    dragWidget,
    copyText,
    capture,
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
  // The page that starts or resumes a recording is the one capturing it.
  const capturedBy = async (page: WebContents, begin: () => Promise<void>) => {
    const undo = capture.claim(page);
    try {
      await begin();
    } catch (error) {
      undo();
      throw error;
    }
    // The page went while the recording started, so nothing captures it.
    if (!capture.is(page)) {
      await session.pause();
    }
  };
  handleFromAppPage(appUrl, IpcChannel.startRecording, (sender, title) =>
    capturedBy(sender, () => session.start(text(title, 'Untitled meeting'))),
  );
  handleFromAppPage(appUrl, IpcChannel.resumeRecording, (sender, id) =>
    capturedBy(sender, () => session.resume(meetingId(id))),
  );
  handleFromApp(appUrl, IpcChannel.pauseRecording, session.pause);
  handleFromApp(appUrl, IpcChannel.finishMeeting, (id) =>
    session.finish(meetingId(id)),
  );
  handleFromApp(appUrl, IpcChannel.renameMeeting, (id, title) =>
    recorder.rename(
      meetingId(id),
      boundedString(title, maxTitleChars, tooLong),
    ),
  );
  handleFromApp(appUrl, IpcChannel.moveMeetingToFolder, (id, folder) =>
    recorder.moveToFolder(
      meetingId(id),
      folder === null ? null : boundedString(folder, maxTitleChars, tooLong),
    ),
  );
  handleFromApp(appUrl, IpcChannel.renameFolder, (from, to) =>
    recorder.renameFolder(
      boundedString(from, maxTitleChars, tooLong),
      boundedString(to, maxTitleChars, tooLong),
    ),
  );
  handleFromApp(appUrl, IpcChannel.removeFolder, (name) =>
    recorder.removeFolder(boundedString(name, maxTitleChars, tooLong)),
  );
  handleFromApp(appUrl, IpcChannel.deleteMeeting, (id) =>
    recorder.remove(meetingId(id)),
  );
  handleFromApp(appUrl, IpcChannel.deleteMeetings, (ids) =>
    recorder.removeMany(meetingIds(ids)),
  );
  handleFromApp(appUrl, IpcChannel.editSummary, (id, markdown) =>
    recorder.editSummary(
      meetingId(id),
      boundedString(markdown, maxSummaryChars, tooLong),
    ),
  );
  handleFromApp(appUrl, IpcChannel.editTranscriptLine, (id, lineId, text) =>
    recorder.editLine(
      meetingId(id),
      boundedString(lineId, maxIdLength, 'Unknown transcript line'),
      boundedString(text, maxLineChars, tooLong),
    ),
  );
  handleFromApp(appUrl, IpcChannel.summarizeMeeting, (id) =>
    session.summarize(meetingId(id)),
  );
  handleFromApp(appUrl, IpcChannel.showMainWindow, showMainWindow);
  listenFromApp(appUrl, IpcChannel.dragRecordingWidget, (phase, dx, dy) => {
    if (
      (phase === 'start' || phase === 'move') &&
      isOffset(dx) &&
      isOffset(dy)
    ) {
      dragWidget(phase, Math.round(dx), Math.round(dy));
    }
  });
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
