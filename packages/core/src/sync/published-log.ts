import { sha256 } from '@noble/hashes/sha2.js';
import { bytesOf, toHex } from '../crypto/encoding.ts';
import type {
  PublishedEntry,
  PublishedLog,
  ReceivedEntry,
  ReceivedLog,
} from './engine.ts';

// One file per scope, so the logs of a vault, its shares and each shared
// vault never overwrite one another. A scope names a relay address, which
// no filesystem takes as a name, so the file is named by its hash.
export function publishedLogFile(scope: string): string {
  return `${toHex(sha256(bytesOf(scope))).slice(0, 32)}.json`;
}

function entryOf(value: unknown): PublishedEntry | null {
  // Entries written before the place's version was kept name the heads only.
  if (typeof value === 'string') {
    return { heads: value, version: null };
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const heads = Reflect.get(value, 'heads');
  const version = Reflect.get(value, 'version');
  if (typeof heads !== 'string' || typeof version !== 'string') {
    return null;
  }
  return { heads, version };
}

function receivedOf(value: unknown): ReceivedEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const version = Reflect.get(value, 'version');
  const heads = Reflect.get(value, 'heads');
  if (typeof version !== 'string' || typeof heads !== 'string') {
    return null;
  }
  return { version, heads };
}

function section(raw: unknown, scope: string, name: string): unknown {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const stored: unknown = Reflect.get(raw, name);
  return Reflect.get(raw, 'scope') === scope &&
    typeof stored === 'object' &&
    stored !== null
    ? stored
    : null;
}

// What a device stores to remember which versions it published: version
// hashes and the place's version tags only, never content, for one scope
// (vault, device id and place) at a time. Losing it only costs writing each
// meeting once more, so anything unreadable starts empty.
export function readPublishedEntries(
  raw: unknown,
  scope: string,
): Map<string, PublishedEntry> {
  const entries = new Map<string, PublishedEntry>();
  const stored = section(raw, scope, 'entries');
  if (!stored) {
    return entries;
  }
  for (const [id, value] of Object.entries(stored)) {
    const entry = entryOf(value);
    if (entry) {
      entries.set(id, entry);
    }
  }
  return entries;
}

// Likewise for what it read of other devices' files, by path. Losing it only
// costs reading each file once more.
export function readReceivedEntries(
  raw: unknown,
  scope: string,
): Map<string, ReceivedEntry> {
  const entries = new Map<string, ReceivedEntry>();
  const stored = section(raw, scope, 'received');
  if (!stored) {
    return entries;
  }
  for (const [path, value] of Object.entries(stored)) {
    const entry = receivedOf(value);
    if (entry) {
      entries.set(path, entry);
    }
  }
  return entries;
}

// Saves at most once per delay, since a round can publish many meetings. A
// copy whose listed version is still unknown is left out, so after a restart
// it is written once more rather than trusted as current.
export function createPublishedLog(options: {
  scope: string;
  entries: Map<string, PublishedEntry>;
  received?: Map<string, ReceivedEntry>;
  save: (data: string) => void;
  delayMs: number;
}): PublishedLog {
  const { scope, entries, save, delayMs } = options;
  const received = options.received ?? new Map<string, ReceivedEntry>();
  let pending: ReturnType<typeof setTimeout> | null = null;
  function later() {
    pending ??= setTimeout(() => {
      pending = null;
      const settled = [...entries].filter(([, { version }]) => version);
      save(
        JSON.stringify({
          scope,
          entries: Object.fromEntries(settled),
          received: Object.fromEntries(received),
        }),
      );
    }, delayMs);
  }
  const receivedLog: ReceivedLog = {
    get: (path) => received.get(path),
    set: (path, entry) => {
      received.set(path, entry);
      later();
    },
    prune: (stale) => {
      for (const path of received.keys()) {
        if (stale(path)) {
          received.delete(path);
          later();
        }
      }
    },
  };
  return {
    get: (id) => entries.get(id),
    set: (id, entry) => {
      entries.set(id, entry);
      later();
    },
    received: receivedLog,
  };
}
