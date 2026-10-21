import { isRecord } from '../guards.ts';
import type { Tree } from '../protocol.ts';
import {
  bytesOf,
  requireScalar,
  timestampOf,
  tryScalar,
} from './import-scalar.ts';
import { wellFormed } from './strings.ts';

export type Constructors = {
  construct: (value: unknown) => unknown;
  deconstruct: (value: unknown) => unknown;
};

export type Externals = Map<string, Constructors>;

type ObjectValue =
  | { t: 'map'; v: [string, unknown][] }
  | { t: 'list'; v: unknown[] }
  | { t: 'text'; v: string };

// Port of automerge-wasm's import_obj.
function importObject(
  value: unknown,
  datatype?: string,
): ObjectValue | undefined {
  const any = datatype === undefined;
  if (datatype === 'map' || (any && !Array.isArray(value))) {
    if (isRecord(value) || typeof value === 'function') {
      return { t: 'map', v: Object.entries(value) };
    }
    if (!any) {
      return undefined;
    }
  }
  if ((datatype === 'list' || any) && Array.isArray(value)) {
    return { t: 'list', v: value };
  }
  if ((datatype === 'text' || any) && typeof value === 'string') {
    return { t: 'text', v: value };
  }
  return undefined;
}

function encodeObject(
  object: ObjectValue,
  item: (value: unknown) => Tree,
): Tree {
  switch (object.t) {
    case 'map':
      return {
        t: 'map',
        v: object.v.map(([key, value]) => [wellFormed(key), item(value)]),
      };
    case 'list':
      return { t: 'list', v: object.v.map(item) };
    case 'text':
      return { t: 'text', v: wellFormed(object.v) };
  }
}

// Port of automerge-wasm's import_value: a scalar if it is one, else an object.
function importValue(value: unknown): Tree {
  const scalar = tryScalar(value);
  if (scalar) {
    return scalar;
  }
  const object = importObject(value);
  if (!object) {
    throw new RangeError('invalid value');
  }
  return encodeObject(object, importValue);
}

/** The value of putObject, insertObject and pushObject. */
export function importTopObject(value: unknown): Tree {
  const object = importObject(value);
  if (!object) {
    throw new RangeError('value is not an object');
  }
  return encodeObject(object, importValue);
}

function deconstruct(
  value: unknown,
  externals: Externals,
): [string | undefined, unknown] {
  for (const [name, external] of externals) {
    const raw = external.deconstruct(value);
    if (raw !== undefined) {
      return [name, raw];
    }
  }
  return [undefined, value];
}

const objectTypes = new Set(['map', 'list', 'text']);

/** Port of automerge-wasm's js_val_to_hydrate, which reads registered datatypes. */
export function importHydrate(value: unknown, externals: Externals): Tree {
  const [datatype, raw] = deconstruct(value, externals);
  if (datatype === undefined) {
    if (raw instanceof Date) {
      return timestampOf(raw);
    }
    if (raw instanceof Uint8Array) {
      return bytesOf(raw);
    }
  }
  const object =
    datatype === undefined || objectTypes.has(datatype)
      ? importObject(raw, datatype)
      : undefined;
  if (object) {
    return encodeObject(object, (item) => importHydrate(item, externals));
  }
  return requireScalar(raw, datatype);
}
