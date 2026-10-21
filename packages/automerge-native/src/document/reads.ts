import { arrayOf, numberOf, stringOf } from '../guards.ts';
import { buildObject } from '../materialize.ts';
import { exportPatches } from '../patches.ts';
import { exportScalar } from '../values/export-scalar.ts';
import { keyOf } from '../values/keys.ts';
import { wellFormed } from '../values/strings.ts';
import { DocumentCore, headsOf, strings } from './core.ts';

const datatypes = new Set([
  'map',
  'table',
  'list',
  'text',
  'bytes',
  'str',
  'int',
  'uint',
  'f64',
  'counter',
  'timestamp',
  'boolean',
  'null',
]);

// An object comes back as [type, id] and a scalar as [scalar, ...rest].
function exportEntry(entry: unknown): unknown[] {
  if (!Array.isArray(entry)) {
    throw new Error('expected a value from the native backend');
  }
  const [first, ...rest] = entry;
  return typeof first === 'string' ? entry : [...exportScalar(first), ...rest];
}

/** Reading a document: values, JS objects, patches and registered datatypes. */
export abstract class DocumentReads extends DocumentCore {
  private build(tree: unknown, meta: unknown): unknown {
    return buildObject(tree, {
      externals: this.externals,
      meta,
      freeze: this.freeze,
    });
  }

  private materializeAt(
    obj: string,
    heads: unknown,
    meta: unknown,
    updateCursor: boolean,
  ) {
    const tree = this.doc({
      op: 'materialize',
      obj,
      heads: headsOf(heads),
      updateCursor,
    });
    return this.build(tree, meta);
  }

  private patchesAndValue(meta: unknown): {
    value: unknown;
    patches: unknown[];
  } {
    const patches = this.diffIncremental();
    return { value: this.toJS(meta), patches };
  }

  keys(obj: string, heads?: unknown): string[] {
    return strings(
      this.doc({ op: 'keys', obj: wellFormed(obj), heads: headsOf(heads) }),
    );
  }

  text(obj: string, heads?: unknown): string {
    return stringOf(
      this.doc({ op: 'text', obj: wellFormed(obj), heads: headsOf(heads) }),
    );
  }

  length(obj: string, heads?: unknown): number {
    return numberOf(
      this.doc({ op: 'length', obj: wellFormed(obj), heads: headsOf(heads) }),
    );
  }

  getWithType(obj: string, prop: unknown, heads?: unknown): unknown[] | null {
    const key = keyOf(prop);
    if (key === undefined) {
      return null;
    }
    const found = this.doc({
      op: 'getWithType',
      obj: wellFormed(obj),
      prop: key,
      heads: headsOf(heads),
    });
    return found === null ? null : exportEntry(found).slice(0, 2);
  }

  get(obj: string, prop: unknown, heads?: unknown): unknown {
    return this.getWithType(obj, prop, heads)?.[1];
  }

  getAll(obj: string, prop: unknown, heads?: unknown): unknown[][] {
    const key = keyOf(prop);
    if (key === undefined) {
      return [];
    }
    const all = this.doc({
      op: 'getAll',
      obj: wellFormed(obj),
      prop: key,
      heads: headsOf(heads),
    });
    return arrayOf(all, exportEntry);
  }

  materialize(obj = '/', heads?: unknown, meta?: unknown): unknown {
    return this.materializeAt(wellFormed(obj), heads, meta, true);
  }

  toJS(meta?: unknown): unknown {
    return this.materializeAt('_root', undefined, meta, false);
  }

  applyPatches(_object: unknown, meta?: unknown): unknown {
    return this.patchesAndValue(meta).value;
  }

  applyAndReturnPatches(
    _object: unknown,
    meta?: unknown,
  ): { value: unknown; patches: unknown[] } {
    return this.patchesAndValue(meta);
  }

  diffIncremental(): unknown[] {
    return exportPatches(this.doc({ op: 'diffIncremental' }), this.externals);
  }

  updateDiffCursor(): void {
    this.doc({ op: 'updateDiffCursor' });
  }

  resetDiffCursor(): void {
    this.doc({ op: 'resetDiffCursor' });
  }

  enableFreeze(enable: boolean): boolean {
    const previous = this.freeze;
    this.freeze = enable;
    return previous;
  }

  registerDatatype(
    datatype: string,
    construct: unknown,
    deconstruct: unknown,
  ): void {
    if (!datatypes.has(datatype)) {
      throw new RangeError(`unknown datatype ${datatype}`);
    }
    if (typeof construct !== 'function' || typeof deconstruct !== 'function') {
      this.externals.delete(datatype);
      return;
    }
    this.externals.set(datatype, {
      construct: (value: unknown) =>
        Reflect.apply(construct, undefined, [value]),
      deconstruct: (value: unknown) =>
        Reflect.apply(deconstruct, undefined, [value]),
    });
  }
}
