import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { identityCard, identityOf } from '@nod/core/crypto';
import { startMeeting, type MeetingFiles } from '@nod/core/meetings';
import { memoryFiles, plainCipher } from '@nod/core/meetings/testing';
import { createSharingSession } from '@nod/core/sharing';
import { createDialogGate, type Question } from '../sync/dialog-gate.ts';
import { createSharingHandlers } from './handlers.ts';

const bob = identityOf(new Uint8Array(32).fill(2));
const bobCard = identityCard(bob);
const longCard = `nod-id:v1:${'A'.repeat(400)}`;
const meeting = startMeeting('m-1', 'Planning', 1_000);

async function setUp(answers: boolean[]) {
  const asked: Question[] = [];
  const copied: string[] = [];
  let clock = 0;
  const notes = new Map<string, MeetingFiles>();
  const shares = new Map<string, Uint8Array>();
  const controller = createSharingSession({
    sharesFileFor: (vaultId) => ({
      read: async () => shares.get(vaultId) ?? null,
      write: async (data) => {
        shares.set(vaultId, data);
      },
      setAside: async () => {
        shares.delete(vaultId);
      },
    }),
    noteFilesFor: (vaultId) => {
      const files = notes.get(vaultId) ?? memoryFiles();
      notes.set(vaultId, files);
      return files;
    },
    cipher: async () => plainCipher,
    newId: () => 'note-1',
    now: () => 5,
    onChange: () => {},
  });
  await controller.load({ key: new Uint8Array(32).fill(1), deviceId: 'd1' });
  const handlers = createSharingHandlers({
    controller,
    place: () => null,
    meeting: (id) => (id === meeting.id ? meeting : undefined),
    meetingName: (entry) => entry.title,
    gate: createDialogGate({
      confirm: async (question) => {
        asked.push(question);
        return answers.shift() ?? false;
      },
      now: () => clock,
    }),
    copyText: (text) => {
      copied.push(text);
    },
    syncSoon: () => {},
  });
  return {
    handlers,
    controller,
    asked,
    copied,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('sharing handlers', () => {
  it('adds a person only after the user confirms their code, and refuses a card that is too long', async () => {
    const { handlers, controller, asked } = await setUp([false, true]);
    await assert.rejects(handlers.addSharingPeer(longCard), /identity card/);
    await assert.rejects(handlers.addSharingPeer(42), /identity card/);
    assert.equal(asked.length, 0);

    assert.equal(await handlers.addSharingPeer(bobCard), false);
    assert.equal(asked[0]?.confirmLabel, 'Share with them');
    assert.deepEqual(handlers.getSharingState(), {
      ...controller.snapshot(),
      peers: [],
    });

    await assert.rejects(
      handlers.addSharingPeer(bobCard),
      /Wait a moment before trying again/,
    );
    const { handlers: again } = await setUp([true]);
    assert.equal(await again.addSharingPeer(bobCard), true);
    const state = again.getSharingState();
    assert.equal(state.status === 'ready' && state.peers.length, 1);
  });

  it('refuses identities, note ids and summaries of the wrong shape before reaching the session', async () => {
    const { handlers } = await setUp([true]);
    await handlers.addSharingPeer(bobCard);
    await assert.rejects(handlers.stopSharingPeer('not-hex'), /Unknown person/);
    await assert.rejects(
      handlers.shareMeeting('m-1', 'ABCD'),
      /Unknown person/,
    );
    await assert.rejects(
      handlers.shareMeeting('missing', 'a'.repeat(64)),
      /Unknown meeting/,
    );
    await assert.rejects(
      handlers.getSharedNote('a'.repeat(64), 'bad id!'),
      /Unknown note/,
    );
    await assert.rejects(
      handlers.editSharedNote('a'.repeat(64), 'note-1', 'x'.repeat(200_001)),
      /too long/,
    );
  });

  it('copies the card only from its own dialog, and not again right away', async () => {
    const { handlers, controller, asked, copied, advance } = await setUp([
      false,
      true,
    ]);
    await handlers.showIdentityCard();
    assert.equal(asked[0]?.confirmLabel, 'Copy card');
    assert.deepEqual(copied, []);
    await assert.rejects(handlers.showIdentityCard(), /Wait a moment/);
    advance(10_000);
    await handlers.showIdentityCard();
    assert.deepEqual(copied, [controller.identityCard()]);
  });
});
