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
  // Answers with the version the listing will show the file under, when the
  // place says so at once; null when only a later listing can tell.
  write: (path: string, data: Uint8Array) => Promise<string | null>;
  remove: (path: string) => Promise<void>;
};

// The place takes no more writes for the whole vault for now (a full quota):
// trying the next file in the same round would only fail too.
export class WritesRefused extends Error {}

// The longest a device waits on the place's word; a wait that would reach
// further than that came from a clock that jumped, and is dropped.
export const maxWaitMs = 10 * 60_000;

export function stillWaiting(until: number, now: number): boolean {
  const remaining = until - now;
  return remaining > 0 && remaining <= maxWaitMs;
}

// The place takes no more requests from this device for now (a rate limit on
// it, or in front of it): the rest of the round would only be refused, and
// asking again before the wait is over keeps the limit tripped.
export class Throttled extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

// This version of the file can't be read by anyone, however often it is
// fetched (too large, or not sealed for this place), so it is left alone
// until the place lists another version of it.
export class UnreadableFile extends Error {}

// A place answered a request with a refusal that isn't about waiting or
// room: the status says what it wouldn't do.
export class RequestRefused extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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
