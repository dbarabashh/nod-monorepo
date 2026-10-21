import {
  createDocument,
  importedDocument,
  loadDocument,
  mergeDocuments,
  readDocument,
  sameDocument,
  saveDocument,
  tombstone,
  updateDocument,
  type DocumentState,
  type MeetingDocument,
} from './document.ts';
import type { Meeting } from './meeting.ts';

export type Cipher = {
  encrypt: (plain: Uint8Array, context: string) => Uint8Array;
  decrypt: (data: Uint8Array, context: string) => Uint8Array;
};

// open: meetings are stored, so their key must be there. create: nothing is
// stored yet. replace: a new key in a new place, never over the old one.
export type CipherMode = 'open' | 'create' | 'replace';

// Meetings are on disk but the key that seals them isn't, or can't be read,
// as after a backup was restored to another device: keychains keep their
// keys to one device. It may also be a passing failure, so nothing is
// replaced until the user chooses to start over.
export class KeyLostError extends Error {}

// One encrypted file per meeting, named by its id; each app implements it
// over its own filesystem.
export type MeetingFiles = {
  ids: () => Promise<string[]>;
  read: (id: string) => Promise<Uint8Array>;
  // Replaces the file in one step and, where the platform can, makes it
  // durable first, so a crash or power cut never leaves half a meeting.
  write: (id: string, data: Uint8Array) => Promise<void>;
  // Keeps a file that couldn't be read beside what replaces it.
  setAside: (id: string) => Promise<void>;
};

// A merge from another device, adopted at once and its state returned, so
// the caller can show it before anything else changes the meeting; the write
// happens after. `kept` is false only when the store refused the document.
export type Merged = {
  state: DocumentState | null;
  written: Promise<DocumentState | null>;
  kept: boolean;
};

export type MeetingStore = {
  load: () => Promise<Meeting[]>;
  startOver: () => Promise<void>;
  save: (meeting: Meeting) => Promise<void>;
  importMeeting: (meeting: Meeting) => Promise<void>;
  remove: (id: string, deletedAt: number) => Promise<void>;
  flush: () => Promise<void>;
  meetings: () => Meeting[];
  meeting: (id: string) => Meeting | undefined;
  ids: () => string[];
  document: (id: string) => MeetingDocument | undefined;
  merge: (id: string, remote: MeetingDocument) => Merged;
  isDeleted: (id: string) => boolean;
};

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function isMeetingId(id: string): boolean {
  return idPattern.test(id);
}

const contextOf = (id: string) => `nod:meeting:${id}`;

export function createMeetingStore(options: {
  files: MeetingFiles;
  cipher: (mode: CipherMode) => Promise<Cipher>;
  onWrite?: (id: string) => void;
}): MeetingStore {
  const { files, onWrite } = options;
  const documents = new Map<string, MeetingDocument>();
  const damaged = new Set<string>();
  const deleted = new Set<string>();
  const bases = new Map<string, Meeting>();
  const persisted = new Map<string, MeetingDocument>();
  const unwritten = new Set<string>();
  const writes = new Map<string, Promise<void>>();
  const queued = new Map<string, Promise<void>>();
  let loaded = false;
  let cipher: Cipher | null = null;

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
      await files.write(
        id,
        requireCipher().encrypt(saveDocument(document), contextOf(id)),
      );
    } catch (error) {
      unwritten.add(id);
      throw error;
    }
    unwritten.delete(id);
    persisted.set(id, document);
    onWrite?.(id);
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

  async function readStored(id: string): Promise<void> {
    try {
      const document = loadDocument(
        requireCipher().decrypt(await files.read(id), contextOf(id)),
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
    await files.setAside(id);
    damaged.delete(id);
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
      const stored = (await files.ids()).filter(isMeetingId);
      cipher = await options.cipher(stored.length > 0 ? 'open' : 'create');
      for (const id of stored) {
        await readStored(id);
      }
      loaded = true;
      return [...bases.values()];
    },
    // The meetings that can't be opened are kept beside a new key, and come
    // back from the user's other devices once this one syncs again.
    // The new key comes first, so a failure to make one leaves every file
    // where it was.
    startOver: async () => {
      const next = await options.cipher('replace');
      for (const id of (await files.ids()).filter(isMeetingId)) {
        await files.setAside(id);
      }
      for (const state of [documents, persisted, bases]) {
        state.clear();
      }
      for (const state of [damaged, deleted, unwritten]) {
        state.clear();
      }
      cipher = next;
      loaded = true;
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
    // A copy already here, from an earlier try whose write failed or from
    // another device, is kept rather than replaced.
    importMeeting: async (meeting) => {
      assertWritable(meeting.id);
      if (deleted.has(meeting.id)) {
        throw new Error('This meeting was deleted');
      }
      if (!documents.has(meeting.id)) {
        documents.set(meeting.id, importedDocument(meeting));
        bases.set(meeting.id, meeting);
      }
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
    meetings: () => [...bases.values()],
    meeting: (id) => bases.get(id),
    ids: () => (loaded ? [...persisted.keys()] : []),
    // What is on disk, so a save that failed is never shared with other
    // devices as if it had happened.
    document: (id) => (loaded ? persisted.get(id) : undefined),
    isDeleted: (id) => deleted.has(id),
    merge: (id, remote) => {
      const nothing: Merged = {
        state: null,
        written: Promise.resolve(null),
        kept: false,
      };
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
        return {
          state: null,
          written: unwritten.has(id)
            ? persist(id).then(() => null)
            : Promise.resolve(null),
          kept: true,
        };
      }
      // A healthy copy from another device replaces a file that couldn't be
      // read; the damaged file is kept beside it, and stays protected if it
      // can't be moved.
      const wasDamaged = damaged.has(id);
      adopt(id, merged, state);
      if (!wasDamaged) {
        return { state, written: persist(id).then(() => null), kept: true };
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
      return { state: null, written, kept: true };
    },
  };
}
