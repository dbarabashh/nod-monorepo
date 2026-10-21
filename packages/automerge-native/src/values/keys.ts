import type { Key } from '../protocol.ts';
import { wellFormed } from './strings.ts';

// automerge-wasm takes JS numbers as f64 and casts them with Rust's `as` on
// wasm32: truncated, saturated to 32 bits, NaN as 0. JSON has no NaN or
// infinities, and the native library may be 64-bit, so the cast happens here.
const U32_MAX = 2 ** 32 - 1;
const I32_MIN = -(2 ** 31);
const I32_MAX = 2 ** 31 - 1;

export function toIndex(value: unknown): number {
  const n = Number(value);
  return n > 0 ? Math.min(Math.trunc(n), U32_MAX) : 0;
}

export function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isNaN(n)
    ? 0
    : Math.max(I32_MIN, Math.min(Math.trunc(n), I32_MAX));
}

/** wasm's spliceFromHydrate casts through i64 (`as i64 as isize`), which wraps. */
export function toWrappedCount(value: unknown): number {
  const n = Number(value);
  if (Number.isNaN(n)) {
    return 0;
  }
  if (n >= 2 ** 63) {
    return -1;
  }
  return n <= -(2 ** 63) ? 0 : Math.trunc(n) | 0;
}

/** An f64 that survives JSON; Rust's `as i64` then saturates it as wasm does. */
export function toFinite(value: unknown): number {
  const n = Number(value);
  return Number.isNaN(n)
    ? 0
    : Math.max(-Number.MAX_VALUE, Math.min(n, Number.MAX_VALUE));
}

export function timeOf(time: unknown): number | undefined {
  return time == null ? undefined : toFinite(time);
}

/** A map key or list index, or undefined for what wasm reads as no prop. */
export function keyOf(prop: unknown): Key | undefined {
  if (typeof prop === 'string') {
    return wellFormed(prop);
  }
  return typeof prop === 'number' ? toIndex(prop) : undefined;
}

export function requireKey(prop: unknown): Key {
  const key = keyOf(prop);
  if (key === undefined) {
    throw new RangeError(`invalid prop ${String(prop)}`);
  }
  return key;
}
