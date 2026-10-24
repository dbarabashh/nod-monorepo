export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json | undefined };

// One byte sequence for one value, whatever built it: keys sorted, no
// spaces, and undefined left out. What is signed and hashed is this text,
// so two implementations can't disagree on a record's id.
export function canonicalJson(value: Json | undefined): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('A record holds no infinite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .flatMap((key) => {
      const item = value[key];
      return item === undefined
        ? []
        : [`${JSON.stringify(key)}:${canonicalJson(item)}`];
    });
  return `{${entries.join(',')}}`;
}
