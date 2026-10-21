import { readFile, rename } from 'node:fs/promises';
import { isScope } from '@nod/core/mcp';
import type { KeyWrap } from '../security/data-key.ts';
import { writeAtomically } from '../storage/write-atomically.ts';
import type { McpClient } from './auth.ts';

export type McpSettings = { enabled: boolean; clients: McpClient[] };

export type LoadedSettings = {
  settings: McpSettings;
  problem: 'set-aside' | 'unavailable' | null;
};

export type McpSettingsFile = {
  load: () => Promise<LoadedSettings>;
  save: (settings: McpSettings) => Promise<void>;
};

const off: McpSettings = { enabled: false, clients: [] };

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

function parseClient(raw: unknown): McpClient | null {
  const id = field(raw, 'id');
  const name = field(raw, 'name');
  const scopes = field(raw, 'scopes');
  const keyHash = field(raw, 'keyHash');
  const createdAt = field(raw, 'createdAt');
  const lastUsedAt = field(raw, 'lastUsedAt') ?? null;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    !Array.isArray(scopes) ||
    !scopes.every(isScope) ||
    typeof keyHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(keyHash) ||
    typeof createdAt !== 'number' ||
    !(lastUsedAt === null || typeof lastUsedAt === 'number')
  ) {
    return null;
  }
  return { id, name, scopes, keyHash, createdAt, lastUsedAt };
}

export function parseMcpSettings(raw: unknown): McpSettings {
  const clients = field(raw, 'clients');
  return {
    enabled: field(raw, 'enabled') === true,
    clients: Array.isArray(clients)
      ? clients.map(parseClient).filter((client) => client !== null)
      : [],
  };
}

// Sealed with the OS keychain, like the data key: a program that could write
// this file could otherwise add an assistant of its own and read every
// meeting without ever touching the keychain. A file that doesn't open is
// moved aside rather than overwritten. A keychain that isn't ready (a locked
// keyring, a declined prompt) leaves the file alone and refuses to save, so
// the stand-in "off" settings never replace the real ones.
export function createMcpSettingsFile(
  file: string,
  keychain: KeyWrap & { available: () => boolean },
  now: () => number = Date.now,
): McpSettingsFile {
  let readOnly = false;
  return {
    load: async () => {
      readOnly = false;
      let data: Buffer;
      try {
        data = await readFile(file);
      } catch {
        return { settings: off, problem: null };
      }
      if (!keychain.available()) {
        readOnly = true;
        return { settings: off, problem: 'unavailable' };
      }
      try {
        return {
          settings: parseMcpSettings(JSON.parse(keychain.unwrap(data))),
          problem: null,
        };
      } catch {
        await rename(file, `${file}.unreadable-${now()}`).catch(
          () => undefined,
        );
        return { settings: off, problem: 'set-aside' };
      }
    },
    save: async (settings) => {
      if (readOnly) {
        throw new Error(
          'Secure storage isn’t available right now, so assistant settings can’t change. Restart Nod once the system keyring is unlocked.',
        );
      }
      await writeAtomically(
        file,
        keychain.wrap(JSON.stringify(settings)),
        0o600,
      );
    },
  };
}
