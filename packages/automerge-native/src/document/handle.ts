import type { Client } from '../client.ts';
import { stringOf } from '../guards.ts';
import { refusals, unsupportedDocumentMethods } from '../unsupported.ts';
import {
  importHydrate,
  importTopObject,
  type Externals,
} from '../values/import-object.ts';
import { requireScalar } from '../values/import-scalar.ts';
import {
  requireKey,
  toCount,
  toFinite,
  toIndex,
  toWrappedCount,
} from '../values/keys.ts';
import { wellFormed } from '../values/strings.ts';
import { DocumentReads } from './reads.ts';

/** A document in the native store, with the methods of wasm's Automerge class. */
export class NativeHandle extends DocumentReads {
  constructor(
    client: Client,
    id: unknown,
    freeze = false,
    externals: Externals = new Map(),
  ) {
    super(client, id, freeze, externals);
  }

  protected wrap(id: unknown): NativeHandle {
    return new NativeHandle(this.client, id, this.freeze, this.externals);
  }

  splice(
    obj: string,
    start: number,
    deleteCount: number,
    text?: unknown,
  ): void {
    const inserted =
      typeof text === 'string'
        ? { text: wellFormed(text) }
        : {
            values: Array.isArray(text)
              ? text.map((value) => requireScalar(value))
              : [],
          };
    this.doc({
      op: 'splice',
      obj: wellFormed(obj),
      start: toIndex(start),
      delete: toCount(deleteCount),
      ...inserted,
    });
  }

  updateText(obj: string, text: unknown): void {
    if (typeof text !== 'string') {
      throw new RangeError('updateText needs a string');
    }
    this.doc({
      op: 'updateText',
      obj: wellFormed(obj),
      text: wellFormed(text),
    });
  }

  push(obj: string, value: unknown, datatype?: unknown): void {
    this.doc({
      op: 'push',
      obj: wellFormed(obj),
      value: requireScalar(value, datatype),
    });
  }

  pushObject(obj: string, value: unknown): string {
    return stringOf(
      this.doc({
        op: 'pushObject',
        obj: wellFormed(obj),
        value: importTopObject(value),
      }),
    );
  }

  insert(obj: string, index: number, value: unknown, datatype?: unknown): void {
    this.doc({
      op: 'insert',
      obj: wellFormed(obj),
      index: toIndex(index),
      value: requireScalar(value, datatype),
    });
  }

  insertObject(obj: string, index: number, value: unknown): string {
    return stringOf(
      this.doc({
        op: 'insertObject',
        obj: wellFormed(obj),
        index: toIndex(index),
        value: importTopObject(value),
      }),
    );
  }

  put(obj: string, prop: unknown, value: unknown, datatype?: unknown): void {
    this.doc({
      op: 'put',
      obj: wellFormed(obj),
      prop: requireKey(prop),
      value: requireScalar(value, datatype),
    });
  }

  putObject(obj: string, prop: unknown, value: unknown): string {
    return stringOf(
      this.doc({
        op: 'putObject',
        obj: wellFormed(obj),
        prop: requireKey(prop),
        value: importTopObject(value),
      }),
    );
  }

  putObjectFromHydrate(obj: string, prop: unknown, value: unknown): string {
    return stringOf(
      this.doc({
        op: 'putObjectFromHydrate',
        obj: wellFormed(obj),
        prop: requireKey(prop),
        value: importHydrate(value, this.externals),
      }),
    );
  }

  insertObjectFromHydrate(obj: string, index: number, value: unknown): string {
    return stringOf(
      this.doc({
        op: 'insertObjectFromHydrate',
        obj: wellFormed(obj),
        index: toIndex(index),
        value: importHydrate(value, this.externals),
      }),
    );
  }

  spliceFromHydrate(
    obj: string,
    index: number,
    deleteCount: number,
    values: unknown,
  ): void {
    if (!Array.isArray(values)) {
      throw new RangeError('values must be an array');
    }
    this.doc({
      op: 'spliceFromHydrate',
      obj: wellFormed(obj),
      index: toIndex(index),
      delete: toWrappedCount(deleteCount),
      values: values.map((value) => importHydrate(value, this.externals)),
    });
  }

  initRootFromHydrate(value: unknown): void {
    this.doc({
      op: 'initRootFromHydrate',
      value: importHydrate(value, this.externals),
    });
  }

  increment(obj: string, prop: unknown, value: unknown): void {
    if (typeof value !== 'number') {
      throw new RangeError('increment needs a number');
    }
    this.doc({
      op: 'increment',
      obj: wellFormed(obj),
      prop: requireKey(prop),
      value: toFinite(value),
    });
  }

  delete(obj: string, prop: unknown): void {
    this.doc({ op: 'delete', obj: wellFormed(obj), prop: requireKey(prop) });
  }
}

Object.assign(NativeHandle.prototype, refusals(unsupportedDocumentMethods));
