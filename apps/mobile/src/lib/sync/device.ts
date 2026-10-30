import { fetch } from 'expo/fetch';
import { abortAfter } from '../abort-after.ts';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import {
  fromBase64,
  keyLength,
  open,
  randomKey,
  relayToken,
  seal,
  toBase64,
  vaultIdOf,
} from '@nod/core/crypto';
import {
  createPublishedLog,
  createRelayTransport,
  isSyncId,
  publishedLogFile,
  readPublishedEntries,
  readReceivedEntries,
  requestPairingOffer,
  type Fetch,
  type PairingCode,
  type PairingOffer,
  type PublishedLog,
  type RelayTransport,
} from '@nod/core/sync';
import {
  KeyLostError,
  type Cipher,
  type CipherMode,
  type MeetingFiles,
} from '@nod/core/meetings';
import {
  ensureDirectory,
  keepOutOfBackup,
  keySlotFile,
  meetingsDirectory,
  publishedDirectory,
  sharedVaultDirectory,
  sharesDirectory,
  teamDirectory,
  teamNotesDirectory,
} from '../storage.ts';
import {
  createTeamRelay,
  fetchInviteFile,
  singleFileOf,
  type SharedPlace,
  type SharesFile,
  type TeamFiles,
  type TeamRelays,
} from '@nod/core/sharing';
import type { Directory } from 'expo-file-system';
import type { StoredVault, VaultStorage } from './session.ts';

const suffix = '.bin';
const relayTimeoutMs = 60_000;

// A request that never ends would hold every later round behind it.
// Relays, including ones named by a link, get no cookies from the app and
// can't store any, so none can track this phone across requests or hosts.
const relayFetch: Fetch = (url, init) =>
  fetch(url, {
    ...init,
    credentials: 'omit',
    signal: abortAfter(relayTimeoutMs),
  });

// Keys stay on this device: they are left out of backups and transfers to a
// new phone, which pairs again instead (see KeyLostError).
const keychain: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export function meetingFiles(): MeetingFiles {
  return filesIn(meetingsDirectory());
}

// Notes shared with one person, kept like meetings in a folder of that
// vault's own.
export function noteFilesFor(vaultId: string): MeetingFiles {
  return filesIn(sharedVaultDirectory(vaultId));
}

function filesIn(directory: Directory): MeetingFiles {
  const fileOf = (id: string) => new File(directory, `${id}${suffix}`);
  return {
    ids: async () => {
      if (!directory.exists) {
        return [];
      }
      return directory
        .list()
        .filter((entry) => entry instanceof File && entry.name.endsWith(suffix))
        .map((entry) => entry.name.slice(0, -suffix.length))
        .filter(isSyncId);
    },
    read: (id) => fileOf(id).bytes(),
    write: async (id, data) => {
      await ensureDirectory(directory);
      const temporary = new File(directory, `${id}${suffix}.tmp`);
      await temporary.write(data);
      await temporary.move(fileOf(id), { overwrite: true });
    },
    setAside: async (id) => {
      await fileOf(id).move(
        new File(directory, `${id}${suffix}.damaged-${Date.now()}`),
      );
    },
  };
}

function keyOf(encoded: string): Uint8Array {
  const key = fromBase64(encoded);
  if (key.length !== keyLength) {
    throw new Error('A key saved on this phone is damaged');
  }
  return key;
}

// Names the keychain entry that holds the current data key. Not secret: it
// only lets a new key go in a new entry, so starting over never overwrites
// a key that was only unreadable for a moment.
const slotFile = keySlotFile;

async function currentSlot(): Promise<string> {
  const file = slotFile();
  const name = file.exists ? (await file.text()).trim() : '';
  return /^nod\.data-key(\.\d+)?$/.test(name) ? name : 'nod.data-key';
}

// Meetings on disk are sealed with a key only this phone's keychain holds.
export async function meetingCipher(mode: CipherMode): Promise<Cipher> {
  let key: Uint8Array;
  if (mode === 'replace') {
    const slot = `nod.data-key.${Date.now()}`;
    key = randomKey();
    await SecureStore.setItemAsync(slot, toBase64(key), keychain);
    await slotFile().write(slot);
    await keepOutOfBackup(slotFile());
  } else {
    const slot = await currentSlot();
    const stored = await SecureStore.getItemAsync(slot, keychain);
    if (stored !== null) {
      try {
        key = keyOf(stored);
      } catch {
        throw new KeyLostError(
          'The key to the meetings on this phone is damaged',
        );
      }
    } else if (mode === 'open') {
      throw new KeyLostError(
        'The key to the meetings on this phone is missing',
      );
    } else {
      key = randomKey();
      await SecureStore.setItemAsync(slot, toBase64(key), keychain);
    }
  }
  return {
    encrypt: (plain, context) => seal(key, plain, context),
    decrypt: (data, context) => open(key, data, context),
  };
}

export function secureVaults(): VaultStorage {
  const name = 'nod.sync-vault';
  return {
    load: async () => {
      const stored = await SecureStore.getItemAsync(name, keychain);
      if (stored === null) {
        return null;
      }
      const raw: unknown = JSON.parse(stored);
      if (typeof raw !== 'object' || raw === null) {
        throw new Error('Sync settings on this phone are damaged');
      }
      const key = Reflect.get(raw, 'key');
      const deviceId = Reflect.get(raw, 'deviceId');
      const relayUrl = Reflect.get(raw, 'relayUrl');
      if (
        typeof key !== 'string' ||
        typeof deviceId !== 'string' ||
        !isSyncId(deviceId) ||
        typeof relayUrl !== 'string'
      ) {
        throw new Error('Sync settings on this phone are damaged');
      }
      return {
        key: keyOf(key),
        deviceId,
        relayUrl,
        closed: Reflect.get(raw, 'closed') === true,
      };
    },
    save: (vault: StoredVault) =>
      SecureStore.setItemAsync(
        name,
        JSON.stringify({
          key: toBase64(vault.key),
          deviceId: vault.deviceId,
          relayUrl: vault.relayUrl,
          closed: vault.closed,
        }),
        keychain,
      ),
    clear: () => SecureStore.deleteItemAsync(name, keychain),
  };
}

export function sharesFileFor(vaultId: string): SharesFile {
  return singleFileOf(filesIn(sharesDirectory(vaultId)), 'shares');
}

export function teamFilesFor(vaultId: string): TeamFiles {
  const team = filesIn(teamDirectory(vaultId));
  return {
    notes: filesIn(teamNotesDirectory(vaultId)),
    members: singleFileOf(team, 'members'),
    list: singleFileOf(team, 'list'),
  };
}

// A team vault has no token: every request is signed by the person's
// identity, so a team is reached on the relay its list lives on, which need
// not be the person's own.
export const teamRelays: TeamRelays = {
  open: async (host, vaultId, identity) =>
    createTeamRelay({
      url: host,
      vaultId,
      identity,
      fetch: relayFetch,
      now: () => Date.now(),
    }),
  fetchInvite: (link) => fetchInviteFile(link, relayFetch, () => Date.now()),
};

function relayTransport(
  url: string,
  vault: { id: string; token: string },
): RelayTransport {
  return createRelayTransport({
    url,
    vaultId: vault.id,
    token: vault.token,
    fetch: relayFetch,
    now: () => Date.now(),
  });
}

// Shared vaults go through the same relay as the person's own, each under
// its own id and token.
export function sharedPlaceFor(vault: StoredVault): SharedPlace {
  return {
    name: vault.relayUrl,
    open: async (target) => {
      const transport = relayTransport(vault.relayUrl, target);
      await transport.register();
      return transport;
    },
  };
}

export function relayTransportFor(vault: StoredVault): RelayTransport {
  return relayTransport(vault.relayUrl, {
    id: vaultIdOf(vault.key),
    token: relayToken(vault.key),
  });
}

// Which versions this phone already put on the relay, kept across launches
// so a restart doesn't write every meeting again.
export async function publishedLogFor(
  vault: StoredVault,
): Promise<PublishedLog> {
  return publishedLogIn(
    `${vaultIdOf(vault.key)}:${vault.deviceId}:${vault.relayUrl}`,
  );
}

export async function publishedLogIn(scope: string): Promise<PublishedLog> {
  const file = new File(publishedDirectory(), publishedLogFile(scope));
  let stored: unknown = null;
  try {
    stored = file.exists ? JSON.parse(await file.text()) : null;
  } catch {
    stored = null;
  }
  return createPublishedLog({
    scope,
    entries: readPublishedEntries(stored, scope),
    received: readReceivedEntries(stored, scope),
    delayMs: 1_000,
    // Losing it only costs writing each meeting, and reading each file of
    // another device, once more.
    save: (data) => {
      ensureDirectory(file.parentDirectory)
        .then(() => file.write(data))
        .then(() => keepOutOfBackup(file))
        .catch(() => undefined);
    },
  });
}

const lanTimeoutMs = 5_000;

// Asks the computer on this network for the vault, over plain HTTP: the
// answer is sealed with the code's secret, and the computer stops listening
// once it has given it. The computer asks its user first, and `waiting`
// fires once it has, with the address the computer sees this phone as.
export function fetchPairingOffer(
  code: PairingCode,
  waiting: (asker: string | null) => void,
): Promise<PairingOffer> {
  return requestPairingOffer(
    code,
    (url, init) => fetch(url, { ...init, signal: abortAfter(lanTimeoutMs) }),
    waiting,
  );
}
