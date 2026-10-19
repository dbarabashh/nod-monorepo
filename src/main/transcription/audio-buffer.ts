export type AudioBuffer = {
  parts: Int16Array[];
  samples: number;
  baseMs: number;
};

export type Snapshot = {
  audio: Int16Array<ArrayBuffer>;
  parts: number;
};

export function emptyBuffer(baseMs: number): AudioBuffer {
  return { parts: [], samples: 0, baseMs };
}

export function append(buffer: AudioBuffer, samples: Int16Array): void {
  buffer.parts.push(samples);
  buffer.samples += samples.length;
}

export function snapshot(buffer: AudioBuffer): Snapshot {
  const audio = new Int16Array(new ArrayBuffer(buffer.samples * 2));
  let offset = 0;
  for (const part of buffer.parts) {
    audio.set(part, offset);
    offset += part.length;
  }
  return { audio, parts: buffer.parts.length };
}

// Audio keeps arriving while a snapshot is transcribed, so only the snapshot's
// own parts are replaced by what is left of them.
export function consume(
  buffer: AudioBuffer,
  taken: Snapshot,
  consumeMs: number,
  samplesPerMs: number,
): void {
  const rest = taken.audio.slice(Math.floor(consumeMs * samplesPerMs));
  const arrived = buffer.parts.slice(taken.parts);
  buffer.parts = rest.length > 0 ? [rest, ...arrived] : arrived;
  buffer.samples = buffer.parts.reduce((total, part) => total + part.length, 0);
  buffer.baseMs += consumeMs;
}
