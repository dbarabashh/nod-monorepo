import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isSyncId } from '../../core/sync/index.ts';
import { keyLength } from '../../core/crypto/index.ts';
import type { KeyWrap } from '../security/data-key.ts';

export type TransportSettings =
  | { kind: 'folder'; folder: string }
  | { kind: 'relay'; url: string };

export type Vault = {
  id: string;
  key: Uint8Array;
  deviceId: string;
  transport: TransportSettings;
  recoveryConfirmed: boolean;
};

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function field(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function parseTransport(raw: unknown): TransportSettings | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const kind = field(raw, 'kind');
  const folder = field(raw, 'folder');
  const url = field(raw, 'url');
  if (kind === 'folder' && typeof folder === 'string') {
    return { kind, folder };
  }
  if (kind === 'relay' && typeof url === 'string') {
    return { kind, url };
  }
  return null;
}

async function writeAtomically(file: string, data: Buffer | string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}

export function createSyncSettings(options: {
  directory: string;
  keychain: KeyWrap;
}) {
  const settingsFile = path.join(options.directory, 'sync.json');
  const keyFile = path.join(options.directory, 'keys', 'vault.key');

  return {
    load: async (): Promise<Vault | null> => {
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(settingsFile, 'utf8'));
      } catch (error) {
        if (isMissing(error)) {
          return null;
        }
        throw error;
      }
      if (typeof raw !== 'object' || raw === null) {
        throw new Error('Sync settings are damaged');
      }
      const id = field(raw, 'vaultId');
      const deviceId = field(raw, 'deviceId');
      const transport = parseTransport(field(raw, 'transport'));
      if (
        typeof id !== 'string' ||
        typeof deviceId !== 'string' ||
        !isSyncId(id) ||
        !isSyncId(deviceId) ||
        !transport
      ) {
        throw new Error('Sync settings are damaged');
      }
      const key = Buffer.from(
        options.keychain.unwrap(await readFile(keyFile)),
        'base64',
      );
      if (key.length !== keyLength) {
        throw new Error('The sync key is damaged');
      }
      return {
        id,
        key,
        deviceId,
        transport,
        recoveryConfirmed: field(raw, 'recoveryConfirmed') === true,
      };
    },
    save: async (vault: Vault) => {
      await writeAtomically(
        keyFile,
        options.keychain.wrap(Buffer.from(vault.key).toString('base64')),
      );
      await writeAtomically(
        settingsFile,
        JSON.stringify({
          vaultId: vault.id,
          deviceId: vault.deviceId,
          transport: vault.transport,
          recoveryConfirmed: vault.recoveryConfirmed,
        }),
      );
    },
    clear: async () => {
      await rm(settingsFile, { force: true });
      await rm(keyFile, { force: true });
    },
  };
}

export type SyncSettings = ReturnType<typeof createSyncSettings>;
