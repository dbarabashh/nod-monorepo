const floorDb = -60;
const fullScale = 32768;

export function levelFromPcm(pcm: Int16Array): number {
  if (pcm.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of pcm) {
    const normalized = sample / fullScale;
    sum += normalized * normalized;
  }
  const db = 20 * Math.log10(Math.sqrt(sum / pcm.length));
  return Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
}
