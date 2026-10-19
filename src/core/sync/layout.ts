const idPattern = '[A-Za-z0-9_-]{1,64}';
const meetingFile = new RegExp(
  `^devices/(${idPattern})/meetings/(${idPattern})\\.bin$`,
);
const closedFile = new RegExp(`^devices/(${idPattern})/closed\\.json$`);
const wholeId = new RegExp(`^${idPattern}$`);

export function isSyncId(value: string): boolean {
  return wholeId.test(value);
}

export function meetingPath(deviceId: string, meetingId: string): string {
  return `devices/${deviceId}/meetings/${meetingId}.bin`;
}

export function closedPath(deviceId: string): string {
  return `devices/${deviceId}/closed.json`;
}

export function parseClosedPath(path: string): string | null {
  return closedFile.exec(path)?.[1] ?? null;
}

export function devicesPrefix(): string {
  return 'devices/';
}

export function parseMeetingPath(
  path: string,
): { deviceId: string; meetingId: string } | null {
  const match = meetingFile.exec(path);
  const [, deviceId, meetingId] = match ?? [];
  return deviceId && meetingId ? { deviceId, meetingId } : null;
}

// Bound into each sealed file, so a file copied to another vault, device or
// meeting fails to open there.
export function meetingContext(
  vaultId: string,
  deviceId: string,
  meetingId: string,
): string {
  return `nod:sync:${vaultId}:${deviceId}:${meetingId}`;
}
