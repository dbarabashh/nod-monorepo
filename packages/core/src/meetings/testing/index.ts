import type { Cipher, MeetingFiles } from '../index.ts';

export type MemoryFiles = MeetingFiles & {
  stored: Map<string, Uint8Array>;
  // The ids set aside, in order; a file set aside is gone from `stored`.
  asideIds: string[];
};

export function memoryFiles(): MemoryFiles {
  const stored = new Map<string, Uint8Array>();
  const asideIds: string[] = [];
  return {
    stored,
    asideIds,
    ids: async () => [...stored.keys()],
    read: async (id) => {
      const data = stored.get(id);
      if (!data) {
        throw new Error('missing');
      }
      return data;
    },
    write: async (id, data) => {
      stored.set(id, data);
    },
    setAside: async (id) => {
      asideIds.push(id);
      stored.delete(id);
    },
  };
}

// One document's file in memory: null until written, gone once set aside.
export function memorySingleFile(): {
  read: () => Promise<Uint8Array | null>;
  write: (data: Uint8Array) => Promise<void>;
  setAside: () => Promise<void>;
} {
  let data: Uint8Array | null = null;
  return {
    read: async () => data,
    write: async (next) => {
      data = next;
    },
    setAside: async () => {
      data = null;
    },
  };
}

export const plainCipher: Cipher = {
  encrypt: (plain) => plain,
  decrypt: (data) => data,
};
