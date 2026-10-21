import type { AudioSource, AudioSourceAccess } from '../../../../shared/ipc.ts';
import type { CaptureFailure } from '../../../lib/audio-capture.ts';

export type TestOutcome = 'working' | CaptureFailure | null;

type SourceView = {
  message: string;
  attention: boolean;
  canRequest: boolean;
  canOpenSettings: boolean;
};

export function describeSource(
  source: AudioSource,
  access: AudioSourceAccess,
  outcome: TestOutcome,
): SourceView {
  const blocked = outcome === 'blocked' || access.status === 'denied';
  const failed = outcome !== null && outcome !== 'working';
  return {
    message: message(source, access, outcome),
    attention: blocked || failed || access.status === 'restricted',
    canRequest: access.canRequest,
    canOpenSettings: access.canOpenSettings && blocked,
  };
}

function message(
  source: AudioSource,
  access: AudioSourceAccess,
  outcome: TestOutcome,
): string {
  switch (outcome) {
    case 'working':
      return 'Working';
    case 'blocked':
      return access.canOpenSettings
        ? 'Blocked. Allow it in system settings, then test again.'
        : 'Blocked by the system.';
    case 'no-device':
      return 'No microphone found.';
    case 'unsupported':
      return "This system can't share its audio with the app yet.";
    case 'interrupted':
      return 'Capture stopped unexpectedly. Test again.';
    case 'failed':
      return "Couldn't start. Test again.";
    case null:
      break;
  }
  switch (access.status) {
    case 'granted':
      return 'Allowed';
    case 'denied':
      return 'Blocked in system settings';
    case 'restricted':
      return 'Restricted on this computer';
    case 'not-determined':
      return 'Not allowed yet';
    case 'not-required':
      return 'No permission needed on this system';
    case 'unknown':
      return source === 'system-audio'
        ? 'The system asks the first time you test it'
        : 'Not checked yet';
  }
}
