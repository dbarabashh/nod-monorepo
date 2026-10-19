import {
  loadDocument,
  sameDocument,
  saveDocument,
  type DocumentState,
  type MeetingDocument,
} from '../meetings/index.ts';
import { open, seal } from '../crypto/index.ts';
import {
  devicesPrefix,
  meetingContext,
  meetingPath,
  parseMeetingPath,
} from './layout.ts';
import type { Transport } from './transport.ts';

// Far above any real meeting, so a planted huge file is refused before it is
// read into memory.
const maxDocumentBytes = 64 * 1024 * 1024;

// A merge is adopted at once and its state returned, so the caller can show
// it before anything else changes the meeting; the write happens after. A
// meeting restored over a damaged copy is only announced once written.
export type Merged = {
  state: DocumentState | null;
  written: Promise<DocumentState | null>;
};

// What sync needs from the store that keeps meetings on this device.
export type SyncStore = {
  ids: () => string[];
  document: (id: string) => MeetingDocument | undefined;
  merge: (id: string, remote: MeetingDocument) => Merged;
};

export type SyncStatus = {
  lastSyncedAt: number | null;
  devices: number;
  error: string | null;
};

export type SyncEngine = {
  sync: () => Promise<void>;
  status: () => SyncStatus;
};

export function createSyncEngine(options: {
  transport: Transport;
  vault: { id: string; key: Uint8Array; deviceId: string };
  store: SyncStore;
  onRemote: (state: DocumentState) => void;
  now: () => number;
}): SyncEngine {
  const { transport, vault, store, onRemote, now } = options;
  const published = new Map<string, MeetingDocument>();
  const seen = new Map<string, string>();
  let status: SyncStatus = { lastSyncedAt: null, devices: 0, error: null };
  let running: Promise<void> = Promise.resolve();

  async function publish(id: string) {
    const document = store.document(id);
    const last = published.get(id);
    if (!document || (last && sameDocument(last, document))) {
      return;
    }
    await transport.write(
      meetingPath(vault.deviceId, id),
      seal(
        vault.key,
        saveDocument(document),
        meetingContext(vault.id, vault.deviceId, id),
      ),
    );
    published.set(id, document);
  }

  async function receive(path: string, deviceId: string, meetingId: string) {
    const sealed = await transport.read(path, maxDocumentBytes);
    if (!sealed) {
      return;
    }
    const document = loadDocument(
      open(vault.key, sealed, meetingContext(vault.id, deviceId, meetingId)),
    );
    if (!document) {
      throw new Error('A meeting from another device could not be read');
    }
    const { state, written } = store.merge(meetingId, document);
    if (state) {
      onRemote(state);
    }
    const restored = await written;
    if (restored) {
      onRemote(restored);
    }
  }

  async function round() {
    const failures: string[] = [];
    for (const id of store.ids()) {
      await publish(id).catch((error: unknown) => {
        failures.push(messageOf(error));
      });
    }
    const files = await transport.list(devicesPrefix());
    const devices = new Set<string>();
    for (const file of files) {
      const parsed = parseMeetingPath(file.path);
      if (!parsed || parsed.deviceId === vault.deviceId) {
        continue;
      }
      devices.add(parsed.deviceId);
      if (seen.get(file.path) === file.version) {
        continue;
      }
      try {
        await receive(file.path, parsed.deviceId, parsed.meetingId);
        seen.set(file.path, file.version);
      } catch (error) {
        failures.push(messageOf(error));
      }
    }
    // Merging can change local documents, and what changed is published
    // straight away so other devices converge in one more round.
    for (const id of store.ids()) {
      await publish(id).catch((error: unknown) => {
        failures.push(messageOf(error));
      });
    }
    status = {
      lastSyncedAt: failures.length === 0 ? now() : status.lastSyncedAt,
      devices: devices.size,
      error: failures[0] ?? null,
    };
  }

  return {
    sync: () => {
      const next = running.then(round).catch((error: unknown) => {
        status = { ...status, error: messageOf(error) };
      });
      running = next;
      return next;
    },
    status: () => status,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
