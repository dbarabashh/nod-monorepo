import type { WebContents } from 'electron';
import { IpcChannel, type MeetingSuggestion } from '../../shared/ipc.ts';
import { handleFromAppPage } from '../security/sender.ts';

// Only the card itself may read, skip or silence its suggestion, so another
// page can't hide one or start muting apps.
export function registerMeetingSuggestionIpc(
  appUrl: string,
  suggestion: {
    owns: (page: WebContents) => boolean;
    current: () => MeetingSuggestion | null;
    dismiss: (quietApp: boolean) => Promise<void>;
  },
): void {
  const fromCard =
    <T>(handler: (...args: unknown[]) => T) =>
    (page: WebContents, ...args: unknown[]) => {
      if (!suggestion.owns(page)) {
        throw new Error('Only the suggestion can answer itself');
      }
      return handler(...args);
    };
  handleFromAppPage(
    appUrl,
    IpcChannel.getMeetingSuggestion,
    fromCard(suggestion.current),
  );
  handleFromAppPage(
    appUrl,
    IpcChannel.dismissMeetingSuggestion,
    fromCard((quietApp) => suggestion.dismiss(quietApp === true)),
  );
}
