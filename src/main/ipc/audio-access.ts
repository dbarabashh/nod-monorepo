import { IpcChannel } from '../../shared/ipc.ts';
import { isAudioSource } from '../audio-access/access.ts';
import {
  openAudioSettings,
  readAudioAccess,
  requestMicrophoneAccess,
} from '../audio-access/os.ts';
import type { DisplayCaptureGate } from '../security/display-capture-gate.ts';
import { handleFromApp } from '../security/sender.ts';

export function registerAudioAccessIpc(
  appUrl: string,
  displayCapture: DisplayCaptureGate,
): void {
  handleFromApp(appUrl, IpcChannel.getAudioAccess, readAudioAccess);
  handleFromApp(
    appUrl,
    IpcChannel.requestMicrophoneAccess,
    requestMicrophoneAccess,
  );
  handleFromApp(appUrl, IpcChannel.expectSystemAudioCapture, () =>
    displayCapture.open(),
  );
  handleFromApp(appUrl, IpcChannel.openAudioSettings, (source) => {
    if (!isAudioSource(source)) {
      throw new Error('Unknown audio source');
    }
    return openAudioSettings(source);
  });
}
