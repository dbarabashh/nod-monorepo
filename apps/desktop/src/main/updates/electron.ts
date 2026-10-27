import { autoUpdater, net } from 'electron';
import type { Fetch } from '../models/download.ts';
import type { UpdateFeed } from './feed.ts';
import type { Manifest } from './manifest.ts';
import { stageMacRelease } from './stage-mac.ts';
import { stageWindowsRelease } from './stage-windows.ts';
import type { Squirrel } from './updater.ts';

export function electronSquirrel(platform: NodeJS.Platform): Squirrel | null {
  if (platform !== 'darwin' && platform !== 'win32') {
    return null;
  }
  return {
    check: (url) => {
      autoUpdater.setFeedURL(
        platform === 'darwin' ? { url, serverType: 'json' } : { url },
      );
      autoUpdater.checkForUpdates();
    },
    install: () => autoUpdater.quitAndInstall(),
    listen: (listener) => {
      autoUpdater.on('update-downloaded', () =>
        listener({ kind: 'downloaded' }),
      );
      autoUpdater.on('update-not-available', () =>
        listener({ kind: 'not-available' }),
      );
      autoUpdater.on('error', (error) =>
        listener({ kind: 'error', message: error.message }),
      );
    },
  };
}

const requestTimeoutMs = 30_000;
const downloadTimeoutMs = 30 * 60_000;
const maxFeedBytes = 1 << 20;

// Requests go out without cookies or credentials, so the host learns no more
// than any download would tell it.
async function request(url: string, accept: string): Promise<Response> {
  const response = await net.fetch(url, {
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: accept },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`The update feed answered ${response.status}`);
  }
  return response;
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.byteLength;
    if (length > maxFeedBytes) {
      await response.body?.cancel();
      throw new Error('The update feed is too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function fetchFeedBytes(url: string): Promise<Uint8Array> {
  return readCapped(await request(url, '*/*'));
}

export async function fetchFeedJson(url: string): Promise<unknown> {
  const bytes = await readCapped(
    await request(url, 'application/vnd.github+json'),
  );
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return body;
}

const downloadFetch: Fetch = (url, init) =>
  net.fetch(url, { ...init, credentials: 'omit' });

export function platformStage(options: {
  platform: NodeJS.Platform;
  arch: string;
  productName: string;
  feed: UpdateFeed;
  directory: string;
}): ((manifest: Manifest) => Promise<string>) | null {
  const { platform, arch, productName, feed, directory } = options;
  if (platform === 'darwin') {
    return (manifest) =>
      stageMacRelease({
        manifest,
        arch,
        filesUrl: feed.files(manifest.tag),
        zipName: (zipArch, version) =>
          `${productName}-darwin-${zipArch}-${version}.zip`,
        fetchBytes: fetchFeedBytes,
      });
  }
  if (platform === 'win32') {
    return (manifest) =>
      stageWindowsRelease({
        manifest,
        filesUrl: feed.files(manifest.tag),
        directory,
        fetch: downloadFetch,
        signal: AbortSignal.timeout(downloadTimeoutMs),
      });
  }
  return null;
}
