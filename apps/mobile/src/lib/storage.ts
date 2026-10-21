import { Directory, File, Paths } from 'expo-file-system';
import { BackupExclusion } from '../../modules/backup-exclusion/index.ts';

// Everything the app keeps on the phone, named in one place so all of it is
// kept out of backups: a backup is a copy outside the user's sync.
export const meetingsDirectory = () =>
  new Directory(Paths.document, 'meetings');
export const modelsDirectory = () => new Directory(Paths.document, 'models');
export const keySlotFile = () => new File(Paths.document, 'data-key-slot');
export const publishedFile = () => new File(Paths.document, 'published.json');
export const recordingFile = () => new File(Paths.document, 'recording.json');

// A file replaced by a move loses the flag, so files are marked after every
// write; a folder keeps it, and it covers everything inside it.
export async function keepOutOfBackup(item: File | Directory): Promise<void> {
  if (!BackupExclusion || !item.exists) {
    return;
  }
  const excluded = await BackupExclusion.exclude(item.uri).catch(() => false);
  if (!excluded && __DEV__) {
    console.warn(`Not kept out of backups: ${item.uri}`);
  }
}

export async function ensureDirectory(directory: Directory): Promise<void> {
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  await keepOutOfBackup(directory);
}

// Run at every launch, which also covers what earlier versions wrote. The
// documents folder itself is marked too, for anything not named here.
export async function keepStorageOutOfBackup(): Promise<void> {
  await Promise.all([
    keepOutOfBackup(new Directory(Paths.document)),
    ensureDirectory(meetingsDirectory()),
    ensureDirectory(modelsDirectory()),
    keepOutOfBackup(keySlotFile()),
    keepOutOfBackup(publishedFile()),
    keepOutOfBackup(recordingFile()),
  ]);
}
