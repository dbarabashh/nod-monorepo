import { open, readFile, rename } from 'node:fs/promises';
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

  // Without the sync, a power cut right after the rename can leave an empty
  // file in place of every meeting on some filesystems.
  async function write(meetings: Meeting[]): Promise<void> {
    const temporary = `${file}.tmp`;
    const handle = await open(temporary, 'w');
    try {
      await handle.writeFile(
        cipher.encrypt(JSON.stringify(serializeMeetings(meetings))),
      );
      await handle.datasync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  }

  type Queued = { meetings: Meeting[]; written: Promise<void> };
  let queued: Queued | null = null;

  // Saves that arrive while a write is running share the next write, so a
  // slow disk never builds a backlog and each save reports that write's result.
  function save(meetings: Meeting[]): Promise<void> {
    if (queued) {
      queued.meetings = meetings;
      return queued.written;
    }
    const entry: Queued = { meetings, written: Promise.resolve() };
    entry.written = pending.then(() => {
      queued = null;
      return write(entry.meetings);
    });
    queued = entry;
    pending = entry.written.catch(() => undefined);
    return entry.written;
  }

  return {
    load,
    save,
    flush: () => pending.then(() => undefined),
  };
}
