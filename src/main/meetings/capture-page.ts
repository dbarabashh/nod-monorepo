export type CapturePage<Page> = ReturnType<typeof createCapturePage<Page>>;

// The page that captures the running recording's audio. Only that page
// reloading, crashing or closing ends the capture, so only that pauses the
// recording; another window opening or reloading never does. The page is
// watched here, so no window has to remember to report it.
export function createCapturePage<Page>(options: {
  watch: (page: Page, onEnd: () => void) => () => void;
  recording: () => boolean;
  pause: () => void;
  onChange: () => void;
}) {
  let page: Page | null = null;
  let unwatch = () => {};

  function own(next: Page | null) {
    if (next === page) {
      return;
    }
    unwatch();
    unwatch = next === null ? () => {} : options.watch(next, lost);
    page = next;
    options.onChange();
  }

  function lost() {
    if (options.recording()) {
      options.pause();
    }
    own(null);
  }

  return {
    // Claimed before a start or resume, so the recording it causes already
    // knows its capture; the returned undo is for a start that failed. While
    // a recording runs nothing else may claim, or the page capturing it would
    // go unwatched until a start that can only fail gives it back.
    claim: (next: Page) => {
      if (options.recording()) {
        throw new Error('A meeting is already being recorded');
      }
      const previous = page;
      own(next);
      return () => {
        if (page === next) {
          own(previous);
        }
      };
    },
    // The recording stopped and its capture is over.
    release: () => own(null),
    is: (candidate: unknown) => page !== null && candidate === page,
  };
}
