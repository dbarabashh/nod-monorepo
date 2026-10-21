import type { Meeting } from '../types.ts';

export type FolderCount = { name: string; count: number };

export function folderCounts(
  meetings: Meeting[],
  locale: string,
): FolderCount[] {
  const counts = new Map<string, number>();
  for (const meeting of meetings) {
    if (meeting.folder !== null) {
      counts.set(meeting.folder, (counts.get(meeting.folder) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, locale, { sensitivity: 'base' }),
    );
}

export function matchingFolders(names: string[], query: string): string[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle === ''
    ? names
    : names.filter((name) => name.toLocaleLowerCase().includes(needle));
}

export const folderNameMaxLength = 80;

export function cleanFolderName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function comparable(name: string): string {
  return cleanFolderName(name).toLocaleLowerCase();
}

export function existingFolder(
  names: string[],
  query: string,
): string | undefined {
  const needle = comparable(query);
  return names.find((name) => comparable(name) === needle);
}
