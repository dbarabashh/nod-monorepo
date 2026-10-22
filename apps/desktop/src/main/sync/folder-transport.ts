import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  assertSafePath,
  type RemoteFile,
  type Transport,
  UnreadableFile,
  WritesRefused,
} from '@nod/core/sync';

const temporaryMarker = '.tmp-';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function diskFull(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOSPC' || error.code === 'EDQUOT')
  );
}

export function createFolderTransport(root: string): Transport {
  // Anyone else syncing the folder could plant a link that points back into
  // this device's own files, so nothing below the root may be a link.
  async function resolve(relative: string): Promise<string> {
    const parts = assertSafePath(relative);
    let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new Error(`Refused a link in the sync folder: ${relative}`);
        }
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }
    }
    return current;
  }

  async function walk(relative: string): Promise<RemoteFile[]> {
    let entries;
    try {
      entries = await readdir(
        path.join(root, ...relative.split('/').filter(Boolean)),
        {
          withFileTypes: true,
        },
      );
    } catch (error) {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    }
    const files: RemoteFile[] = [];
    for (const entry of entries) {
      const child = `${relative}${entry.name}`;
      if (entry.isDirectory()) {
        files.push(...(await walk(`${child}/`)));
      } else if (entry.isFile() && !entry.name.includes(temporaryMarker)) {
        const info = await stat(path.join(root, ...child.split('/')));
        files.push({
          path: child,
          version: `${info.mtimeMs}-${info.size}`,
          changedAt: info.mtimeMs,
        });
      }
    }
    return files;
  }

  return {
    list: async (prefix) => {
      if (prefix !== '') {
        assertSafePath(prefix.replace(/\/$/, ''));
      }
      return walk(prefix);
    },
    read: async (relative, maxBytes) => {
      const target = await resolve(relative);
      try {
        if ((await stat(target)).size > maxBytes) {
          throw new UnreadableFile(
            `A sync file is larger than expected: ${relative}`,
          );
        }
        return await readFile(target);
      } catch (error) {
        if (isMissing(error)) {
          return null;
        }
        throw error;
      }
    },
    // Another device may read at any moment, so a file only appears once it
    // is complete.
    write: async (relative, data) => {
      const target = await resolve(relative);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}${temporaryMarker}${randomUUID()}`;
      try {
        await writeFile(temporary, data);
      } catch (error) {
        await rm(temporary, { force: true });
        throw diskFull(error)
          ? new WritesRefused('The sync folder’s disk is full')
          : error;
      }
      await rename(temporary, target);
      const info = await stat(target);
      return `${info.mtimeMs}-${info.size}`;
    },
    remove: async (relative) => {
      await rm(await resolve(relative), { force: true });
    },
  };
}
