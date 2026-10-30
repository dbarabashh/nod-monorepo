import { isDocumentVersion } from '@nod/core/meetings';

export function documentVersionOf(
  value: unknown,
  what: 'meeting' | 'note',
): string {
  if (typeof value !== 'string' || !isDocumentVersion(value)) {
    throw new Error(`That ${what} has changed; open it again to edit it`);
  }
  return value;
}
