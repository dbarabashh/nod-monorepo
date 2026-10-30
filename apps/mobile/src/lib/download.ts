import { File } from 'expo-file-system';
import { FileDigest } from '../../modules/file-digest/index.ts';

export type Expected = { size: number; sha256: string };

type DownloadOptions = {
  signal?: AbortSignal;
  onBytes?: (bytes: number) => void;
  onChecking?: () => void;
};

// Moved into place only after its size and sha256 match what a pinned
// catalog or a signed manifest names, so a file that wasn't verified is never
// used. A download that grows past its size is stopped rather than filling
// the phone first.
export async function downloadVerified(
  url: string,
  target: File,
  expected: Expected,
  { signal, onBytes, onChecking }: DownloadOptions = {},
): Promise<void> {
  const partial = new File(target.parentDirectory, `${target.name}.partial`);
  const stop = new AbortController();
  signal?.addEventListener('abort', () => stop.abort());
  await File.downloadFileAsync(url, partial, {
    idempotent: true,
    signal: stop.signal,
    onProgress: ({ bytesWritten }) => {
      if (bytesWritten > expected.size) {
        stop.abort();
        return;
      }
      onBytes?.(bytesWritten);
    },
  });
  onChecking?.();
  if (
    partial.size !== expected.size ||
    (await FileDigest.sha256(partial.uri)) !== expected.sha256
  ) {
    partial.delete();
    throw new Error(
      `${target.name} didn’t match what was expected. Try again.`,
    );
  }
  await partial.move(target, { overwrite: true });
}
