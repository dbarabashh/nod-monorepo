import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isSyncId } from '@nod/core/sync';
import { keyLength, vaultIdOf } from '@nod/core/crypto';
import type { KeyWrap } from '../security/data-key.ts';
import { writeAtomically } from '../storage/write-atomically.ts';

export type TransportSettings =
  | { kind: 'folder'; folder: string }
  | { kind: 'relay'; url: string };

export type Vault = {
  id: string;
  key: Uint8Array;
  deviceId: string;
  transport: TransportSettings | null;
  recoveryConfirmed: boolean;
  closed: boolean;
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

export function createSyncSettings(options: {
  directory: string;
  keychain: KeyWrap;
}) {
  const settingsFile = path.join(options.directory, 'sync.json');
  let writing: Promise<void> = Promise.resolve();

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
      const deviceId = field(raw, 'deviceId');
      const storedTransport = field(raw, 'transport');
      const transport = parseTransport(storedTransport);
      if (
        typeof deviceId !== 'string' ||
        !isSyncId(deviceId) ||
        (storedTransport !== null && !transport)
      ) {
        throw new Error('Sync settings are damaged');
      }
      const wrapped = field(raw, 'key');
      if (typeof wrapped !== 'string') {
        throw new Error('Sync settings are damaged');
      }
      const key = Buffer.from(
        options.keychain.unwrap(Buffer.from(wrapped, 'base64')),
        'base64',
      );
      if (key.length !== keyLength) {
        throw new Error('The sync key is damaged');
      }
      return {
        id: vaultIdOf(key),
        key,
        deviceId,
        transport,
        recoveryConfirmed: field(raw, 'recoveryConfirmed') === true,
        closed: field(raw, 'closed') === true,
      };
    },
    // One file holds the wrapped key and everything tied to it, so a failed
    // write can never pair a new key with another vault's settings.
    save: (vault: Vault) => {
      const write = writing.then(() => persist(vault));
      writing = write.catch(() => undefined);
      return write;
    },
  };

  async function persist(vault: Vault) {
    await writeAtomically(
      settingsFile,
      JSON.stringify({
        key: Buffer.from(
          options.keychain.wrap(Buffer.from(vault.key).toString('base64')),
        ).toString('base64'),
        deviceId: vault.deviceId,
        transport: vault.transport,
        recoveryConfirmed: vault.recoveryConfirmed,
        closed: vault.closed,
      }),
    );
  }
}

export type SyncSettings = ReturnType<typeof createSyncSettings>;
