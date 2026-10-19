import { assertSafePath, type Transport } from '../transport.ts';

export function createMemoryTransport(): Transport {
  const files = new Map<string, { data: Uint8Array; changedAt: number }>();
  let writes = 0;

  return {
    list: async (prefix) =>
      [...files]
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, file]) => ({
          path,
          version: `${file.changedAt}-${file.data.length}`,
          changedAt: file.changedAt,
        })),
    read: async (path, maxBytes) => {
      assertSafePath(path);
      const file = files.get(path);
      if (file && file.data.length > maxBytes) {
        throw new Error(`A sync file is larger than expected: ${path}`);
      }
      return file ? file.data.slice() : null;
    },
    write: async (path, data) => {
      assertSafePath(path);
      writes += 1;
      files.set(path, { data: data.slice(), changedAt: Date.now() + writes });
    },
    remove: async (path) => {
      assertSafePath(path);
      files.delete(path);
    },
  };
}
