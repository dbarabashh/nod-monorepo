import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentState } from '@nod/core/meetings';
import {
  fileKeyOf,
  keyFromRecoveryPhrase,
  randomKey,
  recoveryPhrase,
  relayToken,
  vaultCodeOf,
  vaultIdOf,
} from '@nod/core/crypto';
import {
  assertPairingRelay,
  guardedRound,
  pausedMessage,
  type RoundOutcome,
  closedPath,
  createSyncEngine,
  devicesPrefix,
  meetingPath,
  parseMeetingPath,
  sealClosedNotice,
  stillWaiting,
  Throttled,
  type PairingOffer,
  type SyncEngine,
  type Transport,
} from '@nod/core/sync';
import type { SyncDevice, SyncState } from '../../shared/ipc.ts';
import type { MeetingStore } from '../meetings/store.ts';
import { createFolderTransport } from './folder-transport.ts';
import { createRelayTransport, type Fetch } from '@nod/core/sync';
import type { PublishedLogs } from './published-log.ts';
import type { SyncSettings, TransportSettings, Vault } from './settings.ts';

const folderName = 'nod-sync';

type Connection = {
  transport: Transport;
  engine: SyncEngine;
  checked: Map<string, string>;
};

const forgetBatch = 8;

export type PhrasePreview = {
  vaultCode: string;
  switching: boolean;
  replacing: boolean;
  reachable: boolean;
  devices: number | null;
};

export class UnreachableError extends Error {}

// Two messages shown together read as two sentences.
function sentences(...parts: Array<string | null>): string | null {
  const shown = parts.filter((part) => part !== null && part !== '');
  if (shown.length < 2) {
    return shown[0] ?? null;
  }
  return shown
    .map((part) => (/[.!?]$/.test(part ?? '') ? part : `${part}.`))
    .join(' ');
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export type SyncController = ReturnType<typeof createSyncController>;

export function createSyncController(options: {
  settings: SyncSettings;
  publishedLogs?: PublishedLogs;
  store: Pick<MeetingStore, 'ids' | 'document' | 'merge' | 'isDeleted'>;
  onRemote: (state: DocumentState) => void;
  fetch: Fetch;
  newId: () => string;
  now: () => number;
  onChange: () => void;
  defaultRelay: string | null;
}) {
  const { settings, store, onRemote, fetch, newId, now, onChange } = options;
  let vault: Vault | null = null;
  let unreadable: string | null = null;
  let connection: Connection | null = null;
  let error: string | null = null;
  // Outlives sync rounds and confirming the phrase, unlike error: only the
  // next change of phrase clears it.
  let warning: string | null = null;
  let closedUnsaved = false;
  let inFlight: Promise<void> = Promise.resolve();
  let busy = false;
  // Bumped by every change, so a connection that finishes opening after the
  // user changed the vault or the place is dropped instead of used.
  let generation = 0;

  // Each vault gets its own subfolder, so vaults sharing one folder never mix.
  async function transportFor(
    target: Vault,
    transport: TransportSettings,
  ): Promise<Transport & { register?: () => Promise<void> }> {
    if (transport.kind === 'relay') {
      return createRelayTransport({
        url: transport.url,
        vaultId: target.id,
        token: relayToken(target.key),
        fetch,
        now,
      });
    }
    // An unmounted drive looks like an empty folder; removing from it would
    // seem to work while the files stay where the drive is.
    await stat(transport.folder).catch(() => {
      throw new Error('The sync folder can’t be found');
    });
    return createFolderTransport(
      path.join(transport.folder, folderName, target.id),
    );
  }

  async function connectionFor(
    next: Vault,
    transport: TransportSettings,
  ): Promise<Connection> {
    const target = await transportFor(next, transport);
    await target.register?.();
    return {
      transport: target,
      engine: createSyncEngine({
        transport: target,
        vault: next,
        store,
        onRemote,
        now,
        // Scoped to the place too: copies left in another folder or relay
        // are a different set, and may be older than what the log says.
        publishedLog: await options.publishedLogs?.open(
          `${next.id}:${next.deviceId}:${transport.kind === 'relay' ? transport.url : transport.folder}`,
        ),
      }),
      checked: new Map(),
    };
  }

  // Offline is normal: the vault is kept, and every sync round tries to
  // reach the folder or relay again until it works. A relay that asked this
  // device to wait is not asked again before then: the transport that
  // remembers the wait is dropped with the failed connection.
  let connectAfter = 0;
  async function connect() {
    const current = vault;
    const round = generation;
    if (
      connection ||
      !current?.transport ||
      stillWaiting(connectAfter, now())
    ) {
      return;
    }
    try {
      const next = await connectionFor(current, current.transport);
      if (round === generation) {
        connection = next;
        error = null;
      }
    } catch (failure) {
      if (failure instanceof Throttled) {
        connectAfter = now() + failure.retryAfterMs;
      }
      if (round === generation) {
        error = messageOf(failure);
      }
    }
  }

  // Removes what this device published, so the shared folder or relay doesn't
  // keep a copy of meetings nobody syncs any more. Deletions stay, so devices
  // that haven't seen one yet still get them. A place that can't be reached is
  // only left behind when the user agreed to that.
  async function leave(current: Vault, leaveCopies: boolean) {
    connection = null;
    await inFlight;
    let from: Connection | null = null;
    if (current.transport) {
      try {
        from = await connectionFor(current, current.transport);
      } catch (failure) {
        if (!leaveCopies) {
          throw new UnreachableError(messageOf(failure));
        }
      }
    }
    for (const id of store.ids().filter((id) => !store.isDeleted(id))) {
      await from?.transport.remove(meetingPath(current.deviceId, id));
    }
  }

  async function saveClosed() {
    if (closedUnsaved && vault?.closed) {
      await settings.save(vault);
      closedUnsaved = false;
    }
  }

  async function adopt(next: Vault) {
    await settings.save(next);
    vault = next;
    connection = null;
    await connect();
  }

  function requireVault(): Vault {
    if (!vault) {
      throw new Error('This device has no recovery phrase yet');
    }
    return vault;
  }

  function assertReplaceable(replaceUnreadable: boolean) {
    if (unreadable && !replaceUnreadable) {
      throw new Error(
        'The recovery key saved on this device couldn’t be read, so it isn’t replaced. Unlock the system keyring and restart Nod.',
      );
    }
  }

  // Every change awaits the transport; holding the controller for the whole
  // change keeps a second one from starting in that gap.
  async function change(action: () => Promise<void>) {
    try {
      if (busy) {
        throw new Error(
          'Sync is still finishing another change, such as forgetting a device. Try again when it’s done.',
        );
      }
      busy = true;
      generation += 1;
      error = null;
      // What the user asks for is one deliberate ask of the place, and may
      // be another place; a relay still refusing says so again.
      connectAfter = 0;
      try {
        await action();
      } finally {
        busy = false;
      }
    } catch (failure) {
      error = messageOf(failure);
      throw failure;
    } finally {
      onChange();
    }
  }

  async function attach(transport: TransportSettings) {
    const current = requireVault();
    if (current.transport) {
      throw new Error('Stop syncing before choosing another place');
    }
    const next = { ...current, transport };
    const opened = await connectionFor(next, transport);
    await settings.save(next);
    vault = next;
    connection = opened;
  }

  async function devicesIn(target: Vault, transport: TransportSettings) {
    const probe = await transportFor(target, transport);
    const files = await probe.list(devicesPrefix());
    return new Set(
      files.flatMap((file) => parseMeetingPath(file.path)?.deviceId ?? []),
    ).size;
  }

  function vaultOf(
    key: Uint8Array,
    transport: TransportSettings | null,
    recoveryConfirmed: boolean,
  ): Vault {
    return {
      id: vaultIdOf(key),
      key,
      deviceId: newId(),
      transport,
      recoveryConfirmed,
      closed: false,
    };
  }

  return {
    load: async () => {
      try {
        vault = await settings.load();
        unreadable = null;
      } catch (failure) {
        unreadable = messageOf(failure);
      }
    },
    state: (): SyncState => {
      if (!vault) {
        return unreadable
          ? { status: 'unavailable', error: unreadable }
          : { status: 'none', error };
      }
      const status = connection?.engine.status();
      return {
        status: 'ready',
        vaultId: vault.id,
        transport: vault.transport,
        defaultRelay: options.defaultRelay,
        connected: connection !== null,
        devices: status?.devices ?? 0,
        lastSyncedAt: status?.lastSyncedAt ?? null,
        error: sentences(error ?? status?.error ?? null, warning),
        recoveryConfirmed: vault.recoveryConfirmed,
        closed: vault.closed,
      };
    },
    create: () =>
      change(async () => {
        assertReplaceable(false);
        if (vault) {
          throw new Error('This device already has a recovery phrase');
        }
        await adopt(vaultOf(randomKey(), null, false));
      }),
    // What entering these words would do, so the user can confirm it first:
    // whether this device leaves another vault, and whether any device syncs
    // with them yet. A mistyped word that still passes the checksum shows up
    // as a vault no device uses.
    preview: async (phrase: string): Promise<PhrasePreview> => {
      const key = keyFromRecoveryPhrase(phrase);
      const current = vault;
      if (current && vaultIdOf(key) === current.id) {
        throw new Error('This device already uses that recovery phrase');
      }
      const replacing = unreadable !== null;
      const vaultCode = vaultCodeOf(vaultIdOf(key));
      if (!current?.transport) {
        return {
          vaultCode,
          switching: current !== null,
          replacing,
          reachable: true,
          devices: null,
        };
      }
      try {
        return {
          vaultCode,
          switching: true,
          replacing,
          reachable: true,
          devices: await devicesIn(
            vaultOf(key, current.transport, true),
            current.transport,
          ),
        };
      } catch {
        return {
          vaultCode,
          switching: true,
          replacing,
          reachable: false,
          devices: null,
        };
      }
    },
    // Words that belong to another vault switch this device over to it,
    // through the same folder or relay, and its meetings join that vault.
    enterPhrase: (
      phrase: string,
      choices: { leaveCopies: boolean; replaceUnreadable: boolean },
    ) =>
      change(async () => {
        assertReplaceable(choices.replaceUnreadable);
        warning = null;
        const key = keyFromRecoveryPhrase(phrase);
        const current = vault;
        if (current && vaultIdOf(key) === current.id) {
          throw new Error('This device already uses that recovery phrase');
        }
        if (current) {
          await leave(current, choices.leaveCopies);
        }
        await adopt(vaultOf(key, current?.transport ?? null, true));
        unreadable = null;
      }),
    useFolder: (folder: string) =>
      change(() => attach({ kind: 'folder', folder })),
    useRelay: (url: string) => change(() => attach({ kind: 'relay', url })),
    disconnect: (leaveCopies: boolean) =>
      change(async () => {
        await leave(requireVault(), leaveCopies);
        connection = null;
        vault = { ...requireVault(), transport: null };
        await settings.save(vault);
      }),
    // The new phrase is never sent anywhere, so a lost device can't get it;
    // the user enters it on the devices they keep. It is saved before the old
    // vault is touched, so a failure there can't lose it.
    changePhrase: (leaveCopies: boolean) =>
      change(async () => {
        const current = requireVault();
        warning = null;
        const next = vaultOf(randomKey(), current.transport, false);
        let old: Connection | null = null;
        if (current.transport) {
          connection = null;
          await inFlight;
          try {
            old = await connectionFor(current, current.transport);
          } catch (failure) {
            if (!leaveCopies) {
              throw new UnreachableError(messageOf(failure));
            }
          }
        }
        await settings.save(next);
        vault = next;
        connection = null;
        if (old) {
          let kept: string | null = null;
          try {
            for (const id of store.ids().filter((id) => !store.isDeleted(id))) {
              await old.transport.remove(meetingPath(current.deviceId, id));
            }
          } catch (failure) {
            kept = `This device’s copies stayed in the old place: ${messageOf(failure)}`;
          }
          try {
            await old.transport.write(
              closedPath(current.deviceId),
              sealClosedNotice(
                fileKeyOf(current.key),
                current.id,
                current.deviceId,
                now(),
              ),
            );
            warning = kept && `The new phrase is saved. ${kept}`;
          } catch (failure) {
            warning = `The new phrase is saved, but your other devices weren’t told: ${messageOf(failure)}. Enter the new phrase on them now.${kept ? ` ${kept}` : ''}`;
          }
        } else if (current.transport) {
          warning =
            'The new phrase is saved, but the folder or relay couldn’t be reached, so your other devices weren’t told. Enter the new phrase on them now.';
        }
        await connect();
      }),
    recoveryPhrase: (): string => recoveryPhrase(requireVault().key),
    // A phone can only reach a relay, never a folder on this computer.
    pairingOffer: (): PairingOffer => {
      const current = requireVault();
      if (current.closed) {
        throw new Error('Sync through this phrase has stopped');
      }
      if (current.transport?.kind !== 'relay') {
        throw new Error('Connect a relay before pairing a phone');
      }
      return {
        key: current.key,
        relayUrl: assertPairingRelay(current.transport.url),
      };
    },
    confirmRecoveryPhrase: () =>
      change(async () => {
        await inFlight;
        vault = { ...requireVault(), recoveryConfirmed: true };
        await settings.save(vault);
      }),
    // The other devices that have meetings in the vault, as the vault shows
    // them: there is no name to show, only what they put there and when.
    devices: async (): Promise<SyncDevice[]> => {
      const current = requireVault();
      if (!current.transport) {
        return [];
      }
      await connect();
      const at = connection;
      if (!at) {
        throw new Error(error ?? 'The relay or folder can’t be reached');
      }
      const byDevice = new Map<string, SyncDevice>();
      for (const file of await at.transport.list(devicesPrefix())) {
        const parsed = parseMeetingPath(file.path);
        if (!parsed || parsed.deviceId === current.deviceId) {
          continue;
        }
        const seen = byDevice.get(parsed.deviceId) ?? {
          id: parsed.deviceId,
          meetings: 0,
          lastChangedAt: 0,
        };
        byDevice.set(parsed.deviceId, {
          ...seen,
          meetings: seen.meetings + 1,
          lastChangedAt: Math.max(seen.lastChangedAt, file.changedAt),
        });
      }
      return [...byDevice.values()].sort(
        (a, b) => b.lastChangedAt - a.lastChangedAt,
      );
    },
    // Removes what a lost or reinstalled device left in the vault. Run after
    // a sync round, so its meetings are here first; this device then writes
    // its own copy of any that only that device held. A device still in use
    // writes its copies again as its meetings change; shutting one out is
    // changing the phrase.
    forgetDevice: async (deviceId: string) => {
      await change(async () => {
        const current = requireVault();
        if (deviceId === current.deviceId) {
          throw new Error('This device can’t forget itself');
        }
        await inFlight;
        await connect();
        const at = connection;
        if (!at) {
          throw new Error('The relay or folder can’t be reached');
        }
        const listing = await at.transport.list(devicesPrefix());
        const files = listing.filter(
          (file) => parseMeetingPath(file.path)?.deviceId === deviceId,
        );
        // Removing a file this device hasn't merged at that version could
        // remove the only copy of a meeting, so nothing is removed until all
        // of them are here.
        if (
          files.some((file) => at.engine.merged(file.path) !== file.version)
        ) {
          throw new Error(
            'Some of that device’s meetings haven’t reached this computer yet. Sync, then try again.',
          );
        }
        // Devices don't write back what another device holds, so this one
        // may have no copy of its own of a meeting only that device had. A
        // round that no longer counts that device's files writes those
        // copies, and nothing is removed unless it did.
        await at.engine.sync(listing.filter((file) => !files.includes(file)));
        const failed = at.engine.status().error;
        if (failed) {
          throw new Error(
            `This computer couldn’t put its own copies in the vault first, so nothing was removed: ${failed}`,
          );
        }
        // A few at a time: one by one, a device with a hundred meetings
        // takes a minute over the internet.
        for (let index = 0; index < files.length; index += forgetBatch) {
          await Promise.all(
            files
              .slice(index, index + forgetBatch)
              .map((file) => at.transport.remove(file.path)),
          );
        }
      });
    },
    refresh: () => {
      const round = inFlight.then(async () => {
        if (busy) {
          return;
        }
        await connect();
        const current = connection;
        const owner = vault;
        if (current && owner?.closed) {
          await saveClosed().catch(() => undefined);
        } else if (current && owner) {
          let outcome: RoundOutcome;
          try {
            outcome = await guardedRound(current, {
              fileKey: fileKeyOf(owner.key),
              id: owner.id,
              deviceId: owner.deviceId,
            });
          } catch (failure) {
            error = messageOf(failure);
            onChange();
            return;
          }
          // A vault stays closed even if its notice later disappears, since
          // a device holding the old phrase could delete it.
          if (outcome === 'closed' && vault?.id === owner.id) {
            vault = { ...vault, closed: true };
            closedUnsaved = true;
          }
          await saveClosed().catch(() => undefined);
          if (outcome === 'paused') {
            error = pausedMessage;
          }
          if (outcome !== 'synced') {
            onChange();
            return;
          }
          if (current === connection) {
            error = null;
          }
        }
        onChange();
      });
      inFlight = round.catch(() => undefined);
      return round;
    },
  };
}
