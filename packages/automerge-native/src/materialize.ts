import { arrayOf, isRecord, stringOf } from './guards.ts';
import { isObjectType } from './values/export-scalar.ts';
import { DATATYPE, META, RAW_OBJECT, setHidden } from './values/hidden.ts';
import type { Externals } from './values/import-object.ts';
import { wrapScalar } from './values/wrap-scalar.ts';
import { unsupported } from './unsupported.ts';

type Context = { externals: Externals; meta: unknown; frozen: object[] | null };

function tag(
  target: object,
  node: Record<string, unknown>,
  datatype: string,
  context: Context,
) {
  setHidden(target, RAW_OBJECT, stringOf(node.id));
  setHidden(target, DATATYPE, datatype);
  setHidden(target, META, context.meta);
  context.frozen?.push(target);
}

function build(node: unknown, context: Context): unknown {
  if (!isRecord(node) || !isObjectType(node.t)) {
    return wrapScalar(node, context.externals);
  }
  const datatype = node.t;
  if (datatype === 'text') {
    return stringOf(node.v);
  }
  if (context.externals.has(datatype)) {
    unsupported(`a custom ${datatype} datatype`);
  }
  if (datatype === 'map') {
    const object: Record<string, unknown> = {};
    tag(object, node, datatype, context);
    for (const [key, value] of arrayOf(node.v, entryOf)) {
      object[key] = build(value, context);
    }
    return object;
  }
  const list: unknown[] = [];
  tag(list, node, datatype, context);
  for (const item of arrayOf(node.v, (item) => item)) {
    list.push(build(item, context));
  }
  return list;
}

function entryOf(entry: unknown): [string, unknown] {
  if (!Array.isArray(entry)) {
    throw new Error('expected a map entry from the native backend');
  }
  return [stringOf(entry[0]), entry[1]];
}

/**
 * Builds the JS value of a materialized object the way wasm's export_object
 * does. Frozen objects are frozen only after they are filled.
 */
export function buildObject(
  tree: unknown,
  options: { externals: Externals; meta: unknown; freeze: boolean },
): unknown {
  const context: Context = {
    externals: options.externals,
    meta: options.meta,
    frozen: options.freeze ? [] : null,
  };
  const value = build(tree, context);
  for (const object of context.frozen ?? []) {
    Object.freeze(object);
  }
  return value;
}
