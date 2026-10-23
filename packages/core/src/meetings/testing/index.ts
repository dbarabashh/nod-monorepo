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

export const plainCipher: Cipher = {
  encrypt: (plain) => plain,
  decrypt: (data) => data,
};
