export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fail(expected: string): never {
  throw new Error(`expected ${expected} from the native backend`);
}

export function arrayOf<T>(value: unknown, item: (value: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(item) : fail('an array');
}

export function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : fail('a number');
}

export function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : fail('a string');
}
