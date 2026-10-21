import { isRecord, numberOf, stringOf } from '../guards.ts';
import { base64ToBytes } from './base64.ts';

const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

// automerge-wasm's SAFE_INT range excludes its upper bound.
function safeInt(text: unknown): number | bigint {
  const big = BigInt(stringOf(text));
  return big >= SAFE_MIN && big < SAFE_MAX ? Number(big) : big;
}

function f64Of(text: unknown): number {
  switch (text) {
    case 'inf':
      return Infinity;
    case '-inf':
      return -Infinity;
    default:
      return Number(stringOf(text));
  }
}

export function isObjectType(
  t: unknown,
): t is 'map' | 'table' | 'list' | 'text' {
  return t === 'map' || t === 'table' || t === 'list' || t === 'text';
}

/** Port of automerge-wasm's alloc_scalar: the datatype and the plain JS value. */
export function exportScalar(scalar: unknown): [string, unknown] {
  if (!isRecord(scalar)) {
    throw new Error('expected a scalar from the native backend');
  }
  const { t, v } = scalar;
  switch (t) {
    case 'bytes':
      return ['bytes', base64ToBytes(v)];
    case 'str':
      return ['str', stringOf(v)];
    case 'int':
    case 'counter':
      return [t, safeInt(v)];
    // automerge-wasm's SAFE_UINT range is empty (a negative bound cast to
    // u64), so every uint comes out as a BigInt.
    case 'uint':
      return ['uint', BigInt(stringOf(v))];
    case 'f64':
      return ['f64', f64Of(v)];
    case 'timestamp':
      return ['timestamp', new Date(Number(stringOf(v)))];
    case 'boolean':
      return ['boolean', v === true];
    case 'null':
      return ['null', null];
    case 'unknown':
      if (isRecord(v)) {
        return [`unknown${numberOf(v.code)}`, base64ToBytes(v.bytes)];
      }
      break;
    default:
      break;
  }
  throw new Error(`unknown scalar type ${String(t)}`);
}
