// Reads one property of a value that is only known to be an object, so a
// record from a relay or a folder is picked apart without a type assertion.
export function field(value: object, key: string): unknown {
  return Reflect.get(value, key);
}
