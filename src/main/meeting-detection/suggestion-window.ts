import { IpcEvent, type MeetingSuggestion } from '../../shared/ipc.ts';

// The parts of a window this needs, so it can be tried without Electron.
export type SuggestionWindow = {
  isDestroyed: () => boolean;
  destroy: () => void;
  hide: () => void;
  showInactive: () => void;
  on: (event: 'closed', listener: () => void) => void;
  webContents: { send: (channel: string, payload: unknown) => void };
};

// The card's window lives while it shows a suggestion or while its page
// captures the recording started from it; after that it closes. A suggestion
// that arrives while it still captures waits and shows once that is over.
export function createSuggestionWindowControl(options: {
  open: () => SuggestionWindow;
  capturing: (page: unknown) => boolean;
  // The window went without being asked to (the system closed it).
  onGone: () => void;
}) {
  let window: SuggestionWindow | null = null;
  let suggestion: MeetingSuggestion | null = null;

  const live = () => (window && !window.isDestroyed() ? window : null);

  function settle() {
    const current = live();
    if (!current) {
      return;
    }
    if (options.capturing(current.webContents)) {
      current.hide();
    } else if (suggestion) {
      current.webContents.send(IpcEvent.onMeetingSuggestion, suggestion);
      current.showInactive();
    } else {
      window = null;
      current.destroy();
    }
  }

  return {
    current: () => suggestion,
    owns: (page: unknown) => {
      const current = live();
      return current !== null && current.webContents === page;
    },
    show: (next: MeetingSuggestion) => {
      suggestion = next;
      if (live()) {
        settle();
        return;
      }
      const opened = options.open();
      window = opened;
      // A window destroyed earlier can report closing after a new one
      // opened; only the current one's end matters.
      opened.on('closed', () => {
        if (window === opened) {
          window = null;
          suggestion = null;
          options.onGone();
        }
      });
    },
    hide: () => {
      suggestion = null;
      settle();
    },
    captureChanged: settle,
  };
}
