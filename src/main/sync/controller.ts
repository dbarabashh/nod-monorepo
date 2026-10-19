import path from 'node:path';
import type { DocumentState } from '../../core/meetings/index.ts';
import {
  devicesPrefix,
  isSyncId,
  meetingContext,
  meetingPath,
  parseMeetingPath,
  vaultCheckContext,
  vaultCheckFile,
  vaultFile,
} from '../../core/sync/index.ts';
import type { SyncState } from '../../shared/ipc.ts';
import type { MeetingStore } from '../meetings/store.ts';
import {
  bytesOf,
  keyFromRecoveryPhrase,
  open,
  randomKey,
  recoveryPhrase,
  relayToken,
  seal,
} from '../../core/crypto/index.ts';
import { createSyncEngine, type SyncEngine } from '../../core/sync/index.ts';
import { createFolderTransport } from './folder-transport.ts';
import {
  createApprover,
  createJoin,
  pairingMaxBytes,
  type Approver,
  type Join,
} from '../../core/sync/index.ts';
import { createRelayTransport, type Fetch } from './relay-transport.ts';
import type { SyncSettings, TransportSettings, Vault } from './settings.ts';
import type { Transport } from '../../core/sync/index.ts';

const folderName = 'nod-sync';
const maxSampleBytes = 64 * 1024 * 1024;

type Running = {
  vault: Vault;
  transport: Transport;
  engine: SyncEngine;
  approver: Approver;
  requests: Array<{ requestId: string; code: string }>;
};

type Joining = {
  transport: Transport;
  settings: TransportSettings;
  join: Join;
  code: string | null;
  confirmed: boolean;
};

export type SyncController = ReturnType<typeof createSyncController>;

export function createSyncController(options: {
  settings: SyncSettings;
  store: Pick<MeetingStore, 'ids' | 'document' | 'merge' | 'isDeleted'>;
  onRemote: (state: DocumentState) => void;
  fetch: Fetch;
  newId: () => string;
  now: () => number;
  onChange: () => void;
}) {
  const { settings, store, onRemote, fetch, newId, now, onChange } = options;
  let running: Running | null = null;
  let joining: Joining | null = null;
  let error: string | null = null;
  let inFlight: Promise<void> = Promise.resolve();
  let stopping = false;
  let starting = false;

  function transportFor(
    transport: TransportSettings,
    vaultId: string,
    key: Uint8Array | null,
  ): Transport & { register?: () => Promise<void> } {
    return transport.kind === 'folder'
      ? createFolderTransport(path.join(transport.folder, folderName))
      : createRelayTransport({
          url: transport.url,
          vaultId,
          token: key ? relayToken(key) : null,
          fetch,
        });
  }

  function run(vault: Vault) {
    const transport = transportFor(vault.transport, vault.id, vault.key);
    running = {
      vault,
      transport,
      engine: createSyncEngine({ transport, vault, store, onRemote, now }),
      approver: createApprover(transport, vault),
      requests: [],
    };
  }

  async function readVaultId(transport: Transport): Promise<string | null> {
    const data = await transport.read(vaultFile, pairingMaxBytes);
    if (!data) {
      return null;
    }
    const parsed: unknown = JSON.parse(Buffer.from(data).toString('utf8'));
    const id =
      typeof parsed === 'object' && parsed !== null
        ? Reflect.get(parsed, 'vaultId')
        : null;
    if (typeof id !== 'string' || !isSyncId(id)) {
      throw new Error('This folder holds sync data the app cannot use');
    }
    return id;
  }

  async function create(transport: TransportSettings, vaultId: string) {
    const vault: Vault = {
      id: vaultId,
      key: randomKey(),
      deviceId: newId(),
      transport,
      recoveryConfirmed: false,
    };
    const target = transportFor(transport, vault.id, vault.key);
    await target.register?.();
    await target.write(
      vaultFile,
      Buffer.from(JSON.stringify({ vaultId: vault.id })),
    );
    await target.write(
      vaultCheckFile,
      seal(vault.key, bytesOf(vaultCheckFile), vaultCheckContext(vault.id)),
    );
    await settings.save(vault);
    run(vault);
  }

  // Opening anything sealed with the vault key proves the phrase is this
  // vault's; the check file exists from the start, before any meeting is.
  async function opensWithKey(target: Transport, id: string, key: Uint8Array) {
    const check = await target.read(vaultCheckFile, pairingMaxBytes);
    if (check) {
      open(key, check, vaultCheckContext(id));
      return;
    }
    const sample = (await target.list(devicesPrefix()))
      .map((file) => ({ file, parsed: parseMeetingPath(file.path) }))
      .find(({ parsed }) => parsed !== null);
    if (!sample?.parsed) {
      throw new Error(
        'There is nothing in this vault to check the phrase against.',
      );
    }
    const sealed = await target.read(sample.file.path, maxSampleBytes);
    open(
      key,
      sealed ?? new Uint8Array(),
      meetingContext(id, sample.parsed.deviceId, sample.parsed.meetingId),
    );
  }

  // A phrase passes its own checksum even when it belongs to another vault,
  // so it is tried against the vault itself before anything is saved.
  async function restore(
    transport: TransportSettings,
    vaultId: string | null,
    phrase: string,
  ) {
    const key = keyFromRecoveryPhrase(phrase);
    const wrongPhrase = 'That recovery phrase belongs to a different vault.';
    let id = vaultId;
    if (transport.kind === 'folder') {
      id = await readVaultId(transportFor(transport, 'unused', null));
      if (!id) {
        throw new Error('This folder has no synced meetings to restore.');
      }
    }
    if (!id) {
      throw new Error('Enter the vault ID to restore.');
    }
    const target = transportFor(transport, id, key);
    try {
      if (
        transport.kind === 'relay' &&
        !(await target.read(vaultFile, pairingMaxBytes))
      ) {
        throw new Error('This relay has no vault with that ID.');
      }
      await opensWithKey(target, id, key);
    } catch (failure) {
      const refused =
        failure instanceof Error &&
        (/\b401\b/.test(failure.message) ||
          /could not be opened/.test(failure.message));
      throw refused ? new Error(wrongPhrase) : failure;
    }
    const vault: Vault = {
      id,
      key,
      deviceId: newId(),
      transport,
      recoveryConfirmed: true,
    };
    await settings.save(vault);
    run(vault);
  }

  async function beginJoin(transport: TransportSettings, vaultId: string) {
    const target = transportFor(transport, vaultId, null);
    const join = createJoin(target, newId());
    await join.begin();
    joining = {
      transport: target,
      settings: transport,
      join,
      code: null,
      confirmed: false,
    };
  }

  async function guarded(action: () => Promise<void>) {
    error = null;
    try {
      await action();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      throw failure;
    } finally {
      onChange();
    }
  }

  // Setting up awaits the transport; claiming the controller first keeps a
  // second setup from starting in that gap.
  function setUp(action: () => Promise<void>) {
    return guarded(async () => {
      assertIdle();
      starting = true;
      try {
        await action();
      } finally {
        starting = false;
      }
    });
  }

  function assertIdle() {
    if (running || joining || stopping || starting) {
      throw new Error('Sync is already set up on this device');
    }
  }

  return {
    load: async () => {
      const vault = await settings.load().catch((failure: unknown) => {
        error = failure instanceof Error ? failure.message : String(failure);
        return null;
      });
      if (vault) {
        run(vault);
      }
    },
    state: (): SyncState => {
      if (joining) {
        return {
          status: 'joining',
          transport: joining.settings,
          code: joining.code,
          confirmed: joining.confirmed,
        };
      }
      if (!running) {
        return { status: 'off', error };
      }
      const status = running.engine.status();
      return {
        status: 'on',
        transport: running.vault.transport,
        vaultId: running.vault.id,
        devices: status.devices,
        lastSyncedAt: status.lastSyncedAt,
        error: error ?? status.error,
        requests: running.requests,
        recoveryConfirmed: running.vault.recoveryConfirmed,
      };
    },
    useFolder: (folder: string) =>
      setUp(async () => {
        const transport: TransportSettings = { kind: 'folder', folder };
        const existing = await readVaultId(
          transportFor(transport, 'unused', null),
        );
        if (existing) {
          await beginJoin(transport, existing);
        } else {
          await create(transport, newId());
        }
      }),
    useRelay: (url: string, vaultId: string | null) =>
      setUp(async () => {
        const transport: TransportSettings = { kind: 'relay', url };
        if (vaultId) {
          await beginJoin(transport, vaultId);
        } else {
          await create(transport, newId());
        }
      }),
    approve: (requestId: string, code: string) =>
      guarded(async () => {
        await running?.approver.approve(requestId, code);
        if (running) {
          running.requests = running.requests.filter(
            (request) => request.requestId !== requestId,
          );
        }
      }),
    reject: (requestId: string) =>
      guarded(async () => {
        await running?.approver.reject(requestId);
        if (running) {
          running.requests = running.requests.filter(
            (request) => request.requestId !== requestId,
          );
        }
      }),
    recoveryPhrase: (): string => {
      if (!running) {
        throw new Error('Sync is not set up on this device');
      }
      return recoveryPhrase(running.vault.key);
    },
    confirmRecoveryPhrase: () =>
      guarded(async () => {
        if (!running) {
          throw new Error('Sync is not set up on this device');
        }
        const vault = { ...running.vault, recoveryConfirmed: true };
        await settings.save(vault);
        running.vault = vault;
      }),
    restoreFromFolder: (folder: string, phrase: string) =>
      setUp(async () => {
        await restore({ kind: 'folder', folder }, null, phrase);
      }),
    restoreFromRelay: (url: string, vaultId: string, phrase: string) =>
      setUp(async () => {
        await restore({ kind: 'relay', url }, vaultId, phrase);
      }),
    confirmJoin: (code: string) =>
      guarded(async () => {
        if (!joining) {
          throw new Error('Nothing is waiting to join');
        }
        joining.join.confirm(code);
        joining.confirmed = true;
      }),
    cancelJoin: () =>
      guarded(async () => {
        const current = joining;
        joining = null;
        await current?.join.cancel();
      }),
    // Leaving removes what this device published, so the shared folder or
    // relay doesn't keep a copy of meetings nobody syncs any more. Deletions
    // stay, so devices that haven't seen one yet still get it. The key is only
    // forgotten once that worked, since nothing could remove the files later.
    stop: () =>
      guarded(async () => {
        if (joining) {
          throw new Error('Cancel joining before turning sync off');
        }
        const current = running;
        running = null;
        stopping = true;
        try {
          await inFlight;
          if (current) {
            try {
              for (const id of store
                .ids()
                .filter((id) => !store.isDeleted(id))) {
                await current.transport.remove(
                  meetingPath(current.vault.deviceId, id),
                );
              }
            } catch (failure) {
              running = current;
              throw failure;
            }
          }
          await settings.clear();
        } finally {
          stopping = false;
        }
      }),
    refresh: () => {
      const round = inFlight.then(refreshOnce);
      inFlight = round.catch(() => undefined);
      return round;
    },
  };

  async function refreshOnce() {
    if (joining) {
      const current = joining;
      let progress;
      try {
        progress = await current.join.poll();
      } catch (failure) {
        joining = null;
        error = failure instanceof Error ? failure.message : String(failure);
        await current.join.cancel();
        onChange();
        return;
      }
      const code =
        progress.step === 'confirm' || progress.step === 'approving'
          ? progress.code
          : null;
      if (code !== current.code) {
        current.code = code;
        onChange();
      }
      if (progress.step === 'joined') {
        const vault: Vault = {
          id: progress.vaultId,
          key: progress.key,
          deviceId: newId(),
          transport: current.settings,
          recoveryConfirmed: true,
        };
        await settings.save(vault);
        joining = null;
        run(vault);
        onChange();
      }
    }
    if (running) {
      const current = running;
      await current.engine.sync();
      current.requests = await current.approver
        .pending()
        .catch(() => current.requests);
      onChange();
    }
  }
}
