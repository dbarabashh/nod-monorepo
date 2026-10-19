import { bytesOf, open, seal, textOf } from '../crypto/index.ts';

const closedContext = (vaultId: string, deviceId: string) =>
  `nod:closed:${vaultId}:${deviceId}`;

// Sealed with the vault's file key, so a folder service or relay can't close
// a vault. A device that still has the old phrase can, which only stops sync
// and asks for a phrase; it never moves a device anywhere.
export function sealClosedNotice(
  fileKey: Uint8Array,
  vaultId: string,
  deviceId: string,
  closedAt: number,
): Uint8Array {
  return seal(
    fileKey,
    bytesOf(JSON.stringify({ closedAt })),
    closedContext(vaultId, deviceId),
  );
}

export function openClosedNotice(
  fileKey: Uint8Array,
  vaultId: string,
  deviceId: string,
  data: Uint8Array,
): boolean {
  const raw: unknown = JSON.parse(
    textOf(open(fileKey, data, closedContext(vaultId, deviceId))),
  );
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof Reflect.get(raw, 'closedAt') === 'number'
  );
}
