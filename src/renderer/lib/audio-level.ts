const floorDb = -60;

export function levelFromSamples(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / samples.length);
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
}
