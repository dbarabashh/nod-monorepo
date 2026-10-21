import type { use } from '@automerge/automerge/slim';
import { Client, type NativeCore } from './client.ts';
import { isRecord } from './guards.ts';
import { NativeHandle } from './document/handle.ts';
import { refusals, unsupportedModuleFunctions } from './unsupported.ts';
import { bytesToBase64 } from './values/base64.ts';
import { wellFormed } from './values/strings.ts';

export type Api = Parameters<typeof use>[0];

const apiMembers: Record<keyof Api, true> = {
  create: true,
  load: true,
  encodeChange: true,
  decodeChange: true,
  initSyncState: true,
  encodeSyncMessage: true,
  decodeSyncMessage: true,
  encodeSyncState: true,
  decodeSyncState: true,
  exportSyncState: true,
  importSyncState: true,
  readBundle: true,
  wasmReleaseInfo: true,
};

// Automerge's declared backend types disagree with what its wasm backend
// returns at runtime (uint values are BigInts, values may be class instances),
// and this backend returns what wasm returns. So the object is checked to have
// every API member rather than matched against those signatures.
function isApi(value: unknown): value is Api {
  return (
    isRecord(value) &&
    Object.keys(apiMembers).every((key) => typeof value[key] === 'function')
  );
}

function actorOf(actor: string | undefined): string | undefined {
  return actor === undefined ? undefined : wellFormed(actor);
}

type LoadOptions = {
  actor?: string;
  unchecked?: boolean;
  allowMissingDeps?: boolean;
  convertImmutableStringsToText?: boolean;
};

/** An Automerge backend for `use()` that keeps documents in the native store. */
export function createBackend(core: NativeCore): Api {
  const client = new Client(core);
  const api = {
    ...refusals(unsupportedModuleFunctions),
    create(options?: { actor?: string }) {
      return new NativeHandle(
        client,
        client.send({ op: 'create', actor: actorOf(options?.actor) }),
      );
    },
    load(data: Uint8Array, options: LoadOptions = {}) {
      return new NativeHandle(
        client,
        client.send({
          op: 'load',
          bytes: bytesToBase64(data),
          actor: actorOf(options.actor),
          unchecked: options.unchecked,
          allowMissingDeps: options.allowMissingDeps,
          convertImmutableStringsToText: options.convertImmutableStringsToText,
        }),
      );
    },
    wasmReleaseInfo: () => client.send({ op: 'info' }),
  };
  if (!isApi(api)) {
    throw new Error('the native Automerge backend is missing API members');
  }
  return api;
}
