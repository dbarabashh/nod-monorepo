import type { PublishedEntry, PublishedLog } from './engine.ts';

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

// What a device stores to remember which versions it published: version
// hashes and the place's version tags only, never content, for one scope
// (vault, device id and place) at a time. Losing it only costs writing each
// meeting once more, so anything unreadable starts empty.
export function readPublishedEntries(
  raw: unknown,
  scope: string,
): Map<string, PublishedEntry> {
  const entries = new Map<string, PublishedEntry>();
  if (typeof raw !== 'object' || raw === null) {
    return entries;
  }
  const stored: unknown = Reflect.get(raw, 'entries');
  if (
    Reflect.get(raw, 'scope') !== scope ||
    typeof stored !== 'object' ||
    stored === null
  ) {
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

// Saves at most once per delay, since a round can publish many meetings. A
// copy whose listed version is still unknown is left out, so after a restart
// it is written once more rather than trusted as current.
export function createPublishedLog(options: {
  scope: string;
  entries: Map<string, PublishedEntry>;
  save: (data: string) => void;
  delayMs: number;
}): PublishedLog {
  const { scope, entries, save, delayMs } = options;
  let pending: ReturnType<typeof setTimeout> | null = null;
  return {
    get: (id) => entries.get(id),
    set: (id, entry) => {
      entries.set(id, entry);
      pending ??= setTimeout(() => {
        pending = null;
        const settled = [...entries].filter(([, { version }]) => version);
        save(JSON.stringify({ scope, entries: Object.fromEntries(settled) }));
      }, delayMs);
    },
  };
}
