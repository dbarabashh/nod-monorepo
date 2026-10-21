import { useState } from 'react';
import { speechReadiness } from '../../../lib/speech-ready.ts';
import { listModels } from '../api.ts';
import { startFailureMessage } from '../lib/start-message.ts';
import { startCapture, StartError } from '../session.ts';

const notReady = {
  downloading:
    'The speech model is still downloading. Start recording once it is ready.',
  missing:
    'Recording needs a speech model. Download one in Settings → Transcription.',
};

// Checked before asking for the microphone, so nobody is prompted for a
// recording that can't happen. Main checks again when it starts.
async function speechProblem(): Promise<string | null> {
  const models = await listModels().catch(() => null);
  if (!models) {
    return null;
  }
  const readiness = speechReadiness(models);
  return readiness === 'ready' ? null : notReady[readiness];
}

export function useStart() {
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function start(begin: () => Promise<void>) {
    setStarting(true);
    setNotice(null);
    const problem = await speechProblem();
    if (problem) {
      setNotice(problem);
      setStarting(false);
      return;
    }
    try {
      const { systemAudio } = await startCapture(begin);
      if (!systemAudio) {
        setNotice(
          "Recording your microphone only. System audio isn't available.",
        );
      }
    } catch (error) {
      setNotice(
        error instanceof StartError
          ? startFailureMessage(error.failure)
          : "Couldn't start recording. Try again.",
      );
    } finally {
      setStarting(false);
    }
  }

  return { start, starting, notice };
}
