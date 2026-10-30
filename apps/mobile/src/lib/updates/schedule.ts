import type { Update } from './find.ts';

export type UpdateState =
  | { status: 'unavailable' }
  | { status: 'idle' }
  | { status: 'checking'; update: Update | null }
  | { status: 'current' }
  | { status: 'available'; update: Update }
  | { status: 'downloading'; update: Update; progress: number }
  | { status: 'installing'; update: Update }
  | { status: 'failed'; message: string; update: Update | null };

export type CheckOutcome = { found: Update | null } | { failure: string };

const checkEvery = 6 * 60 * 60 * 1000;
// GitHub allows 60 unauthenticated requests an hour per address, and a phone
// network shares one address between many phones, so a failed check waits an
// hour rather than running at every return to the app.
const retryAfter = 60 * 60 * 1000;

export function knownUpdate(state: UpdateState): Update | null {
  return 'update' in state ? state.update : null;
}

// A failed check keeps the update an earlier one found, so Install stays.
export function afterCheck(
  outcome: CheckOutcome,
  previous: Update | null,
  now: number,
): { state: UpdateState; nextCheck: number } {
  if ('failure' in outcome) {
    return {
      state: { status: 'failed', message: outcome.failure, update: previous },
      nextCheck: now + retryAfter,
    };
  }
  return {
    state: outcome.found
      ? { status: 'available', update: outcome.found }
      : { status: 'current' },
    nextCheck: now + checkEvery,
  };
}

export function isBusy(state: UpdateState): boolean {
  return (
    state.status === 'checking' ||
    state.status === 'downloading' ||
    state.status === 'installing'
  );
}
