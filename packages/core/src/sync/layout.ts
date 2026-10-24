const idPattern = '[A-Za-z0-9_-]{1,64}';
const meetingFile = new RegExp(
  `^devices/(${idPattern})/meetings/(${idPattern})\\.bin$`,
);
const closedFile = new RegExp(`^devices/(${idPattern})/closed\\.json$`);
const noteFile = new RegExp(
  `^devices/(${idPattern})/notes/(${idPattern})\\.bin$`,
);
const sharesFile = new RegExp(`^devices/(${idPattern})/shares\\.bin$`);
const membersFile = new RegExp(`^devices/(${idPattern})/members\\.bin$`);
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

// Notes shared with other people live in a shared vault under version 2
// files, whose context the file format completes with the key generation and
// the publisher.
export function notePath(deviceId: string, noteId: string): string {
  return `devices/${deviceId}/notes/${noteId}.bin`;
}

export function parseNotePath(
  path: string,
): { deviceId: string; noteId: string } | null {
  const match = noteFile.exec(path);
  const [, deviceId, noteId] = match ?? [];
  return deviceId && noteId ? { deviceId, noteId } : null;
}

export function noteContext(
  vaultId: string,
  deviceId: string,
  noteId: string,
): string {
  return `nod:sync:v2:${vaultId}:${deviceId}:${noteId}`;
}

// Whom a person shares with, kept in their own vault beside their meetings.
export function sharesPath(deviceId: string): string {
  return `devices/${deviceId}/shares.bin`;
}

export function parseSharesPath(path: string): string | null {
  return sharesFile.exec(path)?.[1] ?? null;
}

export function sharesContext(vaultId: string, deviceId: string): string {
  return `nod:shares:${vaultId}:${deviceId}`;
}

// A team's member names, written by its owners and admins beside their notes
// and sealed like one.
export function membersPath(deviceId: string): string {
  return `devices/${deviceId}/members.bin`;
}

export function parseMembersPath(path: string): string | null {
  return membersFile.exec(path)?.[1] ?? null;
}

export function membersContext(vaultId: string, deviceId: string): string {
  return `nod:members:v2:${vaultId}:${deviceId}`;
}
