import { useState } from 'react';
import { startFailureMessage } from '../lib/start-message.ts';
import { startCapture, StartError } from '../session.ts';

export function useStart() {
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function start(begin: () => Promise<void>) {
    setStarting(true);
    setNotice(null);
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
