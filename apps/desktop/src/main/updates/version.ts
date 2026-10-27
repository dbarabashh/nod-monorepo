type Version = {
  core: [number, number, number];
  prerelease: Array<number | string>;
};

const numeric = /^(0|[1-9]\d*)$/;
const identifier = /^[0-9A-Za-z-]+$/;
const pattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

function parse(text: string): Version | null {
  const match = pattern.exec(text);
  if (!match) {
    return null;
  }
  const core: [number, number, number] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  if (!core.every(Number.isSafeInteger)) {
    return null;
  }
  const parts = match[4]?.split('.') ?? [];
  if (
    !parts.every(
      (part) =>
        identifier.test(part) && (!/^\d+$/.test(part) || numeric.test(part)),
    )
  ) {
    return null;
  }
  return {
    core,
    prerelease: parts.map((part) => (numeric.test(part) ? Number(part) : part)),
  };
}

export function isVersion(text: string): boolean {
  return parse(text) !== null;
}

export function isPrerelease(text: string): boolean {
  return (parse(text)?.prerelease.length ?? 0) > 0;
}

function compareIdentifiers(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'number') {
    return -1;
  }
  if (typeof b === 'number') {
    return 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

// Semantic Versioning 2.0 precedence; build metadata is not accepted at all.
function compare(a: Version, b: Version): number {
  for (const [index, part] of a.core.entries()) {
    const difference = part - (b.core[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  for (const [index, part] of a.prerelease.entries()) {
    const other = b.prerelease[index];
    if (other === undefined) {
      return 1;
    }
    const difference = compareIdentifiers(part, other);
    if (difference !== 0) {
      return difference;
    }
  }
  return a.prerelease.length - b.prerelease.length;
}

export function isNewer(candidate: string, current: string): boolean {
  const next = parse(candidate);
  const now = parse(current);
  return next !== null && now !== null && compare(next, now) > 0;
}
