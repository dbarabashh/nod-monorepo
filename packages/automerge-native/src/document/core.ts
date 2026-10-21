import type { Client } from '../client.ts';
import { arrayOf, numberOf, stringOf } from '../guards.ts';
import type { DocOp } from '../protocol.ts';
import { base64ToBytes, bytesToBase64 } from '../values/base64.ts';
import type { Externals } from '../values/import-object.ts';
import { timeOf } from '../values/keys.ts';
import { wellFormed } from '../values/strings.ts';

export function headsOf(heads: unknown): string[] | undefined {
  if (heads == null) {
    return undefined;
  }
  if (!Array.isArray(heads)) {
    throw new RangeError('bad heads: the change hashes were not an array');
  }
  return heads.map((head) => wellFormed(String(head)));
}

const changeHash = /^[0-9a-f]{64}$/;

// wasm's fork reads heads leniently: anything but valid hashes forks it all.
function forkHeads(heads: unknown): string[] | undefined {
  return Array.isArray(heads) &&
    heads.every((head) => typeof head === 'string' && changeHash.test(head))
    ? heads
    : undefined;
}

export function strings(value: unknown): string[] {
  return arrayOf(value, stringOf);
}

function byteArrays(value: unknown): Uint8Array[] {
  return arrayOf(value, base64ToBytes);
}

/** A document's place in the native store, its lifecycle and its history. */
export abstract class DocumentCore {
  // Automerge's proxies tell documents apart by wasm-bindgen's pointer; 0 means freed.
  __wbg_ptr: number;
  protected readonly client: Client;
  protected readonly externals: Externals;
  protected freeze: boolean;

  constructor(
    client: Client,
    id: unknown,
    freeze: boolean,
    externals: Externals,
  ) {
    this.client = client;
    this.__wbg_ptr = numberOf(id);
    this.freeze = freeze;
    this.externals = new Map(externals);
    client.track(this, this.__wbg_ptr);
  }

  protected abstract wrap(id: unknown): DocumentCore;

  protected get id(): number {
    if (this.__wbg_ptr === 0) {
      throw new Error('null pointer passed to rust');
    }
    return this.__wbg_ptr;
  }

  private static idOf(other: unknown): number {
    if (!(other instanceof DocumentCore)) {
      throw new Error('null pointer passed to rust');
    }
    return other.id;
  }

  protected doc(op: DocOp): unknown {
    return this.client.send({ ...op, doc: this.id });
  }

  free(): void {
    if (this.__wbg_ptr !== 0) {
      const id = this.__wbg_ptr;
      this.__wbg_ptr = 0;
      this.client.free(this, id);
    }
  }

  [Symbol.dispose](): void {
    this.free();
  }

  clone(actor?: string | null): DocumentCore {
    return this.wrap(
      this.client.send({
        op: 'clone',
        doc: this.id,
        actor: actor == null ? undefined : wellFormed(actor),
      }),
    );
  }

  fork(actor?: string | null, heads?: unknown): DocumentCore {
    return this.wrap(
      this.client.send({
        op: 'fork',
        doc: this.id,
        actor: actor == null ? undefined : wellFormed(actor),
        heads: forkHeads(heads),
      }),
    );
  }

  merge(other: unknown): string[] {
    return strings(
      this.client.send({
        op: 'merge',
        doc: this.id,
        other: DocumentCore.idOf(other),
      }),
    );
  }

  getChangesAdded(other: unknown): Uint8Array[] {
    return byteArrays(
      this.client.send({
        op: 'getChangesAdded',
        doc: this.id,
        other: DocumentCore.idOf(other),
      }),
    );
  }

  pendingOps(): number {
    return numberOf(this.doc({ op: 'pendingOps' }));
  }

  commit(message?: string | null, time?: unknown): string | null {
    const hash = this.doc({
      op: 'commit',
      message: message == null ? undefined : wellFormed(message),
      time: timeOf(time),
    });
    return hash === null ? null : stringOf(hash);
  }

  emptyChange(message?: string | null, time?: unknown): string {
    return stringOf(
      this.doc({
        op: 'emptyChange',
        message: message == null ? undefined : wellFormed(message),
        time: timeOf(time),
      }),
    );
  }

  rollback(): number {
    return numberOf(this.doc({ op: 'rollback' }));
  }

  getHeads(): string[] {
    return strings(this.doc({ op: 'getHeads' }));
  }

  getActorId(): string {
    return stringOf(this.doc({ op: 'getActorId' }));
  }

  save(): Uint8Array {
    return base64ToBytes(this.doc({ op: 'save' }));
  }

  saveIncremental(): Uint8Array {
    return base64ToBytes(this.doc({ op: 'saveIncremental' }));
  }

  saveSince(heads: unknown): Uint8Array {
    return base64ToBytes(this.doc({ op: 'saveSince', heads: headsOf(heads) }));
  }

  loadIncremental(data: Uint8Array): number {
    return numberOf(
      this.doc({ op: 'loadIncremental', bytes: bytesToBase64(data) }),
    );
  }

  applyChanges(changes: Uint8Array[]): void {
    this.doc({ op: 'applyChanges', changes: changes.map(bytesToBase64) });
  }

  getChanges(heads: unknown): Uint8Array[] {
    return byteArrays(this.doc({ op: 'getChanges', heads: headsOf(heads) }));
  }

  getMissingDeps(heads?: unknown): string[] {
    return strings(this.doc({ op: 'getMissingDeps', heads: headsOf(heads) }));
  }

  getLastLocalChange(): Uint8Array | null {
    const change = this.doc({ op: 'getLastLocalChange' });
    return change === null ? null : base64ToBytes(change);
  }
  isolate(heads: unknown): void {
    if (!Array.isArray(heads)) {
      throw new RangeError('isolate needs heads');
    }
    this.doc({ op: 'isolate', heads: headsOf(heads) ?? [] });
  }

  integrate(): void {
    this.doc({ op: 'integrate' });
  }
}
