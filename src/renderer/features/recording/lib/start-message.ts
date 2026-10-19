import type { StartError } from '../session.ts';

export function startFailureMessage(failure: StartError['failure']): string {
  switch (failure) {
    case 'blocked':
      return 'Microphone access is blocked. Allow it in Settings.';
    case 'no-device':
      return 'No microphone found.';
    case 'busy':
      return 'Another recording is still stopping. Try again.';
    case 'unsupported':
    case 'interrupted':
    case 'failed':
      return "Couldn't start recording. Try again.";
  }
}
