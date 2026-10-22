import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { listenForPairing } from './pairing-server.ts';

const offer = new Uint8Array([1, 2, 3, 4]);
const proof = 'a'.repeat(64);
const proofFor = (host: string, port: number) =>
  host === '127.0.0.1' && port > 0 ? proof : 'z'.repeat(64);

async function ask(port: number, token: string, path = '/v1/pair') {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

describe('pairing listener', () => {
  it('gives the offer once, only to the holder of the proof', async () => {
    const listener = await listenForPairing({
      offer,
      proofFor,
      hosts: ['127.0.0.1'],
      confirm: async () => true,
    });
    try {
      assert.equal((await ask(listener.port, 'b'.repeat(64))).status, 404);
      assert.equal((await ask(listener.port, proof, '/other')).status, 404);

      const answer = await ask(listener.port, proof);
      assert.equal(answer.status, 200);
      assert.deepEqual([...answer.body], [1, 2, 3, 4]);
      assert.deepEqual(await listener.outcome, { by: '127.0.0.1' });

      await assert.rejects(ask(listener.port, proof));
    } finally {
      listener.close();
    }
  });

  it('takes 19 wrong tries, and closes on the 20th without giving the offer', async () => {
    const patient = await listenForPairing({
      offer,
      proofFor,
      hosts: ['127.0.0.1'],
      confirm: async () => true,
    });
    try {
      for (let attempt = 0; attempt < 19; attempt += 1) {
        await ask(patient.port, 'b'.repeat(64));
      }
      assert.equal((await ask(patient.port, proof)).status, 200);
    } finally {
      patient.close();
    }

    const listener = await listenForPairing({
      offer,
      proofFor,
      hosts: ['127.0.0.1'],
      confirm: async () => true,
    });
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await ask(listener.port, 'b'.repeat(64)).catch(() => undefined);
      }
      assert.equal(await listener.outcome, null);
      await assert.rejects(ask(listener.port, proof));
    } finally {
      listener.close();
    }
  });

  it('asks before giving the offer, keeps the asker waiting, and turns others away', async () => {
    let decide = (_allowed: boolean) => {};
    const askedFor: string[] = [];
    const listener = await listenForPairing({
      offer,
      proofFor,
      hosts: ['127.0.0.1'],
      holdMs: 20,
      confirm: (by) => {
        askedFor.push(by);
        return new Promise((resolve) => {
          decide = resolve;
        });
      },
    });
    try {
      const first = await ask(listener.port, proof);
      assert.equal(first.status, 202);
      assert.equal(Buffer.from(first.body).toString(), '127.0.0.1');
      assert.equal((await ask(listener.port, proof)).status, 202);
      assert.deepEqual(askedFor, ['127.0.0.1']);
      const waiting = ask(listener.port, proof);
      decide(true);
      const answer = await waiting;
      assert.equal(answer.status, 200);
      assert.deepEqual([...answer.body], [1, 2, 3, 4]);
      assert.deepEqual(await listener.outcome, { by: '127.0.0.1' });
    } finally {
      listener.close();
    }
  });

  it('answers 403 once, and closes, when the user doesn’t allow the phone', async () => {
    const listener = await listenForPairing({
      offer,
      proofFor,
      hosts: ['127.0.0.1'],
      holdMs: 20,
      confirm: async () => false,
    });
    try {
      assert.equal((await ask(listener.port, proof)).status, 403);
      assert.equal(await listener.outcome, null);
      await assert.rejects(ask(listener.port, proof));
    } finally {
      listener.close();
    }
  });

  it('counts a question that fails as not allowed', async () => {
    const listener = await listenForPairing({
      offer,
      proofFor,
      hosts: ['127.0.0.1'],
      holdMs: 20,
      confirm: async () => {
        throw new Error('Object has been destroyed');
      },
    });
    try {
      assert.equal((await ask(listener.port, proof)).status, 403);
      assert.equal(await listener.outcome, null);
    } finally {
      listener.close();
    }
  });

  it('wants the proof made for the address and port it was reached at', async () => {
    const listener = await listenForPairing({
      offer,
      proofFor: (host, port) => `${host}:${port}`,
      hosts: ['127.0.0.1'],
      confirm: async () => true,
    });
    try {
      assert.equal((await ask(listener.port, '127.0.0.1:0')).status, 404);
      assert.equal(
        (await ask(listener.port, `127.0.0.1:${listener.port}`)).status,
        200,
      );
    } finally {
      listener.close();
    }
  });

  it('ignores requests to an address the code doesn’t name', async () => {
    const listener = await listenForPairing({
      offer,
      proofFor,
      hosts: ['192.168.1.20'],
      confirm: async () => true,
    });
    try {
      assert.equal((await ask(listener.port, proof)).status, 404);
    } finally {
      listener.close();
    }
  });
});
