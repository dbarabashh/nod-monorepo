import path from 'node:path';
import type { Cipher } from '@nod/core/meetings';
import {
  createSharingSession,
  type SharedPlace,
  type SharesFile,
  type SharingSession,
} from '@nod/core/sharing';
import { meetingFiles } from '../meetings/store.ts';
import type { PublishedLogs } from '../sync/published-log.ts';

export type { SharedPlace };

export type SharingController = SharingSession;

const sharesName = 'shares';

// The shares list is one file in the vault's folder, written the way a
// meeting is, so it is as durable.
function sharesFileIn(directory: string): SharesFile {
  const files = meetingFiles(directory);
  return {
    read: async () =>
      (await files.ids()).includes(sharesName) ? files.read(sharesName) : null,
    write: (data) => files.write(sharesName, data),
    setAside: () => files.setAside(sharesName),
  };
}

export function createSharingController(options: {
  directory: string;
  cipher: () => Promise<Cipher>;
  publishedLogs?: PublishedLogs;
  newId: () => string;
  now: () => number;
  onChange: () => void;
}): SharingController {
  const { publishedLogs } = options;
  return createSharingSession({
    sharesFileFor: (vaultId) =>
      sharesFileIn(path.join(options.directory, vaultId)),
    noteFilesFor: (vaultId) =>
      meetingFiles(path.join(options.directory, 'shared', vaultId)),
    cipher: options.cipher,
    publishedLogFor: publishedLogs
      ? (scope) => publishedLogs.open(scope)
      : undefined,
    newId: options.newId,
    now: options.now,
    onChange: options.onChange,
  });
}
