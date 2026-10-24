import type { Cipher, MergedOf } from '../meetings/index.ts';

// One document kept in one file: the shares list, a team's member names.
// Each app keeps the file over its own filesystem.
export type SingleFile = {
  read: () => Promise<Uint8Array | null>;
  write: (data: Uint8Array) => Promise<void>;
  // Keeps a file that couldn't be read beside what replaces it.
  setAside: () => Promise<void>;
};

// One named entry of a files store, for a document that is the only one of
// its kind in a folder (a shares list, a team's member names).
export function singleFileOf(
  files: {
    ids: () => Promise<string[]>;
    read: (id: string) => Promise<Uint8Array>;
    write: (id: string, data: Uint8Array) => Promise<void>;
    setAside: (id: string) => Promise<void>;
  },
  name: string,
): SingleFile {
  return {
    read: async () =>
      (await files.ids()).includes(name) ? files.read(name) : null,
    write: (data) => files.write(name, data),
    setAside: () => files.setAside(name),
  };
}

export type SingleDocumentKind<D, S> = {
  name: string;
  id: string;
  context: string;
  create: () => D;
  read: (document: D) => S | null;
  empty: () => S;
  merge: (local: D, remote: D) => D;
  same: (a: D, b: D) => boolean;
  save: (document: D) => Uint8Array;
  load: (bytes: Uint8Array) => { document: D; state: S } | null;
};

export type SingleDocumentStore<D, S> = {
  load: () => Promise<S>;
  state: () => S;
  change: (next: (current: D) => D) => Promise<S>;
  ids: () => string[];
  document: (id: string) => D | undefined;
  merge: (id: string, remote: D) => MergedOf<S>;
};

export function createSingleDocumentStore<D, S>(options: {
  file: SingleFile;
  cipher: Cipher;
  kind: SingleDocumentKind<D, S>;
}): SingleDocumentStore<D, S> {
  const { file, cipher, kind } = options;
  let document = kind.create();
  let persisted: D | null = null;
  let state: S = kind.empty();
  let loaded = false;
  let damaged = false;
  let writing: Promise<void> = Promise.resolve();

  function persist(): Promise<void> {
    const toWrite = document;
    const write = writing.then(async () => {
      await file.write(cipher.encrypt(kind.save(toWrite), kind.context));
      persisted = toWrite;
    });
    writing = write.catch(() => undefined);
    return write;
  }

  return {
    load: async () => {
      const stored = await file.read();
      if (stored) {
        let read: ReturnType<typeof kind.load> = null;
        try {
          read = kind.load(cipher.decrypt(stored, kind.context));
        } catch {
          read = null;
        }
        if (read) {
          document = read.document;
          persisted = read.document;
          state = read.state;
        } else {
          damaged = true;
        }
      }
      loaded = true;
      return state;
    },
    state: () => state,
    change: async (next) => {
      if (!loaded) {
        throw new Error(`The saved ${kind.name} could not be read`);
      }
      // A file that couldn't be read is never overwritten, so it can still be
      // recovered; a healthy copy from another device replaces it.
      if (damaged) {
        throw new Error(`The saved ${kind.name} could not be read`);
      }
      document = next(document);
      state = kind.read(document) ?? state;
      await persist();
      return state;
    },
    ids: () => (loaded && persisted ? [kind.id] : []),
    document: (id) =>
      loaded && id === kind.id ? (persisted ?? undefined) : undefined,
    merge: (id, remote) => {
      const nothing: MergedOf<S> = {
        state: null,
        written: Promise.resolve(null),
        kept: false,
      };
      if (!loaded || id !== kind.id || !kind.read(remote)) {
        return nothing;
      }
      const merged = kind.merge(document, remote);
      const next = kind.read(merged);
      if (!next) {
        return nothing;
      }
      if (kind.same(merged, document) && persisted) {
        return { state: null, written: Promise.resolve(null), kept: true };
      }
      document = merged;
      state = next;
      if (!damaged) {
        return {
          state: next,
          written: persist().then(() => null),
          kept: true,
        };
      }
      const written = file.setAside().then(
        () => {
          damaged = false;
          return persist().then(() => next);
        },
        (failure: unknown) => {
          document = kind.create();
          state = kind.empty();
          throw failure;
        },
      );
      return { state: null, written, kept: true };
    },
  };
}
