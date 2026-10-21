import { randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { NativeCore } from '../client.ts';

const defaultPath = new URL('../../build/nod_automerge.wasm', import.meta.url);

function exportedFunction(exports: WebAssembly.Exports, name: string) {
  const value = exports[name];
  if (typeof value !== 'function') {
    throw new Error(`the Automerge wasm build has no ${name}`);
  }
  return (...args: number[]): number =>
    Number(Reflect.apply(value, undefined, args));
}

/**
 * The native Automerge backend compiled to plain wasm (no JS bindings), so
 * Node runs the exact request handling the iOS and Android builds ship.
 */
export function loadWasmCore(path: URL | string = defaultPath): NativeCore {
  let memory: WebAssembly.Memory | null = null;
  const fill = (ptr: number, len: number) => {
    if (memory) {
      randomFillSync(new Uint8Array(memory.buffer, ptr, len));
    }
    return 0;
  };
  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(readFileSync(path)),
    { env: { host_random: fill, __getrandom_v03_custom: fill } },
  );
  const exported = instance.exports.memory;
  if (!(exported instanceof WebAssembly.Memory)) {
    throw new Error('the Automerge wasm build exports no memory');
  }
  memory = exported;
  const alloc = exportedFunction(instance.exports, 'nod_am_alloc');
  const free = exportedFunction(instance.exports, 'nod_am_free');
  const call = exportedFunction(instance.exports, 'nod_am_call');
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const lengthPtr = alloc(4);

  return {
    call(request) {
      const bytes = encoder.encode(request);
      const requestPtr = alloc(bytes.length);
      new Uint8Array(exported.buffer, requestPtr, bytes.length).set(bytes);
      const replyPtr = call(requestPtr, bytes.length, lengthPtr);
      const length = new DataView(exported.buffer).getUint32(lengthPtr, true);
      const reply = decoder.decode(
        new Uint8Array(exported.buffer, replyPtr, length),
      );
      free(replyPtr, length);
      free(requestPtr, bytes.length);
      return reply;
    },
  };
}
