import {
  documentHeads,
  loadDocument,
  sameDocument,
  saveDocument,
  type DocumentState,
  type MeetingDocument,
  type Merged,
} from '../meetings/index.ts';
import { fileKeyOf, open, seal } from '../crypto/index.ts';
import {
  devicesPrefix,
  meetingContext,
  meetingPath,
  parseMeetingPath,
} from './layout.ts';
import { WritesRefused, type RemoteFile, type Transport } from './transport.ts';

// Far above any real meeting, so a planted huge file is refused before it is
// read into memory.
const maxDocumentBytes = 64 * 1024 * 1024;

// What sync needs from the store that keeps meetings on this device.
export type SyncStore = {
  ids: () => string[];
  document: (id: string) => MeetingDocument | undefined;
  merge: (id: string, remote: MeetingDocument) => Merged;
};

export type SyncStatus = {
  lastSyncedAt: number | null;
  devices: number;
  error: string | null;
};

// Remembers across launches which version of each meeting this device
// already published, so starting the app doesn't write every meeting again.
export type PublishedLog = {
  get: (meetingId: string) => string | undefined;
  set: (meetingId: string, heads: string) => void;
};

export type SyncEngine = {
  // Takes the vault's listing when the caller already has it this round.
  sync: (listed?: RemoteFile[]) => Promise<void>;
  status: () => SyncStatus;
  // The version of another device's file this device has merged, if any.
  merged: (path: string) => string | undefined;
  // Ends the round in progress at its next file and any later round, for a
  // device leaving the vault.
  stop: () => void;
};

export function createSyncEngine(options: {
  transport: Transport;
  vault: { id: string; key: Uint8Array; deviceId: string };
  store: SyncStore;
  onRemote: (state: DocumentState) => void;
  now: () => number;
  publishedLog?: PublishedLog;
}): SyncEngine {
  const { transport, vault, store, onRemote, now, publishedLog } = options;
  const fileKey = fileKeyOf(vault.key);
  const published = new Map<string, MeetingDocument>();
  const seen = new Map<string, string>();
  // The version of each meeting other devices hold in the vault, by file.
  const held = new Map<string, Map<string, string>>();
  // The version of each such file whose changes the store kept.
  const contained = new Map<string, string>();
  let status: SyncStatus = { lastSyncedAt: null, devices: 0, error: null };
  let running: Promise<void> = Promise.resolve();
  let stopped = false;

  // A copy this device already put in the vault is always brought up to
  // date, so an old version (a deleted meeting's text) never stays behind;
  // the log only spares rewriting one that is current. A device with no copy
  // of its own writes none while another device's listed file holds this
  // version: one that only received meetings writes nothing, and writes its
  // copy once it has a change or the other copy disappears.
  function current(id: string, heads: string, listed: Set<string>) {
    if (listed.has(meetingPath(vault.deviceId, id))) {
      return publishedLog?.get(id) === heads;
    }
    for (const [path, version] of held.get(id) ?? []) {
      if (version === heads && listed.has(path)) {
        return true;
      }
    }
    return false;
  }

  async function publish(id: string, listed: Set<string>) {
    const document = store.document(id);
    const last = published.get(id);
    if (!document || (last && sameDocument(last, document))) {
      return;
    }
    const heads = documentHeads(document);
    if (current(id, heads, listed)) {
      return;
    }
    await transport.write(
      meetingPath(vault.deviceId, id),
      seal(
        fileKey,
        saveDocument(document),
        meetingContext(vault.id, vault.deviceId, id),
      ),
    );
    published.set(id, document);
    publishedLog?.set(id, heads);
  }

  async function receive(
    path: string,
    deviceId: string,
    meetingId: string,
  ): Promise<boolean> {
    const sealed = await transport.read(path, maxDocumentBytes);
    if (!sealed) {
      return false;
    }
    const document = loadDocument(
      open(fileKey, sealed, meetingContext(vault.id, deviceId, meetingId)),
    );
    if (!document) {
      throw new Error('A meeting from another device could not be read');
    }
    const versions = held.get(meetingId) ?? new Map<string, string>();
    versions.set(path, documentHeads(document));
    held.set(meetingId, versions);
    const { state, written, kept } = store.merge(meetingId, document);
    if (state) {
      onRemote(state);
    }
    const restored = await written;
    if (restored) {
      onRemote(restored);
    }
    return kept;
  }

  // Stops at the first refusal for the whole vault, so a device over its
  // limit doesn't spend the next round's budget, or the user's time, on
  // writes that can only be refused.
  async function publishAll(listed: Set<string>, failures: string[]) {
    for (const id of store.ids()) {
      try {
        await publish(id, listed);
      } catch (error) {
        failures.push(messageOf(error));
        if (error instanceof WritesRefused) {
          return;
        }
      }
    }
  }

  async function round(given?: RemoteFile[]) {
    if (stopped) {
      return;
    }
    const failures: string[] = [];
    const files = given ?? (await transport.list(devicesPrefix()));
    const listed = new Set(files.map((file) => file.path));
    const devices = new Set<string>();
    for (const file of files) {
      if (stopped) {
        return;
      }
      const parsed = parseMeetingPath(file.path);
      if (!parsed) {
        continue;
      }
      // A copy this device wrote of a meeting it no longer holds (it started
      // over, or was reinstalled with the same id) may be the only one left,
      // since devices don't write back what they only received.
      const own = parsed.deviceId === vault.deviceId;
      if (own && store.document(parsed.meetingId) !== undefined) {
        continue;
      }
      if (!own) {
        devices.add(parsed.deviceId);
      }
      if (seen.get(file.path) === file.version) {
        continue;
      }
      try {
        const kept = await receive(
          file.path,
          parsed.deviceId,
          parsed.meetingId,
        );
        seen.set(file.path, file.version);
        if (kept) {
          contained.set(file.path, file.version);
        }
      } catch (error) {
        failures.push(messageOf(error));
      }
    }
    // After receiving, so what merging changed goes out in the same round and
    // what only arrived from others is never written back.
    await publishAll(listed, failures);
    status = {
      lastSyncedAt: failures.length === 0 ? now() : status.lastSyncedAt,
      devices: devices.size,
      error: failures[0] ?? null,
    };
  }

  return {
    sync: (given) => {
      const next = running
        .then(() => round(given))
        .catch((error: unknown) => {
          status = { ...status, error: messageOf(error) };
        });
      running = next;
      return next;
    },
    status: () => status,
    merged: (path) => contained.get(path),
    stop: () => {
      stopped = true;
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
