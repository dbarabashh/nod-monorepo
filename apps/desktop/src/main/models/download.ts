import { createHash, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';

export type Fetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export type FileDownload = {
  url: string;
  sizeBytes: number;
  sha256: string;
  destination: string;
  fetch: Fetch;
  signal: AbortSignal;
  onProgress: (bytes: number) => void;
};

export class ChecksumError extends Error {}

export function partialPath(destination: string): string {
  return `${destination}.partial`;
}

export async function fileSize(file: string): Promise<number> {
  return stat(file).then(
    (info) => info.size,
    () => 0,
  );
}

async function hashFile(file: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
}

const writeBatchBytes = 1 << 20;

async function writeBody(
  body: ReadableStream<Uint8Array>,
  partial: string,
  offset: number,
  sizeBytes: number,
  hash: Hash,
  onProgress: (bytes: number) => void,
): Promise<void> {
  const out = await open(partial, offset > 0 ? 'a' : 'w');
  let received = offset;
  let batch: Uint8Array[] = [];
  let batchBytes = 0;
  const flush = async () => {
    await out.writev(batch);
    batch = [];
    batchBytes = 0;
  };
  try {
    for await (const chunk of body) {
      hash.update(chunk);
      batch.push(chunk);
      batchBytes += chunk.byteLength;
      received += chunk.byteLength;
      if (received > sizeBytes) {
        throw new ChecksumError('The download is larger than expected');
      }
      if (batchBytes >= writeBatchBytes) {
        await flush();
      }
      onProgress(received);
    }
  } finally {
    await flush().finally(() => out.close());
  }
}

export async function downloadFile(download: FileDownload): Promise<void> {
  const { url, sizeBytes, sha256, destination, fetch, signal, onProgress } =
    download;
  if ((await fileSize(destination)) === sizeBytes) {
    onProgress(sizeBytes);
    return;
  }

  const partial = partialPath(destination);
  let offset = await fileSize(partial);
  if (offset > sizeBytes) {
    await rm(partial, { force: true });
    offset = 0;
  }

  let hash = createHash('sha256');
  if (offset > 0) {
    await hashFile(partial, hash);
  }
  if (offset < sizeBytes) {
    const response = await fetch(url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      signal,
    });
    if (response.status === 200 && offset > 0) {
      offset = 0;
      hash = createHash('sha256');
    } else if (response.status !== (offset > 0 ? 206 : 200)) {
      await response.body?.cancel();
      throw new Error(`Download failed with HTTP ${response.status}`);
    }
    onProgress(offset);
    if (response.body) {
      await writeBody(
        response.body,
        partial,
        offset,
        sizeBytes,
        hash,
        onProgress,
      );
    }
  }

  if (
    (await fileSize(partial)) !== sizeBytes ||
    hash.digest('hex') !== sha256
  ) {
    await rm(partial, { force: true });
    throw new ChecksumError('The downloaded file did not match its checksum');
  }
  await rename(partial, destination);
}
