import {
  documentHeads,
  loadDocument,
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
import {
  stillWaiting,
  Throttled,
  UnreadableFile,
  WritesRefused,
  type RemoteFile,
  type Transport,
} from './transport.ts';

// Far above any real meeting, so a planted huge file is refused before it is
// read into memory.
const maxDocumentBytes = 16 * 1024 * 1024;

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

// The version of a meeting this device published, and the version the place
// listed that copy under once it appeared there, or null until it did.
export type PublishedEntry = { heads: string; version: string | null };

// Remembers across launches which version of each meeting this device
// already published, so starting the app doesn't write every meeting again,
// and how the place lists each copy, so a copy the place changed behind this
// device's back (restored from a backup, say) is written again.
export type PublishedLog = {
  get: (meetingId: string) => PublishedEntry | undefined;
  set: (meetingId: string, entry: PublishedEntry) => void;
};

function memoryPublishedLog(): PublishedLog {
  const entries = new Map<string, PublishedEntry>();
  return {
    get: (id) => entries.get(id),
    set: (id, entry) => {
      entries.set(id, entry);
    },
  };
}

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
  const { transport, vault, store, onRemote, now } = options;
  const fileKey = fileKeyOf(vault.key);
  const publishedLog = options.publishedLog ?? memoryPublishedLog();
  const seen = new Map<string, string>();
  // Files that can't be read as they are, with what to report until the
  // place lists another version of them.
  const unreadable = new Map<string, { version: string; message: string }>();
  // The version of each meeting other devices hold in the vault, by file.
  const held = new Map<string, Map<string, string>>();
  // The version of each such file whose changes the store kept.
  const contained = new Map<string, string>();
  // The version each own copy was listed under last round, unless this
  // device wrote it since.
  let lastListed = new Map<string, string>();
  let status: SyncStatus = { lastSyncedAt: null, devices: 0, error: null };
  let running: Promise<void> = Promise.resolve();
  let stopped = false;
  // Until when the place asked this device to wait; rounds before then make
  // no request, so the wait isn't spent keeping the limit tripped.
  let waitUntil = 0;

  function hold(error: unknown): boolean {
    if (error instanceof Throttled) {
      waitUntil = now() + error.retryAfterMs;
      return true;
    }
    return false;
  }

  // A copy this device already put in the vault is always brought up to
  // date, so an old version (a deleted meeting's text) never stays behind;
  // the log only spares rewriting one that is current. A copy listed under
  // another version than the one it got when written, or not listed at all,
  // is read before it is rewritten: a listing that lags or a place that
  // re-tags an unchanged file then costs one read, while a copy the place
  // changed or lost costs the write. The version a listing shows is taken as
  // the copy's own when the place named none at the write, or once two
  // listings in a row agree on it: a listing that lags moves on, while a
  // place that re-stamped the file keeps showing the new version, and taking
  // it at once would hand the copy the tag of what it replaced. A device
  // with no copy of its own writes none while another
  // device's listed file holds this version: one that only received meetings
  // writes nothing, and writes its copy once it has a change or the other
  // copy disappears.
  async function current(
    id: string,
    heads: string,
    listed: Map<string, string>,
  ): Promise<boolean> {
    const own = listed.get(meetingPath(vault.deviceId, id));
    const entry = publishedLog.get(id);
    if (
      entry?.heads === heads &&
      (entry.version === own || (await holds(id, heads)))
    ) {
      if (
        own !== undefined &&
        (entry.version === null || lastListed.get(id) === own)
      ) {
        publishedLog.set(id, { heads, version: own });
      }
      return true;
    }
    if (own !== undefined) {
      return false;
    }
    for (const [path, version] of held.get(id) ?? []) {
      if (version === heads && listed.has(path)) {
        return true;
      }
    }
    return false;
  }

  async function holds(id: string, heads: string): Promise<boolean> {
    const sealed = await transport.read(
      meetingPath(vault.deviceId, id),
      maxDocumentBytes,
    );
    const document = sealed && readSealed(sealed, vault.deviceId, id);
    return document !== null && documentHeads(document) === heads;
  }

  async function publish(
    id: string,
    listed: Map<string, string>,
  ): Promise<boolean> {
    const document = store.document(id);
    if (!document) {
      return false;
    }
    const heads = documentHeads(document);
    if (await current(id, heads, listed)) {
      return false;
    }
    const sealed = seal(
      fileKey,
      saveDocument(document),
      meetingContext(vault.id, vault.deviceId, id),
    );
    // Other devices refuse anything larger, so writing it would only make
    // every one of them report this meeting from now on.
    if (sealed.length > maxDocumentBytes) {
      throw new Error('A meeting is too large to sync');
    }
    const version = await transport.write(
      meetingPath(vault.deviceId, id),
      sealed,
    );
    publishedLog.set(id, { heads, version });
    return true;
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
    const document = readSealed(sealed, deviceId, meetingId);
    if (!document) {
      throw new UnreadableFile(
        'A meeting from another device could not be read',
      );
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

  function readSealed(
    sealed: Uint8Array,
    deviceId: string,
    meetingId: string,
  ): MeetingDocument | null {
    let plain: Uint8Array;
    try {
      plain = open(
        fileKey,
        sealed,
        meetingContext(vault.id, deviceId, meetingId),
      );
    } catch {
      return null;
    }
    return loadDocument(plain);
  }

  // Stops at the first refusal for the whole vault, so a device over its
  // limit doesn't spend the next round's budget, or the user's time, on
  // writes that can only be refused.
  async function publishAll(
    listed: Map<string, string>,
    failures: string[],
    written: Set<string>,
  ) {
    for (const id of store.ids()) {
      try {
        if (await publish(id, listed)) {
          written.add(id);
        }
      } catch (error) {
        failures.push(messageOf(error));
        if (error instanceof WritesRefused || hold(error)) {
          return;
        }
      }
    }
  }

  async function round(given?: RemoteFile[]) {
    if (stopped || stillWaiting(waitUntil, now())) {
      return;
    }
    const failures: string[] = [];
    const files = given ?? (await transport.list(devicesPrefix()));
    const listed = new Map(files.map((file) => [file.path, file.version]));
    const ownListed = new Map<string, string>();
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
        ownListed.set(parsed.meetingId, file.version);
        continue;
      }
      if (!own) {
        devices.add(parsed.deviceId);
      }
      if (seen.get(file.path) === file.version) {
        continue;
      }
      const broken = unreadable.get(file.path);
      if (broken?.version === file.version) {
        failures.push(broken.message);
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
        const message = messageOf(error);
        failures.push(message);
        if (error instanceof UnreadableFile) {
          unreadable.set(file.path, { version: file.version, message });
        }
        if (hold(error)) {
          status = { ...status, error: message };
          return;
        }
      }
    }
    // After receiving, so what merging changed goes out in the same round and
    // what only arrived from others is never written back.
    const written = new Set<string>();
    await publishAll(listed, failures, written);
    for (const id of written) {
      ownListed.delete(id);
    }
    lastListed = ownListed;
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
          hold(error);
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
