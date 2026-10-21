import type { PublishedLog } from './engine.ts';

// What a device stores to remember which versions it published: version
// hashes only, never content, for one scope (vault, device id and place) at
// a time. Losing it only costs writing each meeting once more, so anything
// unreadable starts empty.
export function readPublishedEntries(
  raw: unknown,
  scope: string,
): Map<string, string> {
  const entries = new Map<string, string>();
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
  for (const [id, heads] of Object.entries(stored)) {
    if (typeof heads === 'string') {
      entries.set(id, heads);
    }
  }
  return entries;
}

// Saves at most once per delay, since a round can publish many meetings.
export function createPublishedLog(options: {
  scope: string;
  entries: Map<string, string>;
  save: (data: string) => void;
  delayMs: number;
}): PublishedLog {
  const { scope, entries, save, delayMs } = options;
  let pending: ReturnType<typeof setTimeout> | null = null;
  return {
    get: (id) => entries.get(id),
    set: (id, heads) => {
      entries.set(id, heads);
      pending ??= setTimeout(() => {
        pending = null;
        save(JSON.stringify({ scope, entries: Object.fromEntries(entries) }));
      }, delayMs);
    },
  };
}
