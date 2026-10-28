import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

// The earlier Swift app of the same name keeps its own files in
// Application Support/Nod, so on macOS this app keeps everything in a folder
// of its own.
export const dataFolderName = 'Nod Desktop';

// The data key moves last: while it is still in the old folder, a move that
// stopped part way is finished on the next start.
function ownEntries(modelIds: readonly string[]): string[] {
  return [
    'app-state.json',
    'sync.json',
    'mcp.bin',
    'meetings',
    'published',
    'sharing',
    ...modelIds.map((id) => path.join('models', id)),
    'keys',
  ];
}

// A failed move is undone, or stops the app when even that fails, so meetings
// never end up in one folder and the key that opens them in another.
export function moveDataFolder(
  from: string,
  to: string,
  modelIds: readonly string[],
): 'moved' | 'kept' | 'stuck' {
  if (existsSync(path.join(to, 'keys'))) {
    return 'moved';
  }
  const moved: string[] = [];
  for (const entry of ownEntries(modelIds)) {
    const source = path.join(from, entry);
    const target = path.join(to, entry);
    if (!existsSync(source) || existsSync(target)) {
      continue;
    }
    try {
      mkdirSync(path.dirname(target), { recursive: true });
      renameSync(source, target);
      moved.push(entry);
    } catch (error) {
      console.error(`Could not move ${entry} to ${to}`, error);
      for (const back of moved.reverse()) {
        try {
          renameSync(path.join(to, back), path.join(from, back));
        } catch (undo) {
          console.error(`Could not move ${back} back to ${from}`, undo);
          return 'stuck';
        }
      }
      return 'kept';
    }
  }
  return 'moved';
}
