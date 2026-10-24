import path from 'node:path';
import type { Cipher } from '@nod/core/meetings';
import {
  createSharingSession,
  createTeamRelay,
  fetchInviteFile,
  singleFileOf,
  type SharedPlace,
  type SharingSession,
  type TeamFiles,
} from '@nod/core/sharing';
import type { Fetch } from '@nod/core/sync';
import { meetingFiles } from '../meetings/store.ts';
import type { PublishedLogs } from '../sync/published-log.ts';

export type { SharedPlace };

export type SharingController = SharingSession;

// The shares list, a team's members and its list are each one file in
// their folder, written the way a meeting is, so they are as durable.
function teamFilesIn(directory: string): TeamFiles {
  const files = meetingFiles(directory);
  return {
    notes: meetingFiles(path.join(directory, 'notes')),
    members: singleFileOf(files, 'members'),
    list: singleFileOf(files, 'list'),
  };
}

export function createSharingController(options: {
  directory: string;
  cipher: () => Promise<Cipher>;
  publishedLogs?: PublishedLogs;
  fetch: Fetch;
  newId: () => string;
  now: () => number;
  onChange: () => void;
}): SharingController {
  const { publishedLogs, fetch, now } = options;
  return createSharingSession({
    sharesFileFor: (vaultId) =>
      singleFileOf(
        meetingFiles(path.join(options.directory, vaultId)),
        'shares',
      ),
    noteFilesFor: (vaultId) =>
      meetingFiles(path.join(options.directory, 'shared', vaultId)),
    teamFilesFor: (vaultId) =>
      teamFilesIn(path.join(options.directory, 'teams', vaultId)),
    relays: {
      open: async (host, vaultId, identity) =>
        createTeamRelay({ url: host, vaultId, identity, fetch, now }),
      fetchInvite: (link) => fetchInviteFile(link, fetch, now),
    },
    cipher: options.cipher,
    publishedLogFor: publishedLogs
      ? (scope) => publishedLogs.open(scope)
      : undefined,
    newId: options.newId,
    now: options.now,
    onChange: options.onChange,
  });
}
