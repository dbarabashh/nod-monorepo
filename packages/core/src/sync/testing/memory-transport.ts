import {
  assertSafePath,
  UnreadableFile,
  type Transport,
} from '../transport.ts';

export function createMemoryTransport(): Transport & {
  paths: () => string[];
} {
  const files = new Map<string, { data: Uint8Array; changedAt: number }>();
  let writes = 0;

  return {
    paths: () => [...files.keys()],
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
        throw new UnreadableFile(
          `A sync file is larger than expected: ${path}`,
        );
      }
      return file ? file.data.slice() : null;
    },
    write: async (path, data) => {
      assertSafePath(path);
      writes += 1;
      const file = { data: data.slice(), changedAt: Date.now() + writes };
      files.set(path, file);
      return `${file.changedAt}-${file.data.length}`;
    },
    remove: async (path) => {
      assertSafePath(path);
      files.delete(path);
    },
  };
}
