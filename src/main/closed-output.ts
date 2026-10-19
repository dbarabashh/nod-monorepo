import type { EventEmitter } from 'node:events';

// When the terminal that launched the app goes away first, every later log
// line fails with EPIPE, and Electron reports that as a fatal error.
export function ignoreClosedOutput(
  streams: EventEmitter[] = [process.stdout, process.stderr],
): void {
  for (const stream of streams) {
    stream.on('error', (error: Error) => {
      if (!('code' in error) || error.code !== 'EPIPE') {
        throw error;
      }
    });
  }
}
