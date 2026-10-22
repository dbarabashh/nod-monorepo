import { devicesPrefix, parseClosedPath } from './layout.ts';
import { Throttled, type RemoteFile, type Transport } from './transport.ts';
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

const noticeMaxBytes = 4 * 1024;

export type ClosedCheck = { closed: boolean; readable: boolean };

// Notices already read at a version are skipped through `checked`, which the
// caller keeps for as long as it uses this transport. A notice that can't be
// read leaves `readable` false, so the caller holds sync back rather than
// risk writing into a closed vault.
export async function checkClosedNotices(
  transport: Transport,
  vault: { fileKey: Uint8Array; id: string; deviceId: string },
  checked: Map<string, string>,
  listed?: RemoteFile[],
): Promise<ClosedCheck> {
  const files = listed ?? (await transport.list(devicesPrefix()));
  let readable = true;
  for (const file of files) {
    const deviceId = parseClosedPath(file.path);
    if (
      !deviceId ||
      deviceId === vault.deviceId ||
      checked.get(file.path) === file.version
    ) {
      continue;
    }
    let data: Uint8Array | null;
    try {
      data = await transport.read(file.path, noticeMaxBytes);
    } catch (error) {
      if (error instanceof Throttled) {
        throw error;
      }
      readable = false;
      continue;
    }
    let closed = false;
    try {
      closed = data
        ? openClosedNotice(vault.fileKey, vault.id, deviceId, data)
        : false;
    } catch {
      closed = false;
    }
    if (closed) {
      return { closed: true, readable };
    }
    checked.set(file.path, file.version);
  }
  return { closed: false, readable };
}
