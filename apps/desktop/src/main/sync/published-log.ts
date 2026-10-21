import { readFile } from 'node:fs/promises';
import {
  createPublishedLog,
  readPublishedEntries,
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

export function createPublishedLogs(file: string, saveDelayMs = 1_000) {
  let saving: Promise<void> = Promise.resolve();
  return {
    open: async (scope: string): Promise<PublishedLog> =>
      createPublishedLog({
        scope,
        entries: readPublishedEntries(await readStored(file), scope),
        delayMs: saveDelayMs,
        save: (data) => {
          saving = saving
            .then(() => writeAtomically(file, data))
            .catch(() => undefined);
        },
      }),
    flushed: () => saving,
  };
}

export type PublishedLogs = ReturnType<typeof createPublishedLogs>;
