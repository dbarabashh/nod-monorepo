import {
  blindedDeviceId,
  identityCard,
  identityCodeOf,
  identityHex,
  identityOf,
  parseIdentityCard,
  vaultIdOf,
  type Identity,
} from '../crypto/index.ts';
import type { Cipher, Meeting } from '../meetings/index.ts';
import {
  createDocumentSyncEngine,
  messageOf,
  type PublishedLog,
  type SyncEngine,
} from '../sync/engine.ts';
import { notePath } from '../sync/layout.ts';
import { RequestRefused, type Transport } from '../sync/transport.ts';
import {
  createNoteStore,
  type NoteFiles,
  type NoteStore,
} from './note-store.ts';
import { editNoteSummary, noteFromMeeting, type SharedNote } from './note.ts';
import type { Peer } from './shares-document.ts';
import {
  createSharesStore,
  type SharesFile,
  type SharesStore,
} from './shares-store.ts';
import {
  oneToOneKeyId,
  oneToOneVault,
  sharedNoteDocuments,
  sharesDocuments,
  type OneToOneVault,
} from './vaults.ts';

// Where shared vaults' files live and how to reach them: the app knows its
// folder or relay, the session knows the vaults. A place is named so a
// published log can be scoped to it.
export type SharedPlace = {
  name: string;
  open: (vault: { id: string; token: string }) => Promise<Transport>;
};

export type SharingPeerInfo = {
  identity: string;
  code: string;
  stoppedAt: number | null;
};

export type SharedNoteSummary = {
  id: string;
  title: string;
  sharedAt: number;
  peer: string;
  peerCode: string;
};

export type SharedNoteDetail = SharedNote & { peer: string };

export type SharingSnapshot =
  | { status: 'none' }
  | {
      status: 'ready';
      code: string;
      peers: SharingPeerInfo[];
      notes: SharedNoteSummary[];
      error: string | null;
    };

// The vault shared with one person, derived once from their card, and the
// engine that moves its notes through the current place.
type PeerVault = {
  identity: string;
  vault: OneToOneVault;
  blinded: string;
  store: NoteStore;
  engine: SyncEngine | null;
  transport: Transport | null;
  placeName: string | null;
};

const oldRelayMessage =
  'This relay doesn’t do sharing yet, so your shares list stays on this device until the relay is updated.';

export type SharingSession = ReturnType<typeof createSharingSession>;

export function createSharingSession(options: {
  // The shares list belongs to one vault: another phrase is another person
  // to the people they share with, so it starts its own list.
  sharesFileFor: (vaultId: string) => SharesFile;
  noteFilesFor: (vaultId: string) => NoteFiles;
  cipher: () => Promise<Cipher>;
  publishedLogFor?: (scope: string) => Promise<PublishedLog>;
  newId: () => string;
  now: () => number;
  onChange: () => void;
}) {
  const { newId, now, onChange } = options;
  let identity: Identity | null = null;
  let deviceId: string | null = null;
  let sharesStore: SharesStore | null = null;
  let cipher: Cipher | null = null;
  const vaults = new Map<string, PeerVault>();
  let error: string | null = null;
  let busy: Promise<void> = Promise.resolve();

  async function requireCipher(): Promise<Cipher> {
    cipher ??= await options.cipher();
    return cipher;
  }

  function requireIdentity(): { identity: Identity; deviceId: string } {
    if (!identity || !deviceId) {
      throw new Error('Set up a recovery phrase before sharing');
    }
    return { identity, deviceId };
  }

  function requireShares(): SharesStore {
    if (!sharesStore) {
      throw new Error('Saved shares could not be read');
    }
    return sharesStore;
  }

  function peers(): Peer[] {
    return sharesStore?.shares().peers ?? [];
  }

  function peerOf(peerIdentity: string): Peer {
    const peer = peers().find((entry) => entry.identity === peerIdentity);
    if (!peer) {
      throw new Error('Nobody with that identity is shared with');
    }
    return peer;
  }

  // Nothing is written for a person sharing was stopped with; their vault is
  // still derived to take this device's copies out of it.
  function requireActive(peerIdentity: string): Peer {
    const peer = peerOf(peerIdentity);
    if (peer.stoppedAt !== null) {
      throw new Error('Sharing with that person was stopped');
    }
    return peer;
  }

  function activePeers(): string[] {
    return peers()
      .filter((peer) => peer.stoppedAt === null)
      .map((peer) => peer.identity);
  }

  function stopEngines() {
    for (const entry of vaults.values()) {
      entry.engine?.stop();
    }
    vaults.clear();
  }

  async function vaultFor(peerIdentity: string): Promise<PeerVault> {
    const known = vaults.get(peerIdentity);
    if (known) {
      return known;
    }
    const card = parseIdentityCard(peerOf(peerIdentity).card);
    if (!card) {
      throw new Error('Nobody with that identity is shared with');
    }
    const me = requireIdentity();
    const vault = oneToOneVault(me.identity, card);
    const store = createNoteStore({
      files: options.noteFilesFor(vault.id),
      cipher: await requireCipher(),
    });
    await store.load();
    const entry: PeerVault = {
      identity: peerIdentity,
      vault,
      blinded: blindedDeviceId(me.identity, vault.id, me.deviceId),
      store,
      engine: null,
      transport: null,
      placeName: null,
    };
    vaults.set(peerIdentity, entry);
    return entry;
  }

  async function engineFor(
    entry: PeerVault,
    place: SharedPlace,
  ): Promise<{ engine: SyncEngine; transport: Transport }> {
    if (entry.engine && entry.transport && entry.placeName === place.name) {
      return { engine: entry.engine, transport: entry.transport };
    }
    const { vault, blinded } = entry;
    const transport = await place.open({ id: vault.id, token: vault.token });
    const engine = createDocumentSyncEngine({
      transport,
      vault: { deviceId: blinded },
      documents: sharedNoteDocuments({
        id: vault.id,
        fileKey: vault.fileKey,
        keyId: oneToOneKeyId(),
        identity: requireIdentity().identity,
        publishers: vault.publishers,
      }),
      store: entry.store,
      onRemote: () => onChange(),
      now,
      publishedLog: await options.publishedLogFor?.(
        `${vault.id}:${blinded}:${place.name}`,
      ),
    });
    entry.engine = engine;
    entry.transport = transport;
    entry.placeName = place.name;
    return { engine, transport };
  }

  // Ends this device's part in a share: its copies leave the shared vault,
  // the engine stops, and the vault is forgotten here. The other person
  // keeps what they already received. The share ends here whatever the
  // place answers: a place that can't be reached keeps the copies, and says
  // so, but never keeps the share alive.
  async function retire(
    peerIdentity: string,
    place: SharedPlace | null,
  ): Promise<string | null> {
    const entry =
      vaults.get(peerIdentity) ??
      (await vaultFor(peerIdentity).catch(() => null));
    if (!entry) {
      return null;
    }
    let failed: string | null = null;
    if (place) {
      try {
        const { transport } = await engineFor(entry, place);
        for (const id of entry.store.ids()) {
          await transport.remove(notePath(entry.blinded, id));
        }
      } catch (failure) {
        failed = `The copies this device put in the shared vault stayed there: ${messageOf(failure)}`;
      }
    }
    entry.engine?.stop();
    vaults.delete(peerIdentity);
    return failed;
  }

  // A share stopped on another of this person's devices ends here too, once
  // the shares list brings the stop over.
  async function retireStopped(place: SharedPlace): Promise<string[]> {
    const active = new Set(activePeers());
    const gone = [...vaults.keys()].filter((peer) => !active.has(peer));
    const failures = await Promise.all(gone.map((peer) => retire(peer, place)));
    return failures.filter((failed) => failed !== null);
  }

  async function peerRound(
    peer: string,
    place: SharedPlace,
  ): Promise<string[]> {
    try {
      const entry = await vaultFor(peer);
      const { engine } = await engineFor(entry, place);
      await engine.sync();
      const failed = engine.status().error;
      return failed ? [failed] : [];
    } catch (failure) {
      return [messageOf(failure)];
    }
  }

  function peersOf(): SharingPeerInfo[] {
    return peers().map(({ identity: peer, code, stoppedAt }) => ({
      identity: peer,
      code,
      stoppedAt,
    }));
  }

  async function withLock<T>(action: () => Promise<T>): Promise<T> {
    const run = busy.then(action);
    busy = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    // Takes the person's identity from their vault key once sync has it;
    // nothing about sharing exists before a recovery phrase does.
    load: async (vault: { key: Uint8Array; deviceId: string } | null) => {
      stopEngines();
      if (!vault) {
        identity = null;
        deviceId = null;
        sharesStore = null;
        return;
      }
      identity = identityOf(vault.key);
      deviceId = vault.deviceId;
      // Another vault's list must never serve this one, however its own
      // list fails to load.
      sharesStore = null;
      try {
        const store = createSharesStore({
          file: options.sharesFileFor(vaultIdOf(vault.key)),
          cipher: await requireCipher(),
        });
        await store.load();
        sharesStore = store;
        error = null;
      } catch (failure) {
        error = messageOf(failure);
      }
      await Promise.all(
        activePeers().map((peer) =>
          vaultFor(peer).catch((failure: unknown) => {
            error = messageOf(failure);
          }),
        ),
      );
    },
    // The engine that carries the shares list through the person's own
    // vault, beside their meetings; it runs in that vault's round.
    sharesEngine: async (
      vault: { id: string; key: Uint8Array; deviceId: string },
      transport: Transport,
      placeName: string,
    ): Promise<SyncEngine | null> => {
      const store = sharesStore;
      if (!store) {
        return null;
      }
      // A place from before sharing refuses the shares list's path; the
      // person is told what that means rather than shown a bare 400.
      const guarded: Transport = {
        ...transport,
        write: async (path, data) => {
          try {
            return await transport.write(path, data);
          } catch (failure) {
            throw failure instanceof RequestRefused && failure.status === 400
              ? new Error(oldRelayMessage)
              : failure;
          }
        },
      };
      return createDocumentSyncEngine({
        transport: guarded,
        vault: { deviceId: vault.deviceId },
        documents: sharesDocuments(vault),
        store,
        onRemote: () => onChange(),
        now,
        publishedLog: await options.publishedLogFor?.(
          `shares:${vault.id}:${vault.deviceId}:${placeName}`,
        ),
      });
    },
    // One round per shared vault, each through the same kind of place the
    // person's own vault uses. The vaults are independent, so their rounds
    // run side by side. A shared vault is never closed by a notice: it
    // carries no identity, so either person could stop the other for good.
    round: async (place: SharedPlace | null) => {
      if (!place || !identity) {
        return;
      }
      await withLock(async () => {
        const retired = await retireStopped(place);
        const rounds = await Promise.all(
          activePeers().map((peer) => peerRound(peer, place)),
        );
        error = [...retired, ...rounds.flat()][0] ?? null;
      });
      onChange();
    },
    snapshot: (): SharingSnapshot => {
      if (!identity) {
        return { status: 'none' };
      }
      const known = peersOf();
      const notes: SharedNoteSummary[] = [];
      for (const peer of known) {
        const entry = vaults.get(peer.identity);
        for (const note of entry?.store.notes() ?? []) {
          notes.push({
            id: note.id,
            title: note.title,
            sharedAt: note.sharedAt,
            peer: peer.identity,
            peerCode: peer.code,
          });
        }
      }
      notes.sort((a, b) => b.sharedAt - a.sharedAt);
      return {
        status: 'ready',
        code: identityCodeOf(identity.publicKey),
        peers: known,
        notes,
        error,
      };
    },
    identityCard: (): string => identityCard(requireIdentity().identity),
    identityCode: (): string =>
      identityCodeOf(requireIdentity().identity.publicKey),
    // Whose card this is, so the user can compare the code with the person
    // before adding them.
    previewPeer: (card: string): { identity: string; code: string } => {
      const parsed = parseIdentityCard(card.trim());
      if (!parsed) {
        throw new Error('That is not an identity card');
      }
      const me = requireIdentity();
      if (
        identityHex(parsed.publicKey) === identityHex(me.identity.publicKey)
      ) {
        throw new Error('That is your own identity card');
      }
      return {
        identity: identityHex(parsed.publicKey),
        code: identityCodeOf(parsed.publicKey),
      };
    },
    addPeer: (card: string) =>
      withLock(async () => {
        const trimmed = card.trim();
        const parsed = parseIdentityCard(trimmed);
        if (!parsed) {
          throw new Error('That is not an identity card');
        }
        // Derived first: a card this device can't share with (its own, or a
        // crafted key) must never reach the list, where every device would
        // fail on it and nothing could remove it.
        oneToOneVault(requireIdentity().identity, parsed);
        await requireShares().addPeer(trimmed);
        await vaultFor(identityHex(parsed.publicKey));
        onChange();
      }),
    // Stopping removes this device's copies from the shared vault and stops
    // syncing it; the other person keeps what they already received.
    stopPeer: (peerIdentity: string, place: SharedPlace | null) =>
      withLock(async () => {
        const failed = await retire(peerIdentity, place);
        await requireShares().stopPeer(peerIdentity, now());
        error = failed;
        onChange();
      }),
    // Ends every share this device is in, for a phrase change or for leaving
    // the vault: the copies come off the place where it can be reached, and
    // each peer is marked stopped so no device of this person carries on.
    endAll: (place: SharedPlace | null) =>
      withLock(async () => {
        if (!sharesStore) {
          return;
        }
        const failures: string[] = [];
        for (const peer of activePeers()) {
          const failed = await retire(peer, place);
          if (failed) {
            failures.push(failed);
          }
          try {
            await requireShares().stopPeer(peer, now());
          } catch (failure) {
            failures.push(messageOf(failure));
          }
        }
        error = failures[0] ?? null;
        onChange();
      }),
    shareMeeting: (
      meeting: Meeting,
      name: string,
      peerIdentity: string,
    ): Promise<SharedNoteSummary> =>
      withLock(async () => {
        const peer = requireActive(peerIdentity);
        const entry = await vaultFor(peerIdentity);
        const note = noteFromMeeting(meeting, name, newId(), now());
        await entry.store.save(note);
        onChange();
        return {
          id: note.id,
          title: note.title,
          sharedAt: note.sharedAt,
          peer: peerIdentity,
          peerCode: peer.code,
        };
      }),
    note: async (
      peerIdentity: string,
      id: string,
    ): Promise<SharedNoteDetail> => {
      requireActive(peerIdentity);
      const note = (await vaultFor(peerIdentity)).store.note(id);
      if (!note) {
        throw new Error('That note is gone');
      }
      return { ...note, peer: peerIdentity };
    },
    editNote: (peerIdentity: string, id: string, summary: string) =>
      withLock(async () => {
        requireActive(peerIdentity);
        const entry = await vaultFor(peerIdentity);
        const note = entry.store.note(id);
        if (!note) {
          throw new Error('That note is gone');
        }
        await entry.store.save(editNoteSummary(note, summary));
        onChange();
      }),
    deleteNote: (peerIdentity: string, id: string) =>
      withLock(async () => {
        requireActive(peerIdentity);
        const entry = await vaultFor(peerIdentity);
        await entry.store.remove(id, now());
        onChange();
      }),
  };
}
