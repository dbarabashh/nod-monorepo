import type { ModelInfo } from '../../shared/ipc.ts';

export type SpeechReadiness = 'ready' | 'downloading' | 'missing';

export function speechReadiness(models: readonly ModelInfo[]): SpeechReadiness {
  const speech = models.filter((model) => model.kind === 'speech');
  if (speech.some((model) => model.status === 'downloaded')) {
    return 'ready';
  }
  return speech.some((model) => model.status === 'downloading')
    ? 'downloading'
    : 'missing';
}

// Only when no speech model was ever started: a paused or failed download is
// the user's call and isn't restarted behind their back.
export function firstSpeechDownload(
  models: readonly ModelInfo[],
): string | null {
  const speech = models.filter((model) => model.kind === 'speech');
  const untouched = speech.every(
    (model) =>
      model.status === 'available' &&
      model.downloadedBytes === 0 &&
      model.error === null,
  );
  return untouched
    ? (speech.find((model) => model.recommended)?.id ?? null)
    : null;
}
