import type { Meeting } from '@nod/core/meetings';

// The phone finishes a meeting at once and sends the last lines after it, so
// a summary waits until the transcript has stopped changing for this long.
export const quietMs = 30_000;
// Only meetings finished lately: the first sync of an old phone doesn't start
// writing summaries for every meeting it ever recorded.
export const recentMs = 24 * 60 * 60_000;

export type ArrivedSummaries = ReturnType<typeof createArrivedSummaries>;

type Plan = { expected: string | null };

// Writes the summary and name of a meeting finished on another device, as
// this computer does for the meetings it records itself. One at a time, never
// while this computer records (the summary model would load beside the
// speech model), and at most once per meeting while the app runs, plus once
// more if lines arrive after it. A failing model isn't retried in a loop; the
// user can still ask again from the meeting.
export function createArrivedSummaries(options: {
  meeting: (id: string) => Meeting | undefined;
  // Resolves to whether it saved a summary: not without a summary model, nor
  // when another device's summary arrived while the model ran.
  summarize: (id: string, expected: string | null) => Promise<boolean>;
  recording: () => boolean;
  now: () => number;
  later: (ms: number, run: () => void) => () => void;
}) {
  const { meeting, summarize, recording, now, later } = options;
  const waiting = new Map<string, () => void>();
  const tried = new Set<string>();
  // How many lines each summary written here was made from.
  const written = new Map<string, number>();
  const redone = new Set<string>();
  let queue: Promise<void> = Promise.resolve();

  // `queued` plans a job already marked tried or redone.
  function plan(id: string, queued = false): Plan | null {
    const current = meeting(id);
    if (
      !current ||
      current.finishedAt === null ||
      current.finishedAt <= now() - recentMs ||
      current.transcript.length === 0 ||
      current.summaryEdited
    ) {
      return null;
    }
    if (current.summary === null) {
      return tried.has(id) && !queued ? null : { expected: null };
    }
    const lines = written.get(id);
    return lines !== undefined &&
      current.transcript.length > lines &&
      (queued || !redone.has(id))
      ? { expected: current.summary }
      : null;
  }

  function wait(id: string) {
    waiting.get(id)?.();
    waiting.set(
      id,
      later(quietMs, () => write(id)),
    );
  }

  function write(id: string) {
    waiting.delete(id);
    const next = plan(id);
    if (!next) {
      return;
    }
    if (recording()) {
      wait(id);
      return;
    }
    if (next.expected === null) {
      tried.add(id);
    } else {
      redone.add(id);
    }
    queue = queue
      .then(async () => {
        if (plan(id, true)?.expected !== next.expected) {
          return;
        }
        const lines = meeting(id)?.transcript.length ?? 0;
        const saved = await summarize(id, next.expected);
        const after = meeting(id);
        if (saved) {
          written.set(id, lines);
          if (after && after.transcript.length > lines) {
            arrived(id);
          }
        } else if (after?.summary === null) {
          tried.delete(id);
        } else if (after?.summary === next.expected) {
          redone.delete(id);
        }
      })
      .catch(() => undefined);
  }

  function arrived(id: string) {
    if (plan(id)) {
      wait(id);
    } else {
      waiting.get(id)?.();
      waiting.delete(id);
    }
  }

  return {
    // Another device changed this meeting.
    arrived,
    // Meetings that arrived while the app was closed, or before a summary
    // model was installed.
    // Leaves meetings that already wait alone, so frequent scans don't keep
    // pushing them back.
    scan: (ids: readonly string[]) => {
      for (const id of ids) {
        if (!waiting.has(id) && plan(id)) {
          wait(id);
        }
      }
    },
    settled: (): Promise<void> => queue,
  };
}
