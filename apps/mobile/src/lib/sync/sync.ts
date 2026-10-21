import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { meetingStartedAt, type Meeting } from '@nod/core/meetings';
import type { PairingOffer } from '@nod/core/sync';
import {
  meetingCipher,
  meetingFiles,
  publishedLogFor,
  relayTransportFor,
  secureVaults,
} from './device.ts';
import { messageOf } from '../message-of.ts';
import { createMeetingStore, KeyLostError } from '@nod/core/meetings';
import { createSyncSession, type SyncState } from './session.ts';

export type { SyncState } from './session.ts';

export type SyncView =
  | { status: 'loading' }
  | { status: 'ready'; sync: SyncState; meetings: Meeting[] };

const roundMs = 15_000;

const listeners = new Set<() => void>();
let snapshot: SyncView = { status: 'loading' };

function notify() {
  snapshot = view();
  for (const listener of listeners) {
    listener();
  }
}

// The first round can bring hundreds of meetings one by one; the list is
// rebuilt at most a few times a second while they arrive.
const remoteBatchMs = 150;
let pendingRemote: ReturnType<typeof setTimeout> | null = null;

function notifyRemote() {
  pendingRemote ??= setTimeout(() => {
    pendingRemote = null;
    notify();
  }, remoteBatchMs);
}

// Saving on this phone (a recording, a deletion) shows in the list and goes
// to the other devices a moment later; a burst of saves shares one round.
// While recording, the transcript is saved every few seconds and each round
// uploads the whole growing meeting, so it goes out once a minute instead.
const syncAfterSaveMs = 3_000;
const syncWhileRecordingMs = 60_000;
let recording = false;
let pendingSync: ReturnType<typeof setTimeout> | null = null;

function syncSoon() {
  pendingSync ??= setTimeout(
    () => {
      pendingSync = null;
      void syncNow();
    },
    recording ? syncWhileRecordingMs : syncAfterSaveMs,
  );
}

export function setRecording(active: boolean): void {
  recording = active;
  if (!active) {
    if (pendingSync !== null) {
      clearTimeout(pendingSync);
      pendingSync = null;
    }
    void syncNow();
  }
}

export function whenLoaded(): Promise<void> {
  return start();
}

const store = createMeetingStore({
  files: meetingFiles(),
  cipher: meetingCipher,
  onWrite: () => {
    notifyRemote();
    syncSoon();
  },
});

// Recording and deleting save through the same store sync keeps.
export const meetingStore = store;

const session = createSyncSession({
  vaults: secureVaults(),
  store,
  transportFor: relayTransportFor,
  publishedLogFor,
  onRemote: notifyRemote,
  onChange: notify,
  newId: randomUUID,
  now: Date.now,
});

let loaded = false;
let unreadable: string | null = null;
let keyLost = false;
let starting: Promise<void> | null = null;

// Nothing syncs until the meetings on this phone were read, so copies from
// other devices can never overwrite meetings that failed to load.
function start(): Promise<void> {
  starting ??= (async () => {
    try {
      await store.load();
    } catch (failure) {
      keyLost = failure instanceof KeyLostError;
      unreadable = messageOf(failure);
    }
    if (unreadable === null) {
      await session.load();
    }
    loaded = true;
    notify();
  })();
  return starting;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The deletion reaches the other devices on the next round, and wins over
// any edit made there meanwhile.
export async function deleteMeeting(id: string): Promise<void> {
  await store.remove(id, Date.now());
}

export function syncNow(): Promise<void> {
  return loaded && unreadable === null ? session.refresh() : Promise.resolve();
}

export async function pairWith(offer: PairingOffer): Promise<void> {
  await start();
  if (unreadable !== null) {
    throw new Error(unreadable);
  }
  await session.pair(offer);
}

function view(): SyncView {
  if (!loaded) {
    return { status: 'loading' };
  }
  if (unreadable !== null) {
    return {
      status: 'ready',
      sync: {
        status: 'unavailable',
        error: unreadable,
        reset: keyLost ? 'start-over' : null,
      },
      meetings: [],
    };
  }
  return {
    status: 'ready',
    sync: session.state(),
    meetings: store
      .meetings()
      .sort((a, b) => meetingStartedAt(b) - meetingStartedAt(a)),
  };
}

// Pairing puts this phone's meetings in the vault the code names, so a phone
// that already holds meetings asks before trusting a code.
export function hasLocalMeetings(): boolean {
  return store.ids().length > 0;
}

export async function stopSyncing(): Promise<void> {
  await session.unpair();
}

// The way out of an unavailable state, only on the user's request: a lost
// meetings key starts over with a new one, and sync settings that can't be
// read are cleared so the phone can pair again.
export async function resetSync(): Promise<void> {
  if (keyLost) {
    await store.startOver();
    keyLost = false;
    unreadable = null;
    await session.load();
    notify();
    void syncNow();
    return;
  }
  await session.unpair();
}

export function useSync(): SyncView {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function useMeeting(id: string): Meeting | undefined {
  const sync = useSync();
  return sync.status === 'ready'
    ? sync.meetings.find((meeting) => meeting.id === id)
    : undefined;
}

// Syncs on launch, on coming back to the foreground and every few seconds
// while the app is in front; never in the background.
export function useSyncLoop() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => {
      void syncNow();
    };
    const resume = () => {
      run();
      timer ??= setInterval(run, roundMs);
    };
    const pause = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    void start().then(() => {
      if (AppState.currentState === 'active') {
        resume();
      }
    });
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        resume();
      } else {
        pause();
      }
    });
    return () => {
      pause();
      subscription.remove();
    };
  }, []);
}
