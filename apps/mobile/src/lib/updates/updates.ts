import Constants from 'expo-constants';
import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { useEffect, useSyncExternalStore } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import { abortAfter } from '../abort-after.ts';
import { downloadVerified } from '../download.ts';
import { messageOf } from '../message-of.ts';
import {
  keepOutOfBackup,
  updateDownloadsDirectory,
  updatesFile,
} from '../storage.ts';
import {
  apkFile,
  findUpdate,
  nextPage,
  type Update,
  type UpdateSource,
} from './find.ts';
import {
  afterCheck,
  isBusy,
  knownUpdate,
  type CheckOutcome,
  type UpdateState,
} from './schedule.ts';

export type { UpdateState } from './schedule.ts';

export type UpdatesView = {
  version: string;
  automatic: boolean;
  state: UpdateState;
};

const firstCheckAfter = 60 * 1000;
const requestTimeout = 30 * 1000;
const apkType = 'application/vnd.android.package-archive';
const grantReadUriPermission = 1;

function updateSource(): UpdateSource | null {
  const raw: unknown = Reflect.get(
    Constants.expoConfig?.extra ?? {},
    'updates',
  );
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const releases: unknown = Reflect.get(raw, 'releases');
  const publicKey: unknown = Reflect.get(raw, 'publicKey');
  return typeof releases === 'string' && typeof publicKey === 'string'
    ? { releases, publicKey }
    : null;
}

// Only Android installs an app from a file; iOS updates come from the App
// Store. A build that doesn't know its own version can't tell what is newer.
const version = Constants.expoConfig?.version ?? null;
const source =
  Platform.OS === 'android' && version !== null ? updateSource() : null;

let snapshot: UpdatesView = {
  version: version ?? '',
  automatic: true,
  state: source === null ? { status: 'unavailable' } : { status: 'idle' },
};
let nextCheck = 0;
let loaded: Promise<void> | null = null;
let recording = false;
// The SHA-256 of the APK in the downloads folder once it has been checked, so
// trying the installer again doesn't read 150 MB again.
let checkedApk: string | null = null;
const listeners = new Set<() => void>();

function update(next: Partial<UpdatesView>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) {
    listener();
  }
}

function setState(state: UpdateState) {
  update({ state });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function readSettings(): Promise<void> {
  try {
    const raw: unknown = JSON.parse(await updatesFile().text());
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const automatic: unknown = Reflect.get(raw, 'automatic');
    const checkAt: unknown = Reflect.get(raw, 'nextCheck');
    if (typeof automatic === 'boolean') {
      update({ automatic });
    }
    if (typeof checkAt === 'number' && Number.isFinite(checkAt)) {
      nextCheck = checkAt;
    }
  } catch {
    return;
  }
}

function whenLoaded(): Promise<void> {
  loaded ??= updatesFile().exists ? readSettings() : Promise.resolve();
  return loaded;
}

async function writeSettings(): Promise<void> {
  try {
    await updatesFile().write(
      JSON.stringify({ automatic: snapshot.automatic, nextCheck }),
    );
    await keepOutOfBackup(updatesFile());
  } catch {
    return;
  }
}

async function ok(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Accept: accept },
    credentials: 'omit',
    signal: abortAfter(requestTimeout),
  });
  if (!response.ok) {
    throw new Error(`${new URL(url).host} answered ${response.status}.`);
  }
  return response;
}

const fetcher = {
  page: async (url: string) => {
    const response = await ok(url, 'application/vnd.github+json');
    return {
      body: await response.json(),
      next: nextPage(response.headers.get('link')),
    };
  },
  bytes: async (url: string) =>
    new Uint8Array(await (await ok(url, 'application/json')).arrayBuffer()),
  text: async (url: string) => (await ok(url, 'text/plain')).text(),
};

export async function checkForUpdate(): Promise<Update | null> {
  if (source === null || version === null || isBusy(snapshot.state)) {
    return null;
  }
  const previous = knownUpdate(snapshot.state);
  setState({ status: 'checking', update: previous });
  await whenLoaded();
  let outcome: CheckOutcome;
  try {
    outcome = { found: await findUpdate(source, version, fetcher) };
  } catch (failure) {
    outcome = { failure: messageOf(failure) };
  }
  const next = afterCheck(outcome, previous, Date.now());
  nextCheck = next.nextCheck;
  setState(next.state);
  await writeSettings();
  return 'found' in outcome ? outcome.found : null;
}

// An APK left from an earlier session is either installed by now or will be
// downloaded and checked again; at about 150 MB it isn't kept.
function removeDownloads() {
  checkedApk = null;
  try {
    const directory = updateDownloadsDirectory();
    if (directory.exists) {
      directory.delete();
    }
  } catch {
    return;
  }
}

// The APK is checked against the size and SHA-256 the signed manifest names
// before Android's installer sees it; Android then refuses an APK signed
// with another key than the installed app's.
export async function installUpdate(found: Update): Promise<void> {
  if (source === null || isBusy(snapshot.state)) {
    return;
  }
  if (recording) {
    setState({
      status: 'failed',
      message: 'Finish the recording first: installing closes Nod.',
      update: found,
    });
    return;
  }
  const apk = new File(updateDownloadsDirectory(), apkFile(found.version));
  try {
    if (checkedApk !== found.sha256 || !apk.exists) {
      removeDownloads();
      updateDownloadsDirectory().create({ intermediates: true });
      let percent = 0;
      setState({ status: 'downloading', update: found, progress: 0 });
      await downloadVerified(found.url, apk, found, {
        onBytes: (bytes) => {
          const now = Math.floor((bytes * 100) / found.size);
          if (now !== percent) {
            percent = now;
            setState({
              status: 'downloading',
              update: found,
              progress: now / 100,
            });
          }
        },
      });
      checkedApk = found.sha256;
    }
    setState({ status: 'installing', update: found });
    await startActivityAsync('android.intent.action.VIEW', {
      data: apk.contentUri,
      type: apkType,
      flags: grantReadUriPermission,
    });
    setState({ status: 'available', update: found });
  } catch (failure) {
    setState({ status: 'failed', message: messageOf(failure), update: found });
  }
}

export async function setAutomaticChecks(automatic: boolean): Promise<void> {
  await whenLoaded();
  update({ automatic });
  await writeSettings();
}

function offer(found: Update) {
  Alert.alert(
    `Nod ${found.version} is available`,
    'It downloads from the release on GitHub. Android asks you to confirm before it installs.',
    [
      { text: 'Later', style: 'cancel' },
      { text: 'Install', onPress: () => void installUpdate(found) },
    ],
  );
}

async function checkIfDue(): Promise<void> {
  await whenLoaded();
  if (!snapshot.automatic || Date.now() < nextCheck) {
    return;
  }
  const found = await checkForUpdate();
  if (found !== null && !recording) {
    offer(found);
  }
}

export function setRecording(active: boolean): void {
  recording = active;
}

export function useUpdates(): UpdatesView {
  return useSyncExternalStore(subscribe, () => snapshot);
}

// A minute after launch, then whenever the app comes back once the next
// check is due: a request to GitHub's API, and two more for the manifest when
// a newer release exists, without cookies or credentials. While a meeting
// records, a new version waits in Settings instead of interrupting it.
export function useUpdateLoop() {
  useEffect(() => {
    if (source === null) {
      return;
    }
    void whenLoaded();
    const timer = setTimeout(() => {
      if (checkedApk === null && !isBusy(snapshot.state)) {
        removeDownloads();
      }
      void checkIfDue();
    }, firstCheckAfter);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void checkIfDue();
      }
    });
    return () => {
      clearTimeout(timer);
      listener.remove();
    };
  }, []);
}
