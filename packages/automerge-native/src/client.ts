import type { Request } from './protocol.ts';
import { isRecord } from './guards.ts';

/** The native Automerge document store: one JSON request in, one JSON reply out. */
export type NativeCore = { call(request: string): string };

export class Client {
  private readonly core: NativeCore;
  private readonly finalizer: FinalizationRegistry<number> | null;

  constructor(core: NativeCore) {
    this.core = core;
    this.finalizer =
      typeof FinalizationRegistry === 'function'
        ? new FinalizationRegistry((doc) =>
            core.call(JSON.stringify({ op: 'free', doc })),
          )
        : null;
  }

  send(request: Request): unknown {
    const reply: unknown = JSON.parse(this.core.call(JSON.stringify(request)));
    if (isRecord(reply) && 'err' in reply) {
      throw new RangeError(String(reply.err));
    }
    if (isRecord(reply) && 'ok' in reply) {
      return reply.ok;
    }
    throw new Error('the native Automerge backend sent a malformed reply');
  }

  /** Frees the document when its handle is collected without free(). */
  track(handle: object, doc: number): void {
    this.finalizer?.register(handle, doc, handle);
  }

  free(handle: object, doc: number): void {
    this.finalizer?.unregister(handle);
    this.send({ op: 'free', doc });
  }
}
