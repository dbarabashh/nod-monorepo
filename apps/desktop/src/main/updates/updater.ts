import type { UpdateState, UpdateStatus } from '../../shared/ipc.ts';
import {
  manifestFile,
  pickTestRelease,
  releaseTag,
  signatureFile,
  type UpdateFeed,
} from './feed.ts';
import { parseManifest, verifyManifest, type Manifest } from './manifest.ts';
import { isNewer } from './version.ts';

export type SquirrelEvent =
  | { kind: 'downloaded' }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string };

export type Squirrel = {
  check: (feedUrl: string) => void;
  install: () => void;
  listen: (listener: (event: SquirrelEvent) => void) => void;
};

export type Channel = 'stable' | 'test';

export type UpdaterOptions = {
  current: string;
  feed: UpdateFeed | null;
  releaseKeys: string;
  unavailable: string | null;
  squirrel: Squirrel | null;
  // Turns a verified release into the feed Squirrel reads, or null where the
  // platform has no Squirrel and only the release page is shown.
  stage: ((manifest: Manifest) => Promise<string>) | null;
  fetchBytes: (url: string) => Promise<Uint8Array>;
  fetchJson: (url: string) => Promise<unknown>;
  channel: () => Promise<Channel>;
  automatic: () => Promise<boolean>;
  recording: () => boolean;
  now: () => number;
  every: (ms: number, run: () => void) => () => void;
  later: (ms: number, run: () => void) => () => void;
  onChange: (state: UpdateState) => void;
};

export type Updater = {
  state: () => UpdateState;
  start: () => void;
  check: () => Promise<void>;
  install: () => void;
  releasePage: () => string | null;
};

const downloadFailed = 'The update couldn’t be downloaded.';
const checkFailed = 'Nod couldn’t check for updates.';
const untrusted =
  'The update wasn’t signed with Nod’s release key, so it was ignored.';

class UntrustedRelease extends Error {}
const firstCheckMs = 60_000;
const downloadTimeoutMs = 30 * 60_000;
const checkEveryMs = 6 * 60 * 60_000;

export function createUpdater(options: UpdaterOptions): Updater {
  const { feed, squirrel } = options;
  let status: UpdateStatus =
    feed === null
      ? { status: 'unavailable', reason: 'This build doesn’t update itself.' }
      : options.unavailable !== null
        ? { status: 'unavailable', reason: options.unavailable }
        : { status: 'idle', error: null };
  let checkedAt: number | null = null;
  let shownTag: string | null = null;

  const state = (): UpdateState => ({
    ...status,
    current: options.current,
    checkedAt,
  });

  function set(next: UpdateStatus) {
    status = next;
    options.onChange(state());
  }

  let stopWaiting = () => {};
  let fetching: string | null = null;
  let timedOut: string | null = null;

  // latest.json already said a newer version is out, so Squirrel finding
  // none means its feed is broken, not that this copy is up to date.
  squirrel?.listen((event) => {
    if (status.status === 'ready' && event.kind === 'error') {
      set({ status: 'idle', error: 'The update couldn’t be installed.' });
      return;
    }
    const version = fetching;
    if (version === null) {
      return;
    }
    fetching = null;
    stopWaiting();
    if (event.kind === 'downloaded') {
      set({ status: 'ready', version });
    } else if (status.status === 'downloading') {
      set({ status: 'idle', error: downloadFailed });
    }
  });

  async function findRelease(found: UpdateFeed): Promise<Manifest> {
    const channel = await options.channel();
    const releases = found.releases;
    const testTag =
      channel === 'test' && releases !== null
        ? await options.fetchJson(releases).then(pickTestRelease, () => null)
        : null;
    const location = testTag === null ? found.stable : found.files(testTag);
    const [bytes, signature] = await Promise.all([
      options.fetchBytes(`${location}/${manifestFile}`),
      options.fetchBytes(`${location}/${signatureFile}`),
    ]);
    if (
      !verifyManifest(
        bytes,
        new TextDecoder().decode(signature),
        options.releaseKeys,
      )
    ) {
      throw new UntrustedRelease();
    }
    const manifest = parseManifest(JSON.parse(new TextDecoder().decode(bytes)));
    if (
      manifest === null ||
      manifest.tag !== (testTag ?? releaseTag(manifest.version))
    ) {
      throw new UntrustedRelease();
    }
    return manifest;
  }

  function giveUp(version: string) {
    if (fetching !== version) {
      return;
    }
    fetching = null;
    stopWaiting();
    if (status.status === 'downloading') {
      set({ status: 'idle', error: downloadFailed });
    }
  }

  async function download(
    manifest: Manifest,
    stage: (manifest: Manifest) => Promise<string>,
    updater: Squirrel,
  ) {
    const { version } = manifest;
    try {
      const feedUrl = await stage(manifest);
      if (fetching === version) {
        updater.check(feedUrl);
      }
    } catch {
      giveUp(version);
    }
  }

  async function check(): Promise<void> {
    if (
      feed === null ||
      (status.status !== 'idle' && status.status !== 'available')
    ) {
      return;
    }
    set({ status: 'checking' });
    let manifest: Manifest | null = null;
    let error = checkFailed;
    try {
      manifest = await findRelease(feed);
    } catch (failure) {
      error = failure instanceof UntrustedRelease ? untrusted : checkFailed;
    }
    checkedAt = options.now();
    if (state().status !== 'checking') {
      return;
    }
    if (manifest === null) {
      set({ status: 'idle', error });
      return;
    }
    const { version } = manifest;
    if (!isNewer(version, options.current)) {
      set({ status: 'idle', error: null });
      return;
    }
    shownTag = manifest.tag;
    if (squirrel === null || options.stage === null) {
      set({ status: 'available', version });
      return;
    }
    set({ status: 'downloading', version });
    stopWaiting();
    stopWaiting = options.later(downloadTimeoutMs, () => {
      // One timeout leaves Squirrel to finish; a second gives up on it.
      if (fetching === version) {
        if (timedOut === version) {
          fetching = null;
        }
        timedOut = version;
      }
      if (status.status === 'downloading') {
        set({ status: 'idle', error: downloadFailed });
      }
    });
    // Squirrel refuses a second check while one runs, and that refusal
    // would hide the download still under way.
    if (fetching === version) {
      return;
    }
    fetching = version;
    void download(manifest, options.stage, squirrel);
  }

  function start() {
    if (feed === null || status.status === 'unavailable') {
      return;
    }
    const checkIfAutomatic = () => {
      void options
        .automatic()
        .then((automatic) => (automatic ? check() : undefined))
        .catch(() => undefined);
    };
    options.later(firstCheckMs, checkIfAutomatic);
    options.every(checkEveryMs, checkIfAutomatic);
  }

  function install() {
    if (status.status !== 'ready' || squirrel === null) {
      throw new Error('No update is ready to install.');
    }
    if (options.recording()) {
      throw new Error('Stop recording first: installing restarts Nod.');
    }
    squirrel.install();
  }

  function releasePage(): string | null {
    return feed !== null &&
      shownTag !== null &&
      (status.status === 'available' || status.status === 'ready')
      ? feed.page(shownTag)
      : null;
  }

  return { state, start, check, install, releasePage };
}
