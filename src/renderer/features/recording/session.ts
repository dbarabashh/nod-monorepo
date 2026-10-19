import {
  CaptureError,
  monitorLevel,
  type CaptureFailure,
  type LevelMonitor,
} from '../../lib/audio-capture.ts';
import {
  expectSystemAudioCapture,
  onRecordingChanged,
  pauseRecording,
  sendCaptureStopped,
  sendRecordingAudio,
  sendRecordingLevel,
} from './api.ts';

export type StartResult = { systemAudio: boolean };

export class StartError extends Error {
  readonly failure: CaptureFailure | 'busy';

  constructor(failure: CaptureFailure | 'busy') {
    super(failure);
    this.failure = failure;
  }
}

const levelIntervalMs = 66;

let busy = false;

export async function startCapture(
  begin: () => Promise<void>,
): Promise<StartResult> {
  if (busy) {
    throw new StartError('busy');
  }
  busy = true;
  try {
    return await capture(begin);
  } catch (error) {
    busy = false;
    throw error;
  }
}

async function capture(begin: () => Promise<void>): Promise<StartResult> {
  const levels = { microphone: 0, system: 0 };
  let lastSent = 0;
  const report = () => {
    const now = performance.now();
    if (now - lastSent >= levelIntervalMs) {
      lastSent = now;
      sendRecordingLevel(Math.max(levels.microphone, levels.system));
    }
  };
  const interrupted = () => void pauseRecording();

  // System audio goes first: it needs the click that started the recording,
  // and a first-time microphone prompt can outlast that click.
  const system = await monitorLevel({
    source: 'system-audio',
    expectSystemAudio: expectSystemAudioCapture,
    onLevel: (level) => {
      levels.system = level;
      report();
    },
    onInterrupted: () => {
      levels.system = 0;
    },
    onPcm: (samples) => sendRecordingAudio('others', samples),
  }).catch(() => null);

  let microphone: LevelMonitor;
  try {
    microphone = await monitorLevel({
      source: 'microphone',
      expectSystemAudio: expectSystemAudioCapture,
      onLevel: (level) => {
        levels.microphone = level;
        report();
      },
      onInterrupted: interrupted,
      onPcm: (samples) => sendRecordingAudio('me', samples),
    });
  } catch (error) {
    void system?.stop();
    throw new StartError(
      error instanceof CaptureError ? error.failure : 'failed',
    );
  }

  const stopAll = async () => {
    await Promise.all([microphone.stop(), system?.stop()]);
    sendRecordingLevel(0);
  };

  try {
    await begin();
  } catch (error) {
    await stopAll();
    throw error;
  }

  const unsubscribe = onRecordingChanged((state) => {
    if (state.status === 'idle') {
      unsubscribe();
      void stopAll().then(() => {
        sendCaptureStopped();
        busy = false;
      });
    }
  });
  return { systemAudio: system !== null };
}
