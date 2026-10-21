import { use } from '@automerge/automerge/slim';
import { requireNativeModule } from 'expo-modules-core';
import { createBackend } from '../backend.ts';
import type { NativeCore } from '../client.ts';

let installed = false;

/** Runs Automerge on the native backend. Call once, before any document is made. */
export function installNativeAutomerge(): void {
  if (installed) {
    return;
  }
  const native = requireNativeModule<NativeCore>('NodAutomerge');
  use(createBackend({ call: (request) => native.call(request) }));
  installed = true;
}
