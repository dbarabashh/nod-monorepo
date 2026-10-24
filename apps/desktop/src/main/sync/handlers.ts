import { shownName } from '../sharing/shown-name.ts';
import {
  UnreachableError,
  UnreachableTeamsError,
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
  inAbout,
  isSyncId,
  pairingCode,
  relayBase,
  sealPairingOffer,
} from '@nod/core/sync';
import type { PairingListener } from './pairing-server.ts';
import type { DialogGate, Question } from './dialog-gate.ts';

export type { Confirm, Question } from './dialog-gate.ts';

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
  proofFor: (host: string, port: number) => string;
  confirm: (by: string) => Promise<boolean>;
}) => Promise<PairingListener>;

// The only thing the user can check is that the address matches the one
// their phone shows, and that the phone is waiting at all.
function pairingQuestion(by: string): Question {
  return {
    message: 'Pair the phone that scanned the code?',
    detail: `A device at ${by} on this network scanned the code and asks for your meetings.\n\nYour phone should now say “Choose Pair on your computer” and show ${by}. If it shows something else, or isn’t waiting, choose Don’t pair. Nothing is shared until you choose.`,
    confirmLabel: 'Pair',
    cancelLabel: 'Don’t pair',
  };
}

const leftBehind =
  'The folder or relay can’t be reached, so the copies this device put there stay behind until you delete them.';
const askedToWait = (waitMs: number) =>
  `The relay asked this device to wait, so the copies this device put there stay behind until you delete them. Sync will try again ${inAbout(waitMs)}.`;

const maxUrlLength = 2_048;
const maxPhraseLength = 1_000;
// The phone's next ask collects the answer (the offer, or the refusal); the
// listener stays this long for it once the code window is gone.
const deliveryGraceMs = 10_000;

function settledWithin(settled: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    settled.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

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

// The page is untrusted and may have swapped the words the user typed, and it
// could draw anything as "your phrase". So main shows the words and the vault
// code itself, here and when the phrase is first written down, and the user
// compares them with their paper or another device's dialog.
function phraseQuestion(phrase: string, preview: PhrasePreview): Question {
  const details = [
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
  if (preview.handingOver) {
    details.push(
      'Some teams your previous phrase managed are still being handed to this one. Switching now leaves them with that phrase, and no device can hand them over later.',
    );
  }
  if (preview.devices === 0) {
    details.push(
      'No device syncs with these words yet. If you expected one, check each word.',
    );
  }
  if (preview.waitMs !== null) {
    details.push(askedToWait(preview.waitMs));
  } else if (!preview.reachable) {
    details.push(leftBehind);
  }
  return {
    message: preview.switching
      ? 'Switch this device to another recovery phrase?'
      : 'Use this recovery phrase on this device?',
    detail: details.join('\n\n'),
    code: { label: 'Vault code', value: preview.vaultCode },
    words: phraseWords(phrase),
    confirmLabel: preview.switching ? 'Switch' : 'Use phrase',
    cancelLabel: 'Cancel',
  };
}

function teamsQuestion(teams: string[]): Question {
  const names = teams.map((name) => `“${shownName(name) || 'Unnamed team'}”`);
  return {
    message: 'Change the phrase without these teams?',
    detail: [
      names.length === 0
        ? 'Nod couldn’t check the teams you own or manage, so it can’t tell whether they all move to the new phrase.'
        : `The relay of ${names.join(', ')} can’t be reached right now, so ${names.length === 1 ? 'that team doesn’t' : 'those teams don’t'} move to the new phrase.`,
      'If you go on, your old identity stays in them and the new one isn’t added; someone in the team has to invite you again. Choose Cancel to try again once the relay can be reached.',
    ].join('\n\n'),
    confirmLabel: 'Change phrase',
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
  showPairing: ShowPairing;
  listenForPairing: ListenForPairing;
  syncSoon: () => void;
  // Shared with the sharing handlers, so one gate guards every dialog.
  gate: DialogGate;
}) {
  const {
    controller,
    chooseFolder,
    showPairing,
    listenForPairing,
    syncSoon,
    gate,
  } = options;
  const { assertFree, holding, ask, confirm } = gate;

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
      gate.assertNotJustShown('phrase');
      gate.markShown();
      const state = controller.state();
      const phrase = controller.recoveryPhrase();
      const writingDown = state.status === 'ready' && !state.recoveryConfirmed;
      const code = state.status === 'ready' ? vaultCodeOf(state.vaultId) : '';
      const done = await holding(
        () =>
          confirm({
            message: 'Your recovery phrase',
            detail: [
              'Write the words and the vault code on paper. Enter the words on your other devices to sync them; Nod shows the code there, and it must match.',
              'Anyone who has the words can read your meetings, so keep them off screenshots and notes apps.',
            ].join('\n\n'),
            code: { label: 'Vault code', value: code },
            words: phraseWords(phrase),
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
      gate.assertNotJustShown('code');
      const offer = controller.pairingOffer();
      // The code carries a one-time secret, never the key: the phone gets the
      // key sealed with it, over the local network, once. Listening starts
      // inside the hold, so a second call can't open a second listener.
      const secret = randomKey();
      const taken = await holding(
        async () => {
          // A photo of the code is enough to ask; main's own dialog, not the
          // page, decides who gets the key. The window may close while the
          // dialog is up, so the phone is answered once the user has.
          const asked: { decision: Promise<boolean> | null } = {
            decision: null,
          };
          const listener = await listenForPairing({
            sealed: sealPairingOffer(secret, offer),
            proofFor: (host, port) => pairingProof(secret, host, port),
            confirm: (by) => {
              asked.decision = confirm(pairingQuestion(by)).catch(() => false);
              return asked.decision;
            },
          });
          gate.markShown();
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
            if (asked.decision) {
              await asked.decision;
              await settledWithin(listener.outcome, deliveryGraceMs);
            }
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
      gate.markShown();
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
          detail: [
            'Nod makes a new recovery phrase and stops syncing through the old one. Enter the new phrase on each device you keep; a lost or removed device never gets it, but it keeps what it already has. Do it soon: devices still on the old phrase stop syncing once they see the change. Write the new phrase down right after.',
            'Your sharing identity changes with the phrase. Notes you share with a person stop being shared; exchange identity cards again to share with them under the new phrase.',
            'Teams you own move to the new phrase, and your old identity is removed from them. In a team where you are an admin, the new phrase joins as a writer; ask the owner to remove your old identity. Every other team has to invite you again.',
          ].join('\n\n'),
          confirmLabel: 'Change phrase',
          cancelLabel: 'Cancel',
        }))
      ) {
        return;
      }
      let leaveCopies = false;
      let leaveTeams = false;
      for (;;) {
        try {
          await controller.changePhrase(leaveCopies, leaveTeams);
          break;
        } catch (failure) {
          if (failure instanceof UnreachableTeamsError && !leaveTeams) {
            if (!(await ask(teamsQuestion(failure.teams)))) {
              throw failure;
            }
            leaveTeams = true;
          } else if (failure instanceof UnreachableError && !leaveCopies) {
            if (
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
            leaveCopies = true;
          } else {
            throw failure;
          }
        }
      }
      syncSoon();
    },
    syncNow: async () => {
      syncSoon();
    },
  };
}
