import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createPublishedLog,
  publishedLogFile,
  readPublishedEntries,
  readReceivedEntries,
  type PublishedLog,
} from '@nod/core/sync';
import { writeAtomically } from '../storage/write-atomically.ts';

async function readStored(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// One file per scope in the directory, so the logs of the vault, its shares
// and each shared vault live side by side.
export function createPublishedLogs(directory: string, saveDelayMs = 1_000) {
  const saving = new Map<string, Promise<void>>();
  return {
    open: async (scope: string): Promise<PublishedLog> => {
      const file = path.join(directory, publishedLogFile(scope));
      const stored = await readStored(file);
      return createPublishedLog({
        scope,
        entries: readPublishedEntries(stored, scope),
        received: readReceivedEntries(stored, scope),
        delayMs: saveDelayMs,
        save: (data) => {
          saving.set(
            file,
            (saving.get(file) ?? Promise.resolve())
              .then(() => writeAtomically(file, data))
              .catch(() => undefined),
          );
        },
      });
    },
    flushed: async () => {
      await Promise.all(saving.values());
    },
  };
}

export type PublishedLogs = ReturnType<typeof createPublishedLogs>;
