import { mkdir, open, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  createMeetingStore as createStore,
  type Cipher,
  type MeetingFiles,
  type MeetingStore,
} from '@nod/core/meetings';

export {
  isMeetingId,
  type Cipher,
  type MeetingStore,
} from '@nod/core/meetings';

const fileSuffix = '.bin';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function meetingFiles(directory: string): MeetingFiles {
  const fileOf = (id: string) => path.join(directory, `${id}${fileSuffix}`);
  return {
    ids: async () => {
      try {
        return (await readdir(directory))
          .filter((name) => name.endsWith(fileSuffix))
          .map((name) => name.slice(0, -fileSuffix.length));
      } catch (error) {
        if (isMissing(error)) {
          return [];
        }
        throw error;
      }
    },
    read: (id) => readFile(fileOf(id)),
    write: async (id, data) => {
      await mkdir(directory, { recursive: true });
      const temporary = `${fileOf(id)}.tmp`;
      const handle = await open(temporary, 'w');
      try {
        await handle.writeFile(data);
        // Without the sync, a power cut right after the rename can leave an
        // empty file on some filesystems.
        await handle.datasync();
      } finally {
        await handle.close();
      }
      await rename(temporary, fileOf(id));
    },
    setAside: (id) => rename(fileOf(id), `${fileOf(id)}.damaged-${Date.now()}`),
  };
}

export function createMeetingStore(options: {
  directory: string;
  cipher: (hasStoredMeetings: boolean) => Promise<Cipher>;
  onWrite?: (id: string) => void;
}): MeetingStore {
  return createStore({
    files: meetingFiles(options.directory),
    // The data key lives in the keychain with no second place to start over
    // in, so a key that can't be read is never replaced here.
    cipher: (mode) => {
      if (mode === 'replace') {
        throw new Error('Saved meetings can’t start over on this device');
      }
      return options.cipher(mode === 'open');
    },
    onWrite: options.onWrite,
  });
}
