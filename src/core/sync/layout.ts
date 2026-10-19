export type PairingStep = 'request' | 'offer' | 'reveal' | 'grant';

const idPattern = '[A-Za-z0-9_-]{1,64}';
const meetingFile = new RegExp(
  `^devices/(${idPattern})/meetings/(${idPattern})\\.bin$`,
);
const pairingFile = new RegExp(
  `^pairing/(${idPattern})/(request|offer|reveal|grant)\\.json$`,
);
const wholeId = new RegExp(`^${idPattern}$`);

export function isSyncId(value: string): boolean {
  return wholeId.test(value);
}

export function meetingPath(deviceId: string, meetingId: string): string {
  return `devices/${deviceId}/meetings/${meetingId}.bin`;
}

export function devicesPrefix(): string {
  return 'devices/';
}

export function pairingPrefix(): string {
  return 'pairing/';
}

export function pairingPath(requestId: string, step: PairingStep): string {
  return `pairing/${requestId}/${step}.json`;
}

export function parseMeetingPath(
  path: string,
): { deviceId: string; meetingId: string } | null {
  const match = meetingFile.exec(path);
  const [, deviceId, meetingId] = match ?? [];
  return deviceId && meetingId ? { deviceId, meetingId } : null;
}

export function parsePairingPath(
  path: string,
): { requestId: string; step: PairingStep } | null {
  const match = pairingFile.exec(path);
  const requestId = match?.[1];
  const step = match?.[2];
  if (
    !requestId ||
    (step !== 'request' &&
      step !== 'offer' &&
      step !== 'reveal' &&
      step !== 'grant')
  ) {
    return null;
  }
  return { requestId, step };
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
