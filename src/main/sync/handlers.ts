import {
  UnreachableError,
  type PhrasePreview,
  type SyncController,
  vaultCodeOf,
} from './controller.ts';
import { relayBase } from './relay-transport.ts';

export type Question = {
  message: string;
  detail: string;
  confirmLabel: string;
  cancelLabel: string | null;
};

export type Confirm = (question: Question) => Promise<boolean>;

const leftBehind =
  'The folder or relay can’t be reached, so the copies this device put there stay behind until you delete them.';

const maxUrlLength = 2_048;
const maxPhraseLength = 1_000;
// The first wait outlasts the click that opened the dialog, and each further
// Cancel doubles it, so a page script can't keep reopening a dialog on every
// later click until the user gives in.
const firstCooldownMs = 10_000;
const maxCooldownMs = 5 * 60_000;
const showIntervalMs = 10_000;

function phraseOf(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxPhraseLength) {
    throw new Error('That recovery phrase is not right. Check each word.');
  }
  return value;
}

function relayUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxUrlLength) {
    throw new Error('That relay address is not valid');
  }
  return relayBase(value.trim()).href;
}

function wordList(phrase: string): string {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  const rows: string[] = [];
  for (let index = 0; index < words.length; index += 3) {
    rows.push(
      words
        .slice(index, index + 3)
        .map((word, offset) => `${index + offset + 1}. ${word}`)
        .join('    '),
    );
  }
  return rows.join('\n');
}

// The page is untrusted and may have swapped the words the user typed, and it
// could draw anything as "your phrase". So main shows the words and the vault
// code itself, here and when the phrase is first written down, and the user
// compares them with their paper or another device's dialog.
function phraseQuestion(phrase: string, preview: PhrasePreview): Question {
  const details = [
    `Vault code ${preview.vaultCode}\n\n${wordList(phrase)}`,
    'Continue only if these are the words and the code you wrote down, or the ones another device shows under Settings → Recovery phrase.',
  ];
  if (preview.replacing) {
    details.push(
      'The recovery key saved on this device can’t be read, and these words replace it.',
    );
  } else if (!preview.switching) {
    details.push(
      'These are the words that reached Nod from the form. If you meant to create a new phrase instead, choose Cancel.',
    );
  } else {
    details.push(
      'This device stops syncing with the devices that use its current phrase. Its meetings stay here and move to the vault of these words.',
    );
  }
  if (preview.devices === 0) {
    details.push(
      'No device syncs with these words yet. If you expected one, check each word.',
    );
  }
  if (!preview.reachable) {
    details.push(leftBehind);
  }
  return {
    message: preview.switching
      ? 'Switch this device to another recovery phrase?'
      : 'Use this recovery phrase on this device?',
    detail: details.join('\n\n'),
    confirmLabel: preview.switching ? 'Switch' : 'Use phrase',
    cancelLabel: 'Cancel',
  };
}

// Whatever puts a key on this device, shows it, or changes where meetings go
// runs through a dialog main draws. A page script that got hold of a click can
// call these handlers, but it can't read or click through the dialog, and
// nothing else may change sync while one is open.
export function createSyncHandlers(options: {
  controller: SyncController;
  chooseFolder: () => Promise<string | null>;
  confirm: Confirm;
  syncSoon: () => void;
  now: () => number;
}) {
  const { controller, chooseFolder, confirm, syncSoon, now } = options;
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

  // Only a confirmed change to sync ends the growing wait; showing the phrase
  // or picking a folder neither cancels nor confirms anything.
  async function holding<T>(
    question: () => Promise<T>,
    outcome: (answer: T) => 'confirmed' | 'declined' | 'neutral',
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

  function ask(question: Question): Promise<boolean> {
    return holding(
      () => confirm(question),
      (yes) => (yes ? 'confirmed' : 'declined'),
    );
  }

  async function stop() {
    try {
      await controller.disconnect(false);
    } catch (failure) {
      if (
        !(failure instanceof UnreachableError) ||
        !(await ask({
          message: 'Stop syncing anyway?',
          detail: leftBehind,
          confirmLabel: 'Stop syncing',
          cancelLabel: 'Cancel',
        }))
      ) {
        throw failure;
      }
      await controller.disconnect(true);
    }
  }

  return {
    getSyncState: () => controller.state(),
    createRecoveryPhrase: async () => {
      assertFree();
      await controller.create();
      syncSoon();
    },
    enterRecoveryPhrase: async (value: unknown) => {
      const phrase = phraseOf(value);
      const preview = await controller.preview(phrase);
      if (!(await ask(phraseQuestion(phrase, preview)))) {
        return false;
      }
      await controller.enterPhrase(phrase, {
        leaveCopies: !preview.reachable,
        replaceUnreadable: preview.replacing,
      });
      syncSoon();
      return true;
    },
    // A screen may be shared, so a page script must not be able to put the
    // words up again and again.
    showRecoveryPhrase: async () => {
      assertFree();
      if (now() - shownAt < showIntervalMs) {
        throw new Error('Wait a moment before showing the phrase again');
      }
      shownAt = now();
      const state = controller.state();
      const phrase = controller.recoveryPhrase();
      const writingDown = state.status === 'ready' && !state.recoveryConfirmed;
      const code = state.status === 'ready' ? vaultCodeOf(state.vaultId) : '';
      const done = await holding(
        () =>
          confirm({
            message: 'Your recovery phrase',
            detail: [
              `Vault code ${code}\n\n${wordList(phrase)}`,
              'Write the words and the vault code on paper. Enter the words on your other devices to sync them; Nod shows the code there, and it must match.',
              'Anyone who has the words can read your meetings, so keep them off screenshots and notes apps.',
            ].join('\n\n'),
            confirmLabel: writingDown ? 'I’ve written it down' : 'Done',
            cancelLabel: writingDown ? 'Later' : null,
          }),
        () => 'neutral',
      );
      if (!writingDown || !done) {
        return false;
      }
      await controller.confirmRecoveryPhrase();
      return true;
    },
    chooseSyncFolder: async () => {
      const folder = await holding(chooseFolder, (chosen) =>
        chosen === null ? 'declined' : 'neutral',
      );
      if (folder) {
        await controller.useFolder(folder);
        syncSoon();
      }
    },
    connectSyncRelay: async (value: unknown) => {
      const url = relayUrl(value);
      const host = new URL(url).host;
      if (
        !(await ask({
          message: `Sync through ${host}?`,
          detail: `${url}\n\nYour meetings are stored there encrypted with your recovery phrase. Connect only to a relay you run or trust.`,
          confirmLabel: 'Connect',
          cancelLabel: 'Cancel',
        }))
      ) {
        return;
      }
      await controller.useRelay(url);
      syncSoon();
    },
    disconnectSync: async () => {
      if (
        !(await ask({
          message: 'Stop syncing on this device?',
          detail:
            'Its meetings stay here. The copies it put in the folder or relay are removed, and it stops getting meetings from your other devices.',
          confirmLabel: 'Stop syncing',
          cancelLabel: 'Cancel',
        }))
      ) {
        return;
      }
      await stop();
    },
    syncNow: async () => {
      syncSoon();
    },
  };
}
