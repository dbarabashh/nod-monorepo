// What a dialog main draws shows: a title, paragraphs (separated by blank
// lines), and where there is one, a code to compare by eye and the words of
// a phrase, set apart from the text so they can be read at a glance.
export type Question = {
  message: string;
  detail: string;
  code?: { label: string; value: string };
  words?: string[];
  confirmLabel: string;
  cancelLabel: string | null;
};

export type Confirm = (question: Question) => Promise<boolean>;

// The first wait outlasts the click that opened the dialog, and each further
// Cancel doubles it, so a page script can't keep reopening a dialog on every
// later click until the user gives in.
const firstCooldownMs = 10_000;
const maxCooldownMs = 5 * 60_000;
// A screen may be shared, so what shows a secret or an identity can't be
// put up again and again.
const showIntervalMs = 10_000;

type Outcome = 'confirmed' | 'declined' | 'neutral';

// One gate for every dialog main draws about sync and sharing: only one
// question at a time, a growing wait after each Cancel, and an interval
// between showings. Sync and sharing share it, so a script can't alternate
// the two to get around either.
export function createDialogGate(options: {
  confirm: Confirm;
  now: () => number;
}) {
  const { confirm, now } = options;
  let asking = false;
  let declines = 0;
  let declinedAt = Number.NEGATIVE_INFINITY;
  let shownAt = Number.NEGATIVE_INFINITY;

  function assertFree() {
    if (asking) {
      throw new Error('Answer the open question first');
    }
    const cooldown =
      declines === 0
        ? 0
        : Math.min(firstCooldownMs * 2 ** (declines - 1), maxCooldownMs);
    if (now() - declinedAt < cooldown) {
      throw new Error('Wait a moment before trying again');
    }
  }

  // Only a confirmed change ends the growing wait; showing something or
  // picking a folder neither cancels nor confirms anything.
  async function holding<T>(
    question: () => Promise<T>,
    outcome: (answer: T) => Outcome,
  ): Promise<T> {
    assertFree();
    asking = true;
    try {
      const answer = await question();
      const result = outcome(answer);
      if (result === 'confirmed') {
        declines = 0;
      } else if (result === 'declined') {
        declines += 1;
        declinedAt = now();
      }
      return answer;
    } finally {
      asking = false;
    }
  }

  return {
    confirm,
    assertFree,
    holding,
    ask: (question: Question): Promise<boolean> =>
      holding(
        () => confirm(question),
        (yes) => (yes ? 'confirmed' : 'declined'),
      ),
    // Whatever is shown counts from when it went away, so a window left
    // open can't be put back up on the very next click.
    assertNotJustShown: (what: string) => {
      if (now() - shownAt < showIntervalMs) {
        throw new Error(`Wait a moment before showing the ${what} again`);
      }
    },
    markShown: () => {
      shownAt = now();
    },
  };
}

export type DialogGate = ReturnType<typeof createDialogGate>;
