import type { DocumentState } from '@nod/core/meetings';
import { fileKeyOf, vaultCodeOf, vaultIdOf } from '@nod/core/crypto';
import {
  composeEngines,
  createSyncEngine,
  guardedRound,
  removePublishedFiles,
  pausedMessage,
  type PairingOffer,
  stillWaiting,
  Throttled,
  throttledMessage,
  type PublishedLog,
  type RelayTransport,
  type SyncEngine,
} from '@nod/core/sync';
import { messageOf } from '../message-of.ts';
import type { MeetingStore } from '@nod/core/meetings';
import type { SharedPlace, SharingSession } from '@nod/core/sharing';

export type StoredVault = {
  key: Uint8Array;
  deviceId: string;
  relayUrl: string;
  closed: boolean;
};

export type VaultStorage = {
  load: () => Promise<StoredVault | null>;
  save: (vault: StoredVault) => Promise<void>;
  clear: () => Promise<void>;
};

export type SyncState =
  | {
      status: 'unavailable';
      error: string;
      reset: 'pair-again' | 'start-over' | null;
    }
  | { status: 'unpaired' }
  | {
      status: 'paired';
      vaultCode: string;
      relayHost: string;
      syncing: boolean;
      lastSyncedAt: number | null;
      devices: number;
      error: string | null;
      closed: boolean;
    };

type Connection = {
  transport: RelayTransport;
  engine: SyncEngine;
  checked: Map<string, string>;
};

export type SyncSession = ReturnType<typeof createSyncSession>;

export function createSyncSession(options: {
  vaults: VaultStorage;
  store: MeetingStore;
  transportFor: (vault: StoredVault) => RelayTransport;
  publishedLogFor?: (vault: StoredVault) => Promise<PublishedLog>;
  onRemote: (state: DocumentState) => void;
  onChange: () => void;
  newId: () => string;
  now: () => number;
  // Sharing rides on the vault: its list syncs beside the meetings, and the
  // shared vaults go through the same relay.
  sharing?: Pick<SharingSession, 'load' | 'sharesEngine' | 'round' | 'endAll'>;
  sharedPlaceFor?: (vault: StoredVault) => SharedPlace;
}) {
  const {
    vaults,
    store,
    transportFor,
    onRemote,
    onChange,
    newId,
    now,
    sharing,
  } = options;
  let vault: StoredVault | null = null;
  let unreadable: string | null = null;
  let connection: Connection | null = null;
  let error: string | null = null;
  let syncing = false;
  let closedUnsaved = false;
  let inFlight: Promise<void> = Promise.resolve();
  // Bumped when the vault changes, so a round still running for the old one
  // can't put its connection or result in place.
  let generation = 0;
  // A relay that asked this phone to wait is not asked again before then: the
  // transport that remembers the wait is dropped with a failed connection,
  // and a round against a kept one would only be refused.
  let waitUntil = 0;

  async function connect(current: StoredVault, round: number) {
    const transport = transportFor(current);
    await transport.register();
    const publishedLog = await options.publishedLogFor?.(current);
    if (round !== generation) {
      return null;
    }
    const syncVault = {
      id: vaultIdOf(current.key),
      key: current.key,
      deviceId: current.deviceId,
    };
    const meetings = createSyncEngine({
      transport,
      vault: syncVault,
      store,
      onRemote,
      now,
      publishedLog,
    });
    const shares = await sharing?.sharesEngine(
      syncVault,
      transport,
      current.relayUrl,
    );
    if (round !== generation) {
      return null;
    }
    connection = {
      transport,
      engine: shares ? composeEngines([meetings, shares]) : meetings,
      checked: new Map(),
    };
    return connection;
  }

  // Offline is normal: the vault is kept, and every round tries again.
  async function round() {
    const current = vault;
    const round = generation;
    if (current?.closed) {
      // Saved again until it sticks: a closed vault must stay closed after a
      // restart, even if the notice later disappears.
      if (closedUnsaved) {
        await vaults.save(current);
        closedUnsaved = false;
      }
      return;
    }
    if (!current) {
      return;
    }
    if (stillWaiting(waitUntil, now())) {
      error = throttledMessage(waitUntil - now());
      return;
    }
    const at = connection ?? (await connect(current, round));
    if (!at) {
      return;
    }
    const outcome = await guardedRound(at, {
      fileKey: fileKeyOf(current.key),
      id: vaultIdOf(current.key),
      deviceId: current.deviceId,
    });
    if (round !== generation) {
      return;
    }
    if (outcome === 'closed') {
      vault = { ...current, closed: true };
      connection = null;
      error = null;
      closedUnsaved = true;
      await vaults.save(vault);
      closedUnsaved = false;
      return;
    }
    error = outcome === 'paused' ? pausedMessage : at.engine.status().error;
    if (outcome === 'synced') {
      await sharing?.round(options.sharedPlaceFor?.(current) ?? null);
    }
  }

  // Rounds and changes of vault run one at a time, in the order asked.
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = inFlight.then(action);
    inFlight = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  // A round asked for while another waits joins it, so a slow round (the
  // first one, or a relay that hangs) never piles more up behind it.
  let queued: Promise<void> | null = null;
  function refresh(): Promise<void> {
    queued ??= exclusive(async () => {
      queued = null;
      // A round that only waits isn't shown as syncing, or the status would
      // flip between the two every round.
      const quiet = vault !== null && stillWaiting(waitUntil, now());
      if (!quiet) {
        syncing = true;
        onChange();
      }
      try {
        await round();
      } catch (failure) {
        if (failure instanceof Throttled) {
          waitUntil = now() + failure.retryAfterMs;
        }
        error = messageOf(failure);
      } finally {
        syncing = false;
        onChange();
      }
    });
    return queued;
  }

  // What this phone published to a vault it leaves, so that vault doesn't
  // keep copies nobody syncs any more. Deletions stay for devices that
  // haven't seen them. Best effort: the old place may be unreachable.
  async function leave(old: StoredVault, ids: string[]) {
    try {
      await removePublishedFiles(transportFor(old), old.deviceId, ids);
    } catch {
      return;
    }
  }

  const published = () => store.ids().filter((id) => !store.isDeleted(id));

  return {
    load: async () => {
      try {
        vault = await vaults.load();
        unreadable = null;
      } catch (failure) {
        unreadable = messageOf(failure);
      }
      await sharing?.load(vault);
      onChange();
    },
    state: (): SyncState => {
      if (unreadable !== null) {
        return {
          status: 'unavailable',
          error: unreadable,
          reset: 'pair-again',
        };
      }
      if (!vault) {
        return { status: 'unpaired' };
      }
      const status = connection?.engine.status();
      return {
        status: 'paired',
        vaultCode: vaultCodeOf(vaultIdOf(vault.key)),
        relayHost: new URL(vault.relayUrl).host,
        syncing,
        lastSyncedAt: status?.lastSyncedAt ?? null,
        devices: status?.devices ?? 0,
        error,
        closed: vault.closed,
      };
    },
    // Takes the vault the computer handed over and starts syncing at once;
    // the meetings arrive while the list is already showing. Only a vault
    // that can't be used throws; a relay that can't be reached shows as the
    // sync error.
    pair: async (pairing: PairingOffer) => {
      const id = vaultIdOf(pairing.key);
      const left = await exclusive(async () => {
        if (unreadable !== null) {
          throw new Error(
            'The sync key saved on this phone couldn’t be read. Stop syncing on this phone first.',
          );
        }
        const current = vault;
        const same = current !== null && vaultIdOf(current.key) === id;
        if (same && current.closed) {
          throw new Error(
            'Sync through that code has stopped. Pair with a device that shows the new one.',
          );
        }
        if (current && !same && !current.closed) {
          throw new Error(
            'This phone already syncs with another recovery phrase',
          );
        }
        const next: StoredVault = {
          key: pairing.key,
          deviceId: same ? current.deviceId : newId(),
          relayUrl: pairing.relayUrl,
          closed: false,
        };
        const ids = published();
        // Another phrase is another identity: every share ends, best
        // effort, before this phone becomes someone else to its peers.
        if (current && !same) {
          await sharing
            ?.endAll(options.sharedPlaceFor?.(current) ?? null)
            .catch(() => undefined);
        }
        await vaults.save(next);
        generation += 1;
        vault = next;
        connection = null;
        await sharing?.load(next);
        // Scanning a code is one deliberate ask of the place, and may be
        // another place; a relay still refusing says so again.
        waitUntil = 0;
        error = null;
        onChange();
        return current && !same ? { vault: current, ids } : null;
      });
      const first = refresh();
      // After the first round, so the meetings arrive without waiting on the
      // old place, which may be slow or gone.
      if (left) {
        void first.then(() => leave(left.vault, left.ids));
      }
    },
    // Leaves the vault: what this phone published there is removed, its
    // meetings stay here, and it can pair again with any code. Also the way
    // out of a saved vault that can't be read.
    unpair: async () => {
      const current = vault;
      const ids = published();
      // Shares end with the vault: this phone's note copies come off the
      // relay where it can be reached, and every peer is marked stopped.
      if (current && !current.closed) {
        await sharing
          ?.endAll(options.sharedPlaceFor?.(current) ?? null)
          .catch(() => undefined);
      }
      await vaults.clear();
      // At once, not after the round in progress: that round is stopped and
      // its results dropped, and the phone is unpaired as soon as the user
      // asks.
      generation += 1;
      connection?.engine.stop();
      connection = null;
      waitUntil = 0;
      error = null;
      vault = null;
      unreadable = null;
      await sharing?.load(null);
      onChange();
      // Once the stopped round has ended, so it can't write a copy back
      // after it was removed.
      if (current && !current.closed) {
        await exclusive(() => leave(current, ids));
      }
    },
    refresh,
  };
}
