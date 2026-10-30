export type Cipher = {
  encrypt: (plain: Uint8Array, context: string) => Uint8Array;
  decrypt: (data: Uint8Array, context: string) => Uint8Array;
};

// One encrypted file per document, named by its id; each app implements it
// over its own filesystem.
export type DocumentFiles = {
  ids: () => Promise<string[]>;
  read: (id: string) => Promise<Uint8Array>;
  // Replaces the file in one step and, where the platform can, makes it
  // durable first, so a crash or power cut never leaves half a document.
  write: (id: string, data: Uint8Array) => Promise<void>;
  // Keeps a file that couldn't be read beside what replaces it.
  setAside: (id: string) => Promise<void>;
};

// A merge from another device, adopted at once and its state returned, so
// the caller can show it before anything else changes the document; the
// write happens after. `kept` is false only when the store refused it.
export type MergedOf<S> = {
  state: S | null;
  written: Promise<S | null>;
  kept: boolean;
};

// One kind of document kept on this device: how a value becomes a document
// and back, and how two devices' copies merge. The store keeps the files;
// the kind says what they are.
export type DocumentKind<
  D,
  S extends { id: string },
  V extends { id: string },
> = {
  // What a file holds, for what the user is told: a meeting, a note.
  name: string;
  isId: (id: string) => boolean;
  context: (id: string) => string;
  create: (value: V) => D;
  update: (document: D, previous: V, next: V) => D;
  // An edit made from an earlier version and the version it made, or null
  // when the document doesn't hold that version as a value.
  updateFrom: (
    document: D,
    version: string,
    edit: (seen: V) => V,
  ) => { document: D; version: string } | null;
  version: (document: D) => string;
  tombstone: (id: string, deletedAt: number) => D;
  read: (document: D) => S | null;
  // The value a state holds, or null for a deleted document.
  valueOf: (state: S) => V | null;
  merge: (local: D, remote: D) => D;
  same: (a: D, b: D) => boolean;
  save: (document: D) => Uint8Array;
  load: (bytes: Uint8Array) => { document: D; state: S } | null;
};

export type DocumentStore<
  D,
  S extends { id: string },
  V extends { id: string },
> = {
  // Reads every stored document; the cipher is asked for once the ids are
  // known, so a store can tell a first run from a key that went missing.
  load: (cipher: (storedIds: string[]) => Promise<Cipher>) => Promise<V[]>;
  // Forgets everything held, for a caller that set the files aside.
  reset: (cipher: Cipher) => void;
  save: (value: V) => Promise<void>;
  // An edit to the version a person saw while making it, merged with what
  // arrived since; resolves to the version it made.
  saveFrom: (
    id: string,
    version: string,
    edit: (seen: V) => V,
  ) => Promise<string>;
  version: (id: string) => string | null;
  // A copy already here, from an earlier try whose write failed or from
  // another device, is kept rather than replaced.
  importValue: (value: V, document: (value: V) => D) => Promise<void>;
  remove: (id: string, deletedAt: number) => Promise<void>;
  flush: () => Promise<void>;
  values: () => V[];
  value: (id: string) => V | undefined;
  ids: () => string[];
  document: (id: string) => D | undefined;
  merge: (id: string, remote: D) => MergedOf<S>;
  isDeleted: (id: string) => boolean;
};

export function createDocumentStore<
  D,
  S extends { id: string },
  V extends { id: string },
>(options: {
  files: DocumentFiles;
  kind: DocumentKind<D, S, V>;
  onWrite?: (id: string) => void;
}): DocumentStore<D, S, V> {
  const { files, kind, onWrite } = options;
  const documents = new Map<string, D>();
  const damaged = new Set<string>();
  const deleted = new Set<string>();
  const bases = new Map<string, V>();
  const persisted = new Map<string, D>();
  const unwritten = new Set<string>();
  const writes = new Map<string, Promise<void>>();
  const queued = new Map<string, Promise<void>>();
  let loaded = false;
  let cipher: Cipher | null = null;

  function requireCipher(): Cipher {
    if (!cipher) {
      throw new Error(`Saved ${kind.name}s could not be read`);
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
        requireCipher().encrypt(kind.save(document), kind.context(id)),
      );
    } catch (error) {
      unwritten.add(id);
      throw error;
    }
    unwritten.delete(id);
    persisted.set(id, document);
    onWrite?.(id);
  }

  // Saves that arrive while a document is being written share the next
  // write, and each one reports that write's result.
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

  function adopt(id: string, document: D, state: S) {
    documents.set(id, document);
    damaged.delete(id);
    const value = kind.valueOf(state);
    if (value === null) {
      deleted.add(id);
      bases.delete(id);
    } else {
      bases.set(id, value);
    }
  }

  async function readStored(id: string): Promise<void> {
    try {
      const read = kind.load(
        requireCipher().decrypt(await files.read(id), kind.context(id)),
      );
      if (read && read.state.id === id) {
        adopt(id, read.document, read.state);
        persisted.set(id, read.document);
      } else {
        damaged.add(id);
      }
    } catch {
      damaged.add(id);
    }
  }

  function assertWritable(id: string) {
    if (!loaded) {
      throw new Error(`Saved ${kind.name}s could not be read`);
    }
    if (!kind.isId(id)) {
      throw new Error(`Unknown ${kind.name}`);
    }
    // A file that couldn't be read is never overwritten, so it can still be
    // recovered.
    if (damaged.has(id)) {
      throw new Error(`This ${kind.name} could not be read`);
    }
  }

  function assertSavable(id: string) {
    assertWritable(id);
    if (deleted.has(id)) {
      throw new Error(`This ${kind.name} was deleted`);
    }
  }

  return {
    load: async (cipherFor) => {
      const stored = (await files.ids()).filter(kind.isId);
      cipher = await cipherFor(stored);
      for (const id of stored) {
        await readStored(id);
      }
      loaded = true;
      return [...bases.values()];
    },
    reset: (next) => {
      for (const state of [documents, persisted, bases]) {
        state.clear();
      }
      for (const state of [damaged, deleted, unwritten]) {
        state.clear();
      }
      cipher = next;
      loaded = true;
    },
    save: async (value) => {
      assertSavable(value.id);
      const current = documents.get(value.id);
      const base = bases.get(value.id);
      documents.set(
        value.id,
        current && base
          ? kind.update(current, base, value)
          : kind.create(value),
      );
      bases.set(value.id, value);
      await persist(value.id);
    },
    saveFrom: async (id, version, edit) => {
      assertSavable(id);
      const current = documents.get(id);
      const edited = current ? kind.updateFrom(current, version, edit) : null;
      const state = edited ? kind.read(edited.document) : null;
      const value = state ? kind.valueOf(state) : null;
      if (!current || !edited || !value) {
        throw new Error(
          `That ${kind.name} has changed; open it again to edit it`,
        );
      }
      const base = bases.get(id);
      documents.set(id, edited.document);
      bases.set(id, value);
      try {
        await persist(id);
      } catch (failure) {
        // Taken back, so trying again from the same version doesn't make the
        // edit twice. Once something else changed the document during the
        // write, the edit stays for the next write instead.
        if (documents.get(id) !== edited.document) {
          return edited.version;
        }
        documents.set(id, current);
        if (base) {
          bases.set(id, base);
        }
        throw failure;
      }
      return edited.version;
    },
    version: (id) => {
      const document = documents.get(id);
      return document && !deleted.has(id) ? kind.version(document) : null;
    },
    importValue: async (value, document) => {
      assertSavable(value.id);
      if (!documents.has(value.id)) {
        documents.set(value.id, document(value));
        bases.set(value.id, value);
      }
      await persist(value.id);
    },
    remove: async (id, deletedAt) => {
      assertWritable(id);
      documents.set(id, kind.tombstone(id, deletedAt));
      deleted.add(id);
      bases.delete(id);
      await persist(id);
    },
    flush: async () => {
      await Promise.all(
        [...writes.values()].map((write) => write.catch(() => undefined)),
      );
    },
    values: () => [...bases.values()],
    value: (id) => bases.get(id),
    ids: () => (loaded ? [...persisted.keys()] : []),
    // What is on disk, so a save that failed is never shared with other
    // devices as if it had happened.
    document: (id) => (loaded ? persisted.get(id) : undefined),
    isDeleted: (id) => deleted.has(id),
    merge: (id, remote) => {
      const nothing: MergedOf<S> = {
        state: null,
        written: Promise.resolve(null),
        kept: false,
      };
      const incoming = kind.read(remote);
      if (!loaded || !kind.isId(id) || !incoming || incoming.id !== id) {
        return nothing;
      }
      const current = documents.get(id);
      const merged = current ? kind.merge(current, remote) : remote;
      const state = kind.read(merged);
      if (!state) {
        return nothing;
      }
      if (current && kind.same(current, merged)) {
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
      const written = files.setAside(id).then(
        () => {
          damaged.delete(id);
          return persist(id).then(() => state);
        },
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
