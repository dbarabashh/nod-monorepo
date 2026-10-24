import {
  documentHeads,
  loadDocumentState,
  saveDocument,
  type DocumentState,
  type MeetingDocument,
  type MergedOf,
} from '../meetings/index.ts';
import { fileKeyOf, open, seal } from '../crypto/index.ts';
import {
  devicesPrefix,
  meetingContext,
  meetingPath,
  parseClosedPath,
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

// What sync needs from the store that keeps documents of one kind on this
// device.
export type DocumentSyncStore<D, S> = {
  ids: () => string[];
  document: (id: string) => D | undefined;
  merge: (id: string, remote: D) => MergedOf<S>;
};

export type SyncStore = DocumentSyncStore<MeetingDocument, DocumentState>;

// One kind of document in a vault: where its files live, how they are sealed
// for the place and read back, and how a version is named. The engine moves
// files; the kind says what they are.
export type SyncDocuments<D, S> = {
  // What a file holds, for what the user is told: a meeting, a note.
  name: string;
  path: (deviceId: string, id: string) => string;
  parse: (path: string) => { deviceId: string; id: string } | null;
  seal: (plain: Uint8Array, deviceId: string, id: string) => Uint8Array;
  // null when the file isn't for this device to read: another key, a
  // signature that doesn't hold, or a publisher who may not write here.
  open: (sealed: Uint8Array, deviceId: string, id: string) => Uint8Array | null;
  load: (plain: Uint8Array) => { document: D; id: string; state: S } | null;
  heads: (document: D) => string;
  save: (document: D) => Uint8Array;
  // false for a copy this device must not take although it opened: one from
  // a publisher who has lost the right to write. It counts as absent,
  // quietly, until the place lists another version of it, so a device that
  // holds the document publishes a copy of its own for the others.
  admit?: (sealed: Uint8Array) => boolean;
};

export type SyncStatus = {
  lastSyncedAt: number | null;
  devices: number;
  error: string | null;
};

// The version of a document this device published, and the version the place
// listed that copy under once it appeared there, or null until it did.
export type PublishedEntry = { heads: string; version: string | null };

// What this device read of another device's file and kept: the version the
// place listed it under and the version of the document it held.
export type ReceivedEntry = { version: string; heads: string };

// Remembers across launches which files of other devices this device already
// read, so starting the app doesn't fetch every one of them again. An entry
// only spares the read while the store still holds the document: a store
// that started over, or lost the file, gets it back from here. Entries the
// round finds stale are pruned.
export type ReceivedLog = {
  get: (path: string) => ReceivedEntry | undefined;
  set: (path: string, entry: ReceivedEntry) => void;
  prune: (stale: (path: string) => boolean) => void;
};

// Remembers across launches which version of each document this device
// already published, so starting the app doesn't write every one again, and
// how the place lists each copy, so a copy the place changed behind this
// device's back (restored from a backup, say) is written again. Kept in one
// place with what was received, since both are scoped the same way.
export type PublishedLog = {
  get: (id: string) => PublishedEntry | undefined;
  set: (id: string, entry: PublishedEntry) => void;
  received?: ReceivedLog;
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

export function memoryReceivedLog(): ReceivedLog {
  const entries = new Map<string, ReceivedEntry>();
  return {
    get: (path) => entries.get(path),
    set: (path, entry) => {
      entries.set(path, entry);
    },
    prune: (stale) => {
      for (const path of entries.keys()) {
        if (stale(path)) {
          entries.delete(path);
        }
      }
    },
  };
}

export type SyncEngine = {
  // Takes the vault's listing when the caller already has it this round. A
  // listing with files left out costs reading them again next round.
  sync: (listed?: RemoteFile[]) => Promise<void>;
  status: () => SyncStatus;
  // The version of another device's file this device has merged, if any.
  merged: (path: string) => string | undefined;
  // Ends the round in progress at its next file and any later round, for a
  // device leaving the vault.
  stop: () => void;
  // Drops what was read of a device whose files the caller removed from the
  // vault, since no listing names that device any more.
  forget: (deviceId: string) => void;
  // Reads every file again at the next round, for a caller whose rules on
  // what to take changed (someone lost the right to write).
  recheck?: () => void;
};

// Meetings in a person's own vault: version 1 files under the vault's file
// key, as 0001 describes.
export function meetingDocuments(vault: {
  id: string;
  key: Uint8Array;
}): SyncDocuments<MeetingDocument, DocumentState> {
  const fileKey = fileKeyOf(vault.key);
  return {
    name: 'meeting',
    path: meetingPath,
    parse: (path) => {
      const parsed = parseMeetingPath(path);
      return parsed
        ? { deviceId: parsed.deviceId, id: parsed.meetingId }
        : null;
    },
    seal: (plain, deviceId, id) =>
      seal(fileKey, plain, meetingContext(vault.id, deviceId, id)),
    open: (sealed, deviceId, id) => {
      try {
        return open(fileKey, sealed, meetingContext(vault.id, deviceId, id));
      } catch {
        return null;
      }
    },
    load: (plain) => {
      const loaded = loadDocumentState(plain);
      return loaded
        ? {
            document: loaded.document,
            id: loaded.state.id,
            state: loaded.state,
          }
        : null;
    },
    heads: documentHeads,
    save: saveDocument,
  };
}

export function createSyncEngine(options: {
  transport: Transport;
  vault: { id: string; key: Uint8Array; deviceId: string };
  store: SyncStore;
  onRemote: (state: DocumentState) => void;
  now: () => number;
  publishedLog?: PublishedLog;
}): SyncEngine {
  return createDocumentSyncEngine({
    ...options,
    documents: meetingDocuments(options.vault),
  });
}

export function createDocumentSyncEngine<D, S>(options: {
  transport: Transport;
  vault: { deviceId: string };
  documents: SyncDocuments<D, S>;
  store: DocumentSyncStore<D, S>;
  onRemote: (state: S) => void;
  now: () => number;
  publishedLog?: PublishedLog;
}): SyncEngine {
  const { transport, vault, documents, store, onRemote, now } = options;
  const publishedLog = options.publishedLog ?? memoryPublishedLog();
  const received = publishedLog.received ?? memoryReceivedLog();
  // Files that can't be read as they are, with what to report until the
  // place lists another version of them.
  const unreadable = new Map<string, { version: string; message: string }>();
  const refused = new Map<string, string>();
  // The version of each document other devices hold in the vault, by file.
  const held = new Map<string, Map<string, string>>();
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
    const own = listed.get(documents.path(vault.deviceId, id));
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
      documents.path(vault.deviceId, id),
      maxDocumentBytes,
    );
    const loaded = sealed && readSealed(sealed, vault.deviceId, id);
    return loaded !== null && documents.heads(loaded.document) === heads;
  }

  async function publish(
    id: string,
    listed: Map<string, string>,
  ): Promise<boolean> {
    const document = store.document(id);
    if (!document) {
      return false;
    }
    const heads = documents.heads(document);
    if (await current(id, heads, listed)) {
      return false;
    }
    const sealed = documents.seal(documents.save(document), vault.deviceId, id);
    // Other devices refuse anything larger, so writing it would only make
    // every one of them report this document from now on.
    if (sealed.length > maxDocumentBytes) {
      throw new Error(`A ${documents.name} is too large to sync`);
    }
    const version = await transport.write(
      documents.path(vault.deviceId, id),
      sealed,
    );
    publishedLog.set(id, { heads, version });
    return true;
  }

  function noteHeld(id: string, path: string, heads: string) {
    const versions = held.get(id) ?? new Map<string, string>();
    versions.set(path, heads);
    held.set(id, versions);
  }

  async function receive(
    path: string,
    deviceId: string,
    id: string,
    version: string,
  ): Promise<void> {
    const sealed = await transport.read(path, maxDocumentBytes);
    if (!sealed) {
      return;
    }
    const loaded = readSealed(sealed, deviceId, id);
    // A file holding another document than its name says, or none the app
    // can read, is as unreadable as a damaged one: the store would refuse
    // it every time.
    if (!loaded || loaded.id !== id) {
      throw new UnreadableFile(
        `A ${documents.name} from another device could not be read`,
      );
    }
    const { document } = loaded;
    if (documents.admit && !documents.admit(sealed)) {
      refused.set(path, version);
      return;
    }
    const heads = documents.heads(document);
    noteHeld(id, path, heads);
    const { state, written, kept } = store.merge(id, document);
    if (state) {
      onRemote(state);
    }
    const restored = await written;
    if (restored) {
      onRemote(restored);
    }
    if (kept) {
      received.set(path, { version, heads });
    }
  }

  function readSealed(
    sealed: Uint8Array,
    deviceId: string,
    id: string,
  ): ReturnType<SyncDocuments<D, S>['load']> {
    const plain = documents.open(sealed, deviceId, id);
    return plain ? documents.load(plain) : null;
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
    const shown = new Set<string>();
    for (const file of files) {
      if (stopped) {
        return;
      }
      const closedBy = parseClosedPath(file.path);
      if (closedBy) {
        shown.add(closedBy);
      }
      const parsed = documents.parse(file.path);
      if (!parsed) {
        continue;
      }
      shown.add(parsed.deviceId);
      // A copy this device wrote of a document it no longer holds (it started
      // over, or was reinstalled with the same id) may be the only one left,
      // since devices don't write back what they only received.
      const own = parsed.deviceId === vault.deviceId;
      if (own && store.document(parsed.id) !== undefined) {
        ownListed.set(parsed.id, file.version);
        continue;
      }
      if (!own) {
        devices.add(parsed.deviceId);
      }
      const known = received.get(file.path);
      if (
        known?.version === file.version &&
        store.document(parsed.id) !== undefined
      ) {
        noteHeld(parsed.id, file.path, known.heads);
        continue;
      }
      if (refused.get(file.path) === file.version) {
        continue;
      }
      const broken = unreadable.get(file.path);
      if (broken?.version === file.version) {
        failures.push(broken.message);
        continue;
      }
      try {
        await receive(file.path, parsed.deviceId, parsed.id, file.version);
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
    // Only among devices the listing still shows: a listing a caller
    // narrowed to leave a device out, or an unmounted folder that lists
    // nothing, says nothing about the files it doesn't name.
    received.prune((path) => {
      const parsed = documents.parse(path);
      return parsed !== null && shown.has(parsed.deviceId) && !listed.has(path);
    });
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
    merged: (path) => {
      const parsed = documents.parse(path);
      return parsed && store.document(parsed.id) !== undefined
        ? received.get(path)?.version
        : undefined;
    },
    stop: () => {
      stopped = true;
    },
    forget: (deviceId) => {
      received.prune((path) => documents.parse(path)?.deviceId === deviceId);
    },
    recheck: () => {
      received.prune(() => true);
      refused.clear();
      held.clear();
    },
  };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Several kinds of document in one vault (a person's shares beside their
// meetings) sync as one engine: one listing serves them all, and the caller
// has one status to show. The first engine names the devices and the last
// round, since the others carry what rides along; any engine's error shows.
export function composeEngines(engines: SyncEngine[]): SyncEngine {
  const [first] = engines;
  if (!first) {
    throw new Error('An engine is needed');
  }
  return {
    sync: async (listed) => {
      for (const engine of engines) {
        await engine.sync(listed);
      }
    },
    status: () => ({
      ...first.status(),
      error:
        engines.map((engine) => engine.status().error).find(Boolean) ?? null,
    }),
    merged: (path) =>
      engines.map((engine) => engine.merged(path)).find(Boolean),
    stop: () => {
      for (const engine of engines) {
        engine.stop();
      }
    },
    forget: (deviceId) => {
      for (const engine of engines) {
        engine.forget(deviceId);
      }
    },
    recheck: () => {
      for (const engine of engines) {
        engine.recheck?.();
      }
    },
  };
}
