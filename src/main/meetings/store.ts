import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  createDocument,
  loadDocument,
  mergeDocuments,
  parseMeetings,
  readDocument,
  sameDocument,
  saveDocument,
  tombstone,
  updateDocument,
  type DocumentState,
  type Meeting,
  type MeetingDocument,
} from '../../core/meetings/index.ts';
import type { Merged } from '../../core/sync/index.ts';

export type Cipher = {
  encrypt: (plain: Uint8Array, context: string) => Uint8Array;
  decrypt: (data: Uint8Array, context: string) => Uint8Array;
};

export type LegacyFile = {
  file: string;
  decrypt: (data: Buffer) => string;
};

export type MeetingStore = {
  load: () => Promise<Meeting[]>;
  save: (meeting: Meeting) => Promise<void>;
  remove: (id: string, deletedAt: number) => Promise<void>;
  flush: () => Promise<void>;
  ids: () => string[];
  document: (id: string) => MeetingDocument | undefined;
  merge: (id: string, remote: MeetingDocument) => Merged;
  isDeleted: (id: string) => boolean;
};

const fileSuffix = '.bin';
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function isMeetingId(id: string): boolean {
  return idPattern.test(id);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function createMeetingStore(options: {
  directory: string;
  cipher: (hasStoredMeetings: boolean) => Promise<Cipher>;
  legacy?: LegacyFile;
  onWrite?: (id: string) => void;
}): MeetingStore {
  const { directory, legacy, onWrite } = options;
  const documents = new Map<string, MeetingDocument>();
  const damaged = new Set<string>();
  const deleted = new Set<string>();
  const bases = new Map<string, Meeting>();
  const persisted = new Map<string, MeetingDocument>();
  const unwritten = new Set<string>();
  let loaded = false;
  const writes = new Map<string, Promise<void>>();
  const queued = new Map<string, Promise<void>>();
  let cipher: Cipher | null = null;

  const fileOf = (id: string) => path.join(directory, `${id}${fileSuffix}`);
  const contextOf = (id: string) => `nod:meeting:${id}`;

  function requireCipher(): Cipher {
    if (!cipher) {
      throw new Error('Saved meetings could not be read');
    }
    return cipher;
  }

  async function write(id: string): Promise<void> {
    const document = documents.get(id);
    if (!document) {
      return;
    }
    try {
      await writeFile(id, document);
    } catch (error) {
      unwritten.add(id);
      throw error;
    }
    unwritten.delete(id);
    persisted.set(id, document);
    onWrite?.(id);
  }

  async function writeFile(id: string, document: MeetingDocument) {
    const temporary = `${fileOf(id)}.tmp`;
    const handle = await open(temporary, 'w');
    try {
      await handle.writeFile(
        requireCipher().encrypt(saveDocument(document), contextOf(id)),
      );
      // Without the sync, a power cut right after the rename can leave an
      // empty file on some filesystems.
      await handle.datasync();
    } finally {
      await handle.close();
    }
    await rename(temporary, fileOf(id));
  }

  // Saves that arrive while a meeting is being written share the next write,
  // and each one reports that write's result.
  function persist(id: string): Promise<void> {
    const waiting = queued.get(id);
    if (waiting) {
      return waiting;
    }
    const next = (writes.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        queued.delete(id);
        return write(id);
      });
    queued.set(id, next);
    writes.set(id, next);
    return next;
  }

  async function storedIds(): Promise<string[]> {
    try {
      return (await readdir(directory))
        .filter((name) => name.endsWith(fileSuffix))
        .map((name) => name.slice(0, -fileSuffix.length))
        .filter(isMeetingId);
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }
  }

  async function migrate(existing: Set<string>): Promise<void> {
    if (!legacy) {
      return;
    }
    let data: Buffer;
    try {
      data = await readFile(legacy.file);
    } catch (error) {
      if (isMissing(error)) {
        return;
      }
      throw error;
    }
    const meetings = parseMeetings(JSON.parse(legacy.decrypt(data))).filter(
      (meeting) => isMeetingId(meeting.id),
    );
    for (const meeting of meetings) {
      if (damaged.has(meeting.id)) {
        await setAside(meeting.id);
      } else if (existing.has(meeting.id)) {
        continue;
      }
      documents.set(meeting.id, createDocument(meeting));
      await persist(meeting.id);
    }
    // The old file goes only once every meeting in it reads back from its
    // own file, so a deleted meeting doesn't live on in it. If it can't be
    // removed it is renamed, so it is never read again.
    for (const meeting of meetings) {
      await readStored(meeting.id);
      if (!persisted.has(meeting.id)) {
        throw new Error('Meetings could not be moved to the new format');
      }
    }
    await rm(legacy.file).catch(() =>
      rename(legacy.file, `${legacy.file}.migrated`).catch(() => undefined),
    );
  }

  async function readStored(id: string): Promise<void> {
    try {
      const document = loadDocument(
        requireCipher().decrypt(await readFile(fileOf(id)), contextOf(id)),
      );
      const state = document ? readDocument(document) : null;
      if (document && state?.id === id) {
        adopt(id, document, state);
        persisted.set(id, document);
      } else {
        damaged.add(id);
      }
    } catch {
      damaged.add(id);
    }
  }

  async function setAside(id: string) {
    await rename(fileOf(id), `${fileOf(id)}.damaged-${Date.now()}`);
    damaged.delete(id);
  }

  function adopt(id: string, document: MeetingDocument, state: DocumentState) {
    documents.set(id, document);
    damaged.delete(id);
    if (state.kind === 'deleted') {
      deleted.add(id);
      bases.delete(id);
    } else {
      bases.set(id, state.meeting);
    }
  }

  function assertWritable(id: string) {
    if (!loaded) {
      throw new Error('Saved meetings could not be read');
    }
    if (!isMeetingId(id)) {
      throw new Error('Unknown meeting');
    }
    // A file that couldn't be read is never overwritten, so it can still be
    // recovered.
    if (damaged.has(id)) {
      throw new Error('This meeting could not be read');
    }
  }

  return {
    load: async () => {
      await mkdir(directory, { recursive: true });
      const existing = new Set(await storedIds());
      cipher = await options.cipher(existing.size > 0);
      for (const id of existing) {
        await readStored(id);
      }
      await migrate(existing);
      loaded = true;
      return [...bases.values()];
    },
    save: async (meeting) => {
      assertWritable(meeting.id);
      if (deleted.has(meeting.id)) {
        throw new Error('This meeting was deleted');
      }
      const current = documents.get(meeting.id);
      const base = bases.get(meeting.id);
      documents.set(
        meeting.id,
        current && base
          ? updateDocument(current, base, meeting)
          : createDocument(meeting),
      );
      bases.set(meeting.id, meeting);
      await persist(meeting.id);
    },
    remove: async (id, deletedAt) => {
      assertWritable(id);
      documents.set(id, tombstone(id, deletedAt));
      deleted.add(id);
      bases.delete(id);
      await persist(id);
    },
    flush: async () => {
      await Promise.all(
        [...writes.values()].map((write) => write.catch(() => undefined)),
      );
    },
    ids: () => (loaded ? [...persisted.keys()] : []),
    // What is on disk, so a save that failed is never shared with other
    // devices as if it had happened.
    document: (id) => (loaded ? persisted.get(id) : undefined),
    isDeleted: (id) => deleted.has(id),
    merge: (id, remote) => {
      const nothing: Merged = { state: null, written: Promise.resolve(null) };
      const incoming = readDocument(remote);
      if (!loaded || !isMeetingId(id) || !incoming || incoming.id !== id) {
        return nothing;
      }
      const current = documents.get(id);
      const merged = current ? mergeDocuments(current, remote) : remote;
      const state = readDocument(merged);
      if (!state) {
        return nothing;
      }
      if (current && sameDocument(current, merged)) {
        return unwritten.has(id)
          ? { state: null, written: persist(id).then(() => null) }
          : nothing;
      }
      // A healthy copy from another device replaces a file that couldn't be
      // read; the damaged file is kept beside it, and stays protected if it
      // can't be moved.
      const wasDamaged = damaged.has(id);
      adopt(id, merged, state);
      if (!wasDamaged) {
        return { state, written: persist(id).then(() => null) };
      }
      damaged.add(id);
      const written = setAside(id).then(
        () => persist(id).then(() => state),
        (error: unknown) => {
          documents.delete(id);
          bases.delete(id);
          deleted.delete(id);
          throw error;
        },
      );
      return { state: null, written };
    },
  };
}
