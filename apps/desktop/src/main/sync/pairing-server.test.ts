import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { listenForPairing } from './pairing-server.ts';

const offer = new Uint8Array([1, 2, 3, 4]);
const proof = 'a'.repeat(64);

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
      proof,
      hosts: ['127.0.0.1'],
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
      proof,
      hosts: ['127.0.0.1'],
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
      proof,
      hosts: ['127.0.0.1'],
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

  it('ignores requests to an address the code doesn’t name', async () => {
    const listener = await listenForPairing({
      offer,
      proof,
      hosts: ['192.168.1.20'],
    });
    try {
      assert.equal((await ask(listener.port, proof)).status, 404);
    } finally {
      listener.close();
    }
  });
});
