import { useSyncExternalStore } from 'react';
import { randomUUID } from 'expo-crypto';
import { finishMeeting } from '@nod/core/meetings';
import { initParakeet, initWhisper, initWhisperVad } from 'whisper.rn/index';
import type { SpeechModel } from '@nod/core/models';
import { defaultChunkOptions } from '@nod/core/transcription';
import { fromBase64 } from '@nod/core/crypto';
import { AudioCapture } from '../../../modules/audio-capture/index.ts';
import { dateTimeFormat } from '../formats.ts';
import { keepOutOfBackup, recordingFile } from '../storage.ts';
import { meetingStore, setRecording, whenLoaded } from '../sync/sync.ts';
import { installedModel, modelPath } from './models.ts';
import { levelFromPcm } from './audio-level.ts';
import { clearRecordingActivities, showRecordingActivity } from './activity.ts';
import {
  createPhoneRecorder,
  type LoadedEngine,
  type Microphone,
  type RecorderState,
} from './recorder.ts';

export type { RecorderState } from './recorder.ts';
export type { MicrophonePermission } from '../../../modules/audio-capture/index.ts';

const microphone: Microphone = {
  start: async (onAudio, onInterruption) => {
    parts = [
      AudioCapture.addListener('onAudio', ({ pcm }) => {
        const bytes = fromBase64(pcm);
        const samples = new Int16Array(
          bytes.buffer,
          bytes.byteOffset,
          bytes.length / 2,
        );
        setLevel(levelFromPcm(samples));
        onAudio(samples);
      }),
      AudioCapture.addListener('onInterruption', ({ state }) =>
        onInterruption(state),
      ),
    ];
    await AudioCapture.start();
  },
  stop: async () => {
    await AudioCapture.stop();
    for (const part of parts) {
      part.remove();
    }
    parts = [];
    setLevel(0);
  },
  release: () => AudioCapture.release(),
};

let parts: Array<{ remove: () => void }> = [];

// Coarser than the 16 pt bars can show, so silence and steady speech don't
// re-render them on every chunk.
const levelSteps = 16;

let level = 0;
const levelListeners = new Set<() => void>();

function setLevel(raw: number) {
  const next = Math.round(raw * levelSteps) / levelSteps;
  if (next === level) {
    return;
  }
  level = next;
  for (const listener of levelListeners) {
    listener();
  }
}

function subscribeLevel(listener: () => void) {
  levelListeners.add(listener);
  return () => {
    levelListeners.delete(listener);
  };
}

function subscribeNothing() {
  return () => {};
}

export function useRecordingLevel(live: boolean): number {
  return useSyncExternalStore(live ? subscribeLevel : subscribeNothing, () =>
    live ? level : 0,
  );
}

// Phones have four or more cores; leave the rest to the app and the system.
const maxThreads = 4;

// On the CPU: iOS refuses GPU work from an app in the background, and a
// meeting goes on with the screen locked.
type Speech = Pick<LoadedEngine, 'transcribe' | 'release' | 'chunks'>;

async function loadSpeech(model: SpeechModel): Promise<Speech> {
  const filePath = modelPath(model, 'speech');
  if (model.engine === 'parakeet') {
    const parakeet = await initParakeet({ filePath, useGpu: false });
    return {
      transcribe: async (pcm) =>
        (await parakeet.transcribeData(pcm.buffer, { maxThreads }).promise)
          .result,
      release: () => parakeet.release(),
      chunks: defaultChunkOptions,
    };
  }
  const whisper = await initWhisper({
    filePath,
    useGpu: false,
    useCoreMLIos: false,
  });
  return {
    transcribe: async (pcm) =>
      (
        await whisper.transcribeData(pcm.buffer, {
          language: 'auto',
          maxThreads,
        }).promise
      ).result,
    release: () => whisper.release(),
  };
}

async function loadEngine(): Promise<LoadedEngine> {
  const model = installedModel();
  if (!model) {
    throw new Error('Download a speech model first');
  }
  const vad = await initWhisperVad({
    filePath: modelPath(model, 'vad'),
    useGpu: false,
    nThreads: 2,
  });
  try {
    const speech = await loadSpeech(model);
    return {
      ...speech,
      detectSpeech: async (audio) =>
        (await vad.detectSpeechData(audio.buffer)).map((segment) => ({
          startMs: segment.t0 * 10,
          endMs: segment.t1 * 10,
        })),
      release: async () => {
        await speech.release();
        await vad.release();
      },
    };
  } catch (failure) {
    await vad.release();
    throw failure;
  }
}

// Names the meeting this phone is recording, so one the system cut short
// with the app is finished at the next launch. Only this phone's: a meeting
// the computer is recording or has paused is left alone.
const marker = recordingFile;

async function markRecording(meetingId: string | null) {
  try {
    if (meetingId === null) {
      if (marker().exists) {
        marker().delete();
      }
    } else {
      await marker().write(JSON.stringify({ meetingId }));
      await keepOutOfBackup(marker());
    }
  } catch {
    return;
  }
}

export async function finishInterrupted(): Promise<void> {
  await whenLoaded();
  if (recorder.state().status !== 'idle') {
    return;
  }
  clearRecordingActivities();
  if (!marker().exists) {
    return;
  }
  let meetingId: unknown = null;
  try {
    const raw: unknown = JSON.parse(await marker().text());
    meetingId =
      typeof raw === 'object' && raw !== null
        ? Reflect.get(raw, 'meetingId')
        : null;
  } catch {
    meetingId = null;
  }
  const meeting =
    typeof meetingId === 'string' ? meetingStore.meeting(meetingId) : undefined;
  const lastSaved = meeting?.segments.at(-1)?.endedAt;
  if (meeting && meeting.finishedAt === null && lastSaved !== undefined) {
    await meetingStore.save(finishMeeting(meeting, lastSaved));
  }
  await markRecording(null);
}

const listeners = new Set<() => void>();

const recorder = createPhoneRecorder({
  store: meetingStore,
  microphone,
  loadEngine,
  title: (now) => `Meeting on ${dateTimeFormat.format(now)}`,
  newId: randomUUID,
  now: Date.now,
  every: (ms, run) => {
    const timer = setInterval(run, ms);
    return () => clearInterval(timer);
  },
  later: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  onChange: () => {
    showRecordingActivity(recorder.state());
    for (const listener of listeners) {
      listener();
    }
  },
  onRecording: (meetingId) => {
    setRecording(meetingId !== null);
    void markRecording(meetingId);
  },
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRecorder(): RecorderState {
  return useSyncExternalStore(subscribe, recorder.state);
}

export function useTranscribing(meetingId: string): boolean {
  return useSyncExternalStore(subscribe, () =>
    recorder.transcribing(meetingId),
  );
}

export function microphonePermission() {
  return AudioCapture.permission();
}

export async function requestMicrophone(): Promise<boolean> {
  return (await AudioCapture.requestPermission()).granted;
}

// Android shows a recording only through a notification, which needs consent
// from Android 13; recording goes on without it, just less visibly.
export async function requestRecordingNotice(): Promise<void> {
  await AudioCapture.requestNotifications().catch(() => undefined);
}

export const startRecording = recorder.start;
export const resumeRecording = recorder.resume;
export const pauseRecording = recorder.pause;
export const finishRecording = recorder.finish;

// A paused meeting is finished where it was paused, whether this phone
// paused it just now, before a restart, or another device did.
export async function finishPaused(meetingId: string): Promise<void> {
  const state = recorder.state();
  if (state.status !== 'idle' && state.meetingId === meetingId) {
    await recorder.finish();
    return;
  }
  const meeting = meetingStore.meeting(meetingId);
  if (meeting && meeting.finishedAt === null) {
    await meetingStore.save(
      finishMeeting(meeting, meeting.segments.at(-1)?.endedAt ?? Date.now()),
    );
  }
}
