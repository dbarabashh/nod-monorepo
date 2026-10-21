import type { Scalar } from '../protocol.ts';
import { bytesToBase64 } from './base64.ts';
import { wellFormed } from './strings.ts';

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const U64_MAX = 2n ** 64n - 1n;

// Rust's `f as i64`: truncates toward zero, saturates, and maps NaN to 0.
function numberToI64(n: number): string {
  if (Number.isNaN(n)) {
    return '0';
  }
  if (n >= 2 ** 63) {
    return I64_MAX.toString();
  }
  if (n < -(2 ** 63)) {
    return I64_MIN.toString();
  }
  return BigInt(Math.trunc(n)).toString();
}

function numberToU64(n: number): string {
  if (Number.isNaN(n) || n <= 0) {
    return '0';
  }
  if (n >= 2 ** 64) {
    return U64_MAX.toString();
  }
  return BigInt(Math.trunc(n)).toString();
}

function checkedBigInt(value: bigint, min: bigint, max: bigint): string {
  if (value > max) {
    throw new RangeError(`BigInt value ${value} is too large`);
  }
  if (value < min) {
    throw new RangeError(`BigInt value ${value} is too small`);
  }
  return value.toString();
}

function invalid(value: unknown): never {
  throw new RangeError(`invalid value ${String(value)}`);
}

function i64Text(value: unknown): string {
  if (typeof value === 'bigint') {
    return checkedBigInt(value, I64_MIN, I64_MAX);
  }
  if (typeof value === 'number') {
    return numberToI64(value);
  }
  if (value instanceof Date) {
    return numberToI64(value.getTime());
  }
  return invalid(value);
}

function u64Text(value: unknown): string {
  if (typeof value === 'bigint') {
    return checkedBigInt(value, 0n, U64_MAX);
  }
  return typeof value === 'number' ? numberToU64(value) : invalid(value);
}

function f64Text(n: number): string {
  if (n === Infinity) {
    return 'inf';
  }
  if (n === -Infinity) {
    return '-inf';
  }
  // String(-0) is "0"; wasm keeps the sign, and so do the bytes.
  return Object.is(n, -0) ? '-0' : String(n);
}

export function timestampOf(date: Date): Scalar {
  return { t: 'timestamp', v: numberToI64(date.getTime()) };
}

export function bytesOf(bytes: Uint8Array): Scalar {
  return { t: 'bytes', v: bytesToBase64(bytes) };
}

/**
 * Port of automerge-wasm's import_scalar. Undefined means the value isn't a
 * scalar of that datatype.
 */
export function importScalar(
  value: unknown,
  datatype?: unknown,
): Scalar | undefined {
  switch (datatype) {
    case undefined:
    case null:
      return importUntypedScalar(value);
    case 'boolean':
      return typeof value === 'boolean'
        ? { t: 'boolean', v: value }
        : undefined;
    case 'str':
      return typeof value === 'string'
        ? { t: 'str', v: wellFormed(value) }
        : undefined;
    case 'f64':
      return typeof value === 'number'
        ? { t: 'f64', v: f64Text(value) }
        : undefined;
    case 'int':
    case 'counter':
    case 'timestamp':
      return { t: datatype, v: i64Text(value) };
    case 'uint':
      return { t: 'uint', v: u64Text(value) };
    case 'bytes':
      return value instanceof Uint8Array ? bytesOf(value) : invalid(value);
    case 'null':
      return { t: 'null' };
    default:
      throw new RangeError('value is not a primitive');
  }
}

export function requireScalar(value: unknown, datatype?: unknown): Scalar {
  return importScalar(value, datatype) ?? invalid(value);
}

function importUntypedScalar(value: unknown): Scalar | undefined {
  if (value === null) {
    return { t: 'null' };
  }
  switch (typeof value) {
    case 'boolean':
      return { t: 'boolean', v: value };
    case 'string':
      return { t: 'str', v: wellFormed(value) };
    case 'bigint':
      return value > I64_MAX
        ? { t: 'uint', v: checkedBigInt(value, 0n, U64_MAX) }
        : { t: 'int', v: checkedBigInt(value, I64_MIN, I64_MAX) };
    case 'number': {
      const rounded = Math.round(value);
      // Mirrors wasm exactly: only whole numbers of at least 1 become ints, so
      // 0 and negative numbers are stored as f64.
      return rounded >= 1 && Math.abs(rounded - value) < Number.EPSILON
        ? { t: 'int', v: numberToI64(value) }
        : { t: 'f64', v: f64Text(value) };
    }
    default:
      break;
  }
  if (value instanceof Date) {
    return timestampOf(value);
  }
  if (value instanceof Uint8Array) {
    return bytesOf(value);
  }
  return undefined;
}

/** A scalar if the value is one, or undefined, for values that may be objects. */
export function tryScalar(value: unknown): Scalar | undefined {
  try {
    return importUntypedScalar(value);
  } catch {
    return undefined;
  }
}
