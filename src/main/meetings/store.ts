import { readFile, rename, writeFile } from 'node:fs/promises';
import {
  parseMeetings,
  serializeMeetings,
  type Meeting,
} from '../../core/meetings/index.ts';

export type Cipher = {
  encrypt: (plain: string) => Buffer;
  decrypt: (data: Buffer) => string;
};

export type MeetingStore = {
  load: () => Promise<Meeting[]>;
  save: (meetings: Meeting[]) => Promise<void>;
  flush: () => Promise<void>;
};

export function createMeetingStore(file: string, cipher: Cipher): MeetingStore {
  let pending: Promise<unknown> = Promise.resolve();
  let latest: Meeting[] | null = null;

  async function load(): Promise<Meeting[]> {
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return [];
      }
      throw error;
    }
    return parseMeetings(JSON.parse(cipher.decrypt(data)));
  }

  async function write(meetings: Meeting[]): Promise<void> {
    const temporary = `${file}.tmp`;
    await writeFile(
      temporary,
      cipher.encrypt(JSON.stringify(serializeMeetings(meetings))),
    );
    await rename(temporary, file);
  }

  // A save that a newer one has already replaced is skipped, so a slow disk
  // never builds a backlog of whole-file writes.
  function save(meetings: Meeting[]): Promise<void> {
    latest = meetings;
    const result = pending.then(() =>
      latest === meetings ? write(meetings) : undefined,
    );
    pending = result.catch(() => undefined);
    return result;
  }

  return {
    load,
    save,
    flush: () => pending.then(() => undefined),
  };
}
