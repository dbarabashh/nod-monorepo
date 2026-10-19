import type { AudioSource } from '../../../shared/ipc.ts';
import { expectSystemAudioCapture } from './api.ts';
import { levelFromSamples } from './lib/level.ts';

const rawAudio: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

export type CaptureFailure =
  | 'blocked'
  | 'no-device'
  | 'unsupported'
  | 'interrupted'
  | 'failed';

export class CaptureError extends Error {
  readonly failure: CaptureFailure;

  constructor(failure: CaptureFailure) {
    super(failure);
    this.failure = failure;
  }
}

function toCaptureError(error: unknown): CaptureError {
  if (error instanceof CaptureError) {
    return error;
  }
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return new CaptureError('blocked');
    }
    if (error.name === 'NotFoundError') {
      return new CaptureError('no-device');
    }
  }
  return new CaptureError('failed');
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

async function openStream(source: AudioSource): Promise<MediaStream> {
  if (source === 'microphone') {
    return navigator.mediaDevices.getUserMedia({ audio: rawAudio });
  }
  await expectSystemAudioCapture();
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: rawAudio,
  });
  for (const track of stream.getVideoTracks()) {
    track.stop();
    stream.removeTrack(track);
  }
  const audio = stream.getAudioTracks();
  if (audio.length === 0) {
    throw new CaptureError('unsupported');
  }
  // macOS hands back an already ended track, without an error, when system
  // audio recording is not allowed.
  if (audio.every((track) => track.readyState === 'ended')) {
    stopTracks(stream);
    throw new CaptureError('blocked');
  }
  return stream;
}

export type LevelMonitor = {
  stop: () => void;
};

export async function monitorLevel(
  source: AudioSource,
  onLevel: (level: number) => void,
  onInterrupted: () => void,
): Promise<LevelMonitor> {
  let stream: MediaStream;
  try {
    stream = await openStream(source);
  } catch (error) {
    throw toCaptureError(error);
  }

  let context: AudioContext | undefined;
  let analyser: AnalyserNode;
  try {
    context = new AudioContext();
    await context.resume();
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
  } catch {
    stopTracks(stream);
    void context?.close();
    throw new CaptureError('failed');
  }
  const audioContext = context;

  const samples = new Float32Array(analyser.fftSize);
  let frame = 0;
  let stopped = false;

  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    onLevel(levelFromSamples(samples));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    cancelAnimationFrame(frame);
    stopTracks(stream);
    void audioContext.close();
  };

  const tracks = stream.getAudioTracks();
  for (const track of tracks) {
    track.addEventListener('ended', () => {
      if (!stopped) {
        stop();
        onInterrupted();
      }
    });
  }
  if (tracks.every((track) => track.readyState === 'ended')) {
    stop();
    throw new CaptureError('interrupted');
  }

  return { stop };
}
