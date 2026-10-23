import { isIdentityHex } from '@nod/core/crypto';
import { isNoteId } from '@nod/core/sharing';
import type { SharedNoteDetail, SharedNoteInfo } from '../../shared/ipc.ts';
import type { Meeting } from '@nod/core/meetings';
import type { DialogGate } from '../sync/dialog-gate.ts';
import type { SharedPlace, SharingController } from './controller.ts';

const maxCardLength = 400;
const maxSummaryLength = 200_000;

function cardOf(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxCardLength) {
    throw new Error('That is not an identity card');
  }
  return value.trim();
}

function peerIdentityOf(value: unknown): string {
  if (typeof value !== 'string' || !isIdentityHex(value)) {
    throw new Error('Unknown person');
  }
  return value;
}

function noteIdOf(value: unknown): string {
  if (typeof value !== 'string' || !isNoteId(value)) {
    throw new Error('Unknown note');
  }
  return value;
}

// Everything that shows an identity, adds a person or stops a share runs
// through a dialog main draws, so a page script that got hold of a click
// can't swap the card it shows or add someone unseen.
export function createSharingHandlers(options: {
  controller: SharingController;
  place: () => SharedPlace | null;
  meeting: (id: string) => Meeting | undefined;
  meetingName: (meeting: Meeting) => string;
  // The same gate the sync dialogs use, so one question is open at a time
  // across both, and a Cancel here slows a script down there too.
  gate: DialogGate;
  copyText: (text: string) => void;
  syncSoon: () => void;
}) {
  const { controller, place, gate, copyText, syncSoon } = options;

  return {
    getSharingState: () => controller.snapshot(),
    // The card is public; the dialog exists so what the user copies is the
    // card main holds, with the code they can read out to the other person.
    showIdentityCard: async () => {
      gate.assertFree();
      gate.assertNotJustShown('card');
      const card = controller.identityCard();
      const code = controller.identityCode();
      gate.markShown();
      const copy = await gate.holding(
        () =>
          gate.confirm({
            message: 'Your identity card',
            detail:
              'Send the card to the person you want to share notes with, in any app. They add it under Settings → Sharing, and you add theirs. The card holds nothing secret; the code lets you both check you have the right one.',
            code: { label: 'Your identity code', value: code },
            confirmLabel: 'Copy card',
            cancelLabel: 'Close',
          }),
        () => 'neutral',
      );
      gate.markShown();
      if (copy) {
        copyText(card);
      }
    },
    addSharingPeer: async (value: unknown) => {
      const card = cardOf(value);
      const preview = controller.previewPeer(card);
      const yes = await gate.ask({
        message: 'Share notes with this person?',
        code: { label: 'Their identity code', value: preview.code },
        detail: [
          'Check the code with the person over a call or in person. Notes you share with them travel encrypted through your folder or relay; only the two of you can read them, and neither of you can take a shared note back. If you shared with them before and stopped, those notes are shared again.',
        ].join('\n\n'),
        confirmLabel: 'Share with them',
        cancelLabel: 'Cancel',
      });
      if (!yes) {
        return false;
      }
      await controller.addPeer(card);
      syncSoon();
      return true;
    },
    stopSharingPeer: async (value: unknown) => {
      const identity = peerIdentityOf(value);
      const state = controller.snapshot();
      const peer =
        state.status === 'ready'
          ? state.peers.find((candidate) => candidate.identity === identity)
          : undefined;
      if (!peer) {
        throw new Error('Unknown person');
      }
      const at = place();
      const yes = await gate.ask({
        message: `Stop sharing with ${peer.code}?`,
        detail: [
          at
            ? 'The copies this device put in the shared vault are removed, and nothing new travels either way.'
            : 'No folder or relay is connected right now, so the copies this device put in the shared vault stay there; nothing new travels either way.',
          'The other person keeps what they already received, as they would a sent email. The notes stay on this device, and are shared again if you add this person back.',
        ].join('\n\n'),
        confirmLabel: 'Stop sharing',
        cancelLabel: 'Cancel',
      });
      if (!yes) {
        return;
      }
      await controller.stopPeer(identity, at);
    },
    shareMeeting: async (
      meetingId: unknown,
      peer: unknown,
    ): Promise<SharedNoteInfo> => {
      const identity = peerIdentityOf(peer);
      const meeting =
        typeof meetingId === 'string' ? options.meeting(meetingId) : undefined;
      if (!meeting) {
        throw new Error('Unknown meeting');
      }
      const shared = await controller.shareMeeting(
        meeting,
        options.meetingName(meeting),
        identity,
      );
      syncSoon();
      return shared;
    },
    getSharedNote: async (
      peer: unknown,
      id: unknown,
    ): Promise<SharedNoteDetail> =>
      controller.note(peerIdentityOf(peer), noteIdOf(id)),
    editSharedNote: async (peer: unknown, id: unknown, summary: unknown) => {
      if (typeof summary !== 'string' || summary.length > maxSummaryLength) {
        throw new Error('That note is too long');
      }
      await controller.editNote(peerIdentityOf(peer), noteIdOf(id), summary);
      syncSoon();
    },
    deleteSharedNote: async (peer: unknown, id: unknown) => {
      await controller.deleteNote(peerIdentityOf(peer), noteIdOf(id));
      syncSoon();
    },
  };
}
