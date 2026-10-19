import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  bytesOf,
  commitmentOf,
  createPairingKeys,
  grantKey,
  pairingCode,
  randomKey,
  seal,
  textOf,
  toBase64,
} from '../crypto/index.ts';
import { pairingPath } from './layout.ts';
import { createApprover, createJoin, pairingMaxBytes } from './pairing.ts';
import { createMemoryTransport } from './testing/memory-transport.ts';
import type { Transport } from './transport.ts';

const vault = { id: 'vault-1', key: randomKey() };

function overwrite(
  transport: Transport,
  requestId: string,
  step: 'request' | 'offer' | 'reveal' | 'grant',
  body: object,
) {
  return transport.write(
    pairingPath(requestId, step),
    bytesOf(JSON.stringify(body)),
  );
}

async function codeOf(join: ReturnType<typeof createJoin>): Promise<string> {
  const progress = await join.poll();
  assert.equal(progress.step, 'confirm');
  return progress.step === 'confirm' ? progress.code : '';
}

describe('pairing a new device', () => {
  it('hands over the vault once both users confirm the same code', async () => {
    const transport = createMemoryTransport();
    const approver = createApprover(transport, vault);
    const join = createJoin(transport, 'r1');

    await join.begin();
    assert.deepEqual(await join.poll(), { step: 'waiting' });
    assert.deepEqual(await approver.pending(), []);
    const code = await codeOf(join);
    assert.deepEqual(await approver.pending(), [{ requestId: 'r1', code }]);

    join.confirm(code);
    assert.deepEqual(await join.poll(), { step: 'approving', code });
    await approver.approve('r1', code);
    assert.deepEqual(await join.poll(), {
      step: 'joined',
      vaultId: 'vault-1',
      key: vault.key,
    });
    assert.deepEqual(await transport.list('pairing/'), []);
  });

  it('never seals the vault to a key swapped in after the code was shown', async () => {
    const transport = createMemoryTransport();
    const approver = createApprover(transport, vault);
    const join = createJoin(transport, 'r1');
    await join.begin();
    await approver.pending();
    const code = await codeOf(join);
    await approver.pending();

    const attacker = createPairingKeys();
    await overwrite(transport, 'r1', 'request', {
      commitment: commitmentOf(attacker.publicKey),
    });
    await overwrite(transport, 'r1', 'reveal', {
      publicKey: attacker.publicKey,
    });

    await assert.rejects(
      approver.approve('r1', code),
      /changed or is no longer waiting/,
    );
    assert.equal(
      await transport.read(pairingPath('r1', 'grant'), pairingMaxBytes),
      null,
    );
  });

  it('stops when the offer it already used is replaced, so codes can’t be made to match', async () => {
    const transport = createMemoryTransport();
    const approver = createApprover(transport, vault);
    const join = createJoin(transport, 'r1');
    await join.begin();
    await approver.pending();
    await codeOf(join);

    await overwrite(transport, 'r1', 'offer', {
      publicKey: createPairingKeys().publicKey,
    });

    await assert.rejects(join.poll(), /changed while pairing/);
  });

  it('ignores an answer until its own user confirmed the code', async () => {
    const transport = createMemoryTransport();
    const join = createJoin(transport, 'r1');
    await join.begin();
    const attacker = createPairingKeys();
    await overwrite(transport, 'r1', 'offer', {
      publicKey: attacker.publicKey,
    });
    await join.poll();
    const reveal = await transport.read(
      pairingPath('r1', 'reveal'),
      pairingMaxBytes,
    );
    const revealed = JSON.parse(textOf(reveal ?? new Uint8Array())).publicKey;
    await overwrite(transport, 'r1', 'grant', {
      sealed: toBase64(
        seal(
          grantKey(attacker, revealed, 'r1'),
          bytesOf(
            JSON.stringify({
              vaultId: 'evil',
              key: toBase64(randomKey()),
            }),
          ),
          'nod:grant:r1',
        ),
      ),
    });

    const progress = await join.poll();
    assert.equal(progress.step, 'confirm');
    assert.throws(
      () =>
        join.confirm(
          '000000' === pairingCode(revealed, attacker.publicKey)
            ? '111111'
            : '000000',
        ),
      /no longer the one shown/,
    );
  });

  it('steps aside when another device’s offer replaced its own', async () => {
    const transport = createMemoryTransport();
    const approver = createApprover(transport, vault);
    const join = createJoin(transport, 'r1');
    await join.begin();
    await approver.pending();
    await overwrite(transport, 'r1', 'offer', {
      publicKey: createPairingKeys().publicKey,
    });

    assert.deepEqual(await approver.pending(), []);
    assert.equal(
      (await transport.list('pairing/')).some((file) =>
        file.path.endsWith('request.json'),
      ),
      true,
    );
  });

  it('finishes pairing when two devices of the vault answer at the same moment', async () => {
    const transport = createMemoryTransport();
    const laptop = createApprover(transport, vault);
    const desktop = createApprover(transport, vault);
    const join = createJoin(transport, 'r1');
    await join.begin();
    await Promise.all([laptop.pending(), desktop.pending()]);
    const code = await codeOf(join);
    const answers = await Promise.all([laptop.pending(), desktop.pending()]);
    const answering = answers[0].length > 0 ? laptop : desktop;
    assert.deepEqual(answers.flat(), [{ requestId: 'r1', code }]);

    join.confirm(code);
    await answering.approve('r1', code);
    assert.equal((await join.poll()).step, 'joined');
  });

  it('clears a request nobody touched for a day', async () => {
    const transport = createMemoryTransport();
    let time = Date.now();
    const answered = createApprover(transport, vault);
    await createJoin(transport, 'r1').begin();
    await answered.pending();
    const afterRestart = createApprover(transport, vault, () => time);
    await afterRestart.pending();
    assert.notDeepEqual(await transport.list('pairing/'), []);
    time += 25 * 60 * 60 * 1000;
    await afterRestart.pending();
    assert.deepEqual(await transport.list('pairing/'), []);
  });

  it('refuses an approval for a code the user wasn’t shown', async () => {
    const transport = createMemoryTransport();
    const approver = createApprover(transport, vault);
    const join = createJoin(transport, 'r1');
    await join.begin();
    await approver.pending();
    const code = await codeOf(join);
    await approver.pending();
    await assert.rejects(
      approver.approve('r1', code === '000000' ? '111111' : '000000'),
      /changed/,
    );
  });

  it('leaves a request another device of the vault answered, so that one can finish it', async () => {
    const transport = createMemoryTransport();
    const laptop = createApprover(transport, vault);
    const desktop = createApprover(transport, vault);
    const join = createJoin(transport, 'r1');
    await join.begin();
    await laptop.pending();
    await desktop.pending();
    const code = await codeOf(join);
    assert.deepEqual(await desktop.pending(), []);
    assert.deepEqual(await laptop.pending(), [{ requestId: 'r1', code }]);

    join.confirm(code);
    await laptop.approve('r1', code);
    assert.equal((await join.poll()).step, 'joined');
  });

  it('turns down a request when its user rejects it', async () => {
    const transport = createMemoryTransport();
    const approver = createApprover(transport, vault);
    const join = createJoin(transport, 'r1');
    await join.begin();
    await approver.pending();
    await join.poll();
    await approver.reject('r1');
    await assert.rejects(join.poll(), /turned this request down/);
  });

  it('frees the slot of a request that never revealed its key', async () => {
    const transport = createMemoryTransport();
    let time = 0;
    const approver = createApprover(transport, vault, () => time);
    for (let index = 0; index < 4; index += 1) {
      await createJoin(transport, `stale${index}`).begin();
    }
    await approver.pending();
    time = 11 * 60 * 1000;
    await approver.pending();
    const join = createJoin(transport, 'fresh');
    await join.begin();
    await approver.pending();
    const code = await codeOf(join);
    assert.deepEqual(await approver.pending(), [{ requestId: 'fresh', code }]);
  });

  it('answers only a few requests at a time', async () => {
    const transport = createMemoryTransport();
    const approver = createApprover(transport, vault);
    for (let index = 0; index < 6; index += 1) {
      await createJoin(transport, `r${index}`).begin();
    }
    await approver.pending();
    const offers = (await transport.list('pairing/')).filter((file) =>
      file.path.endsWith('offer.json'),
    );
    assert.equal(offers.length, 4);
  });
});
