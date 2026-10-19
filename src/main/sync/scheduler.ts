const afterChangeMs = 2_000;

// One sync round at a time: a request that arrives during a round runs right
// after it instead of overlapping it.
export function createSyncScheduler(options: {
  refresh: () => Promise<void>;
  idleDelayMs: () => number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let again = false;
  let started = false;

  function schedule(ms: number) {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), ms);
  }

  async function run() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      await options.refresh();
    } catch {
      // The controller keeps the error in its state for the UI.
    } finally {
      busy = false;
      schedule(again ? 0 : options.idleDelayMs());
      again = false;
    }
  }

  // Nothing syncs before start(), which only runs once saved meetings were
  // read; a change made before then waits for it.
  return {
    start: () => {
      started = true;
      schedule(0);
    },
    soon: () => {
      if (started) {
        schedule(afterChangeMs);
      }
    },
    stop: () => clearTimeout(timer),
  };
}
