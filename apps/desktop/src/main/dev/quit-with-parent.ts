// In development the start script can be killed without a chance to stop the
// app it launched. A leftover app keeps the single-instance lock, so the next
// start hands over to it and the old code keeps running.
export function quitWithParent(options: {
  parent: number;
  isAlive: (pid: number) => boolean;
  every: (callback: () => void) => () => void;
  quit: () => void;
}): () => void {
  const stop = options.every(() => {
    if (!options.isAlive(options.parent)) {
      stop();
      options.quit();
    }
  });
  return stop;
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ESRCH'
    );
  }
}
