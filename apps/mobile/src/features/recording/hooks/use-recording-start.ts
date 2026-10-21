import { useState } from 'react';
import { useRouter } from 'expo-router';
import { messageOf } from '../../../lib/message-of.ts';
import { installedModel } from '../../../lib/recording/models.ts';
import {
  microphonePermission,
  requestMicrophone,
  requestRecordingNotice,
  resumeRecording,
  startRecording,
} from '../../../lib/recording/recording.ts';

// Starting asks for the microphone when the user records, not before, and
// goes to the speech model screen when there is no model yet.
export function useRecordingStart() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const run = async (begin: () => Promise<string>, open: boolean) => {
    setError(null);
    if (!installedModel()) {
      router.push('/models');
      return;
    }
    setStarting(true);
    try {
      const allowed =
        microphonePermission() === 'granted' || (await requestMicrophone());
      setBlocked(!allowed);
      if (!allowed) {
        setError('Microphone access is off for Nod. Turn it on in Settings.');
        return;
      }
      await requestRecordingNotice();
      const id = await begin();
      if (open) {
        router.push({ pathname: '/meeting/[id]', params: { id } });
      }
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setStarting(false);
    }
  };

  return {
    starting,
    error,
    blocked,
    start: () => void run(startRecording, true),
    resume: (meetingId: string) =>
      void run(() => resumeRecording(meetingId), false),
  };
}
