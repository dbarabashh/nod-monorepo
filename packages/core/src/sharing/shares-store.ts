import { sameHeads, type Cipher, type MergedOf } from '../meetings/index.ts';
import {
  addPeer,
  createSharesDocument,
  loadSharesDocument,
  mergeSharesDocuments,
  readSharesDocument,
  saveSharesDocument,
  sharesId,
  stopPeer,
  type Shares,
  type SharesDocument,
} from './shares-document.ts';

// The one file that holds whom this person shares with, sealed with the same
// local key as meetings; each app keeps it over its own filesystem.
export type SharesFile = {
  read: () => Promise<Uint8Array | null>;
  write: (data: Uint8Array) => Promise<void>;
  // Keeps a file that couldn't be read beside what replaces it.
  setAside: () => Promise<void>;
};

export type SharesStore = {
  load: () => Promise<Shares>;
  shares: () => Shares;
  addPeer: (card: string) => Promise<Shares>;
  stopPeer: (identity: string, at: number) => Promise<Shares>;
  ids: () => string[];
  document: (id: string) => SharesDocument | undefined;
  merge: (id: string, remote: SharesDocument) => MergedOf<Shares>;
};

const context = 'nod:shares';

export function createSharesStore(options: {
  file: SharesFile;
  cipher: Cipher;
}): SharesStore {
  const { file, cipher } = options;
  let document = createSharesDocument();
  let persisted: SharesDocument | null = null;
  let state: Shares = { peers: [], teams: [] };
  let loaded = false;
  let damaged = false;
  let writing: Promise<void> = Promise.resolve();

  function persist(): Promise<void> {
    const toWrite = document;
    const write = writing.then(async () => {
      await file.write(cipher.encrypt(saveSharesDocument(toWrite), context));
      persisted = toWrite;
    });
    writing = write.catch(() => undefined);
    return write;
  }

  async function change(
    next: (current: SharesDocument) => SharesDocument,
  ): Promise<Shares> {
    if (!loaded) {
      throw new Error('Saved shares could not be read');
    }
    // A file that couldn't be read is never overwritten, so it can still be
    // recovered; a healthy copy from another device replaces it.
    if (damaged) {
      throw new Error('The saved shares could not be read');
    }
    document = next(document);
    state = readSharesDocument(document) ?? state;
    await persist();
    return state;
  }

  return {
    load: async () => {
      const stored = await file.read();
      if (stored) {
        let read: ReturnType<typeof loadSharesDocument> = null;
        try {
          read = loadSharesDocument(cipher.decrypt(stored, context));
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
    shares: () => state,
    addPeer: (card) => change((current) => addPeer(current, card)),
    stopPeer: (identity, at) =>
      change((current) => stopPeer(current, identity, at)),
    ids: () => (loaded && persisted ? [sharesId] : []),
    document: (id) =>
      loaded && id === sharesId ? (persisted ?? undefined) : undefined,
    merge: (id, remote) => {
      const nothing: MergedOf<Shares> = {
        state: null,
        written: Promise.resolve(null),
        kept: false,
      };
      if (!loaded || id !== sharesId || !readSharesDocument(remote)) {
        return nothing;
      }
      const merged = mergeSharesDocuments(document, remote);
      const next = readSharesDocument(merged);
      if (!next) {
        return nothing;
      }
      if (sameHeads(merged, document) && persisted) {
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
          document = createSharesDocument();
          state = { peers: [], teams: [] };
          throw failure;
        },
      );
      return { state: null, written, kept: true };
    },
  };
}
