import { pcmSampleRate, type AudioSource } from '../../shared/ipc.ts';
import { levelFromSamples } from './audio-level.ts';

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

async function openStream(
  source: AudioSource,
  expectSystemAudio: () => Promise<void>,
): Promise<MediaStream> {
  if (source === 'microphone') {
    return navigator.mediaDevices.getUserMedia({ audio: rawAudio });
  }
  await expectSystemAudio();
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

export type MonitorOptions = {
  source: AudioSource;
  expectSystemAudio: () => Promise<void>;
  onLevel: (level: number) => void;
  onInterrupted: () => void;
  onPcm?: (samples: Int16Array) => void;
};

const levelIntervalMs = 33;

export async function monitorLevel(
  options: MonitorOptions,
): Promise<LevelMonitor> {
  const { source, expectSystemAudio, onLevel, onInterrupted, onPcm } = options;
  let stream: MediaStream;
  try {
    stream = await openStream(source, expectSystemAudio);
  } catch (error) {
    throw toCaptureError(error);
  }

  let context: AudioContext | undefined;
  let analyser: AnalyserNode;
  try {
    context = new AudioContext(onPcm ? { sampleRate: pcmSampleRate } : {});
    await context.resume();
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const input = context.createMediaStreamSource(stream);
    input.connect(analyser);
    if (onPcm) {
      await context.audioWorklet.addModule(
        new URL('pcm-capture.js', document.baseURI).href,
      );
      const pcm = new AudioWorkletNode(context, 'pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      pcm.port.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data instanceof Int16Array) {
          onPcm(event.data);
        }
      };
      input.connect(pcm);
    }
  } catch {
    stopTracks(stream);
    void context?.close();
    throw new CaptureError('failed');
  }
  const audioContext = context;

  const samples = new Float32Array(analyser.fftSize);
  let stopped = false;

  // A timer rather than animation frames: a recording keeps running while
  // its window is hidden, and hidden windows get no frames.
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    onLevel(levelFromSamples(samples));
  }, levelIntervalMs);

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(timer);
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
