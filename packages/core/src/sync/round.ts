import { checkClosedNotices } from './closing.ts';
import type { SyncEngine } from './engine.ts';
import { devicesPrefix } from './layout.ts';
import type { Transport } from './transport.ts';

export const pausedMessage =
  'A sync file couldn’t be read, so sync is paused until it can be.';

export type RoundOutcome = 'synced' | 'closed' | 'paused';

// One sync round as every device runs it: a closed vault is never synced
// into, and a notice that can't be read holds the round back rather than
// risk it. The vault is listed once, for both. A closed outcome is for the
// caller to keep, even if the notice later disappears.
export async function guardedRound(
  at: {
    transport: Transport;
    engine: SyncEngine;
    checked: Map<string, string>;
  },
  vault: { fileKey: Uint8Array; id: string; deviceId: string },
): Promise<RoundOutcome> {
  const files = await at.transport.list(devicesPrefix());
  const check = await checkClosedNotices(
    at.transport,
    vault,
    at.checked,
    files,
  );
  if (check.closed) {
    return 'closed';
  }
  if (!check.readable) {
    return 'paused';
  }
  await at.engine.sync(files);
  return 'synced';
}
