import {
  UnreachableError,
  type PhrasePreview,
  type SyncController,
} from './controller.ts';
import {
  pairingProof,
  phraseWords,
  randomKey,
  vaultCodeOf,
  vaultIdOf,
} from '@nod/core/crypto';
import {
  isSyncId,
  pairingCode,
  relayBase,
  sealPairingOffer,
} from '@nod/core/sync';
import type { PairingListener } from './pairing-server.ts';

export type Question = {
  message: string;
  detail: string;
  confirmLabel: string;
  cancelLabel: string | null;
};

export type Confirm = (question: Question) => Promise<boolean>;

export type PairingScreen = {
  code: string;
  vaultCode: string;
  relayHost: string;
};

// Resolves once the user closed what shows the code, or once `done` settles
// (a device took the offer, or the listener closed).
export type ShowPairing = (
  screen: PairingScreen,
  done: Promise<unknown>,
) => Promise<void>;

export type ListenForPairing = (offer: {
  sealed: Uint8Array;
  proof: string;
}) => Promise<PairingListener>;

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
  const words = phraseWords(phrase);
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
  showPairing: ShowPairing;
  listenForPairing: ListenForPairing;
  syncSoon: () => void;
  now: () => number;
}) {
  const {
    controller,
    chooseFolder,
    confirm,
    showPairing,
    listenForPairing,
    syncSoon,
    now,
  } = options;
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
    // Whoever scans the code gets the vault key, so it gets the same limits
    // as the phrase, and both share one interval: a script can't alternate
    // them.
    showPairingCode: async () => {
      assertFree();
      if (now() - shownAt < showIntervalMs) {
        throw new Error('Wait a moment before showing the code again');
      }
      const offer = controller.pairingOffer();
      // The code carries a one-time secret, never the key: the phone gets the
      // key sealed with it, over the local network, once. Listening starts
      // inside the hold, so a second call can't open a second listener.
      const secret = randomKey();
      const taken = await holding(
        async () => {
          const listener = await listenForPairing({
            sealed: sealPairingOffer(secret, offer),
            proof: pairingProof(secret),
          });
          shownAt = now();
          try {
            await showPairing(
              {
                code: pairingCode({
                  secret,
                  port: listener.port,
                  hosts: listener.hosts,
                }),
                vaultCode: vaultCodeOf(vaultIdOf(offer.key)),
                relayHost: new URL(offer.relayUrl).host,
              },
              listener.outcome,
            );
          } finally {
            listener.close();
          }
          return listener.outcome;
        },
        () => 'neutral',
      );
      // Whoever took the code got the key, so the user sees where it went
      // and can tell if it wasn't their phone.
      if (taken) {
        await holding(
          () =>
            confirm({
              message: 'A phone is paired',
              detail: `The device at ${taken.by} on this network took the pairing code and now syncs with your meetings.\n\nIf that wasn’t your phone, change your recovery phrase in Settings → Recovery phrase right away.`,
              confirmLabel: 'OK',
              cancelLabel: null,
            }),
          () => 'neutral',
        );
      }
      // The interval runs from when the code went away, so a window left open
      // can't be put back up on the very next click.
      shownAt = now();
      syncSoon();
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
    listSyncDevices: () => controller.devices(),
    forgetSyncDevice: async (value: unknown) => {
      if (typeof value !== 'string' || !isSyncId(value)) {
        throw new Error('Unknown device');
      }
      const device = (await controller.devices()).find(
        (entry) => entry.id === value,
      );
      if (!device) {
        throw new Error('That device has nothing in the vault');
      }
      await controller.refresh();
      if (
        !(await ask({
          message: `Forget device ${value.slice(0, 8)}?`,
          detail: `It put ${device.meetings === 1 ? '1 meeting' : `${device.meetings} meetings`} in the vault. They are removed there; your meetings stay on this computer, and this computer puts its own copy of any that only that device had.\n\nForget only a device you no longer use. One still in use writes its copies again only as its meetings change; to shut a lost device out, change the recovery phrase.`,
          confirmLabel: 'Forget device',
          cancelLabel: 'Cancel',
        }))
      ) {
        return;
      }
      await controller.forgetDevice(value);
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
    changeRecoveryPhrase: async () => {
      if (
        !(await ask({
          message: 'Change your recovery phrase?',
          detail:
            'Nod makes a new recovery phrase and stops syncing through the old one. Enter the new phrase on each device you keep; a lost or removed device never gets it, but it keeps what it already has. Do it soon: devices still on the old phrase stop syncing once they see the change. Write the new phrase down right after.',
          confirmLabel: 'Change phrase',
          cancelLabel: 'Cancel',
        }))
      ) {
        return;
      }
      try {
        await controller.changePhrase(false);
      } catch (failure) {
        if (
          !(failure instanceof UnreachableError) ||
          !(await ask({
            message: 'Change the phrase anyway?',
            detail:
              'The folder or relay can’t be reached, so your other devices won’t be told and this device’s copies stay there. Enter the new phrase on the devices you keep yourself.',
            confirmLabel: 'Change phrase',
            cancelLabel: 'Cancel',
          }))
        ) {
          throw failure;
        }
        await controller.changePhrase(true);
      }
      syncSoon();
    },
    syncNow: async () => {
      syncSoon();
    },
  };
}
