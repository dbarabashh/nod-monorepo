export type RemoteFile = {
  path: string;
  version: string;
  changedAt: number;
};

// Stores opaque, already encrypted files. It never merges and never sees
// what is inside them.
export type Transport = {
  list: (prefix: string) => Promise<RemoteFile[]>;
  read: (path: string, maxBytes: number) => Promise<Uint8Array | null>;
  write: (path: string, data: Uint8Array) => Promise<void>;
  remove: (path: string) => Promise<void>;
};

// The place takes no more writes for the whole vault for now (a rate limit,
// a full quota): trying the next file in the same round would only fail too.
export class WritesRefused extends Error {}

export function assertSafePath(path: string): string[] {
  const parts = path.split('/');
  if (
    parts.length === 0 ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe sync path: ${path}`);
  }
  return parts;
}
