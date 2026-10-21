import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  isLocalAddress,
  openPairingOffer,
  pairingCode,
  readPairingCode,
  requestPairingOffer,
  sealPairingOffer,
} from './pairing.ts';
import type { Fetch } from './relay.ts';

const zero = new Uint8Array(32);
const counting = Uint8Array.from({ length: 32 }, (_, index) => index * 8);
const encodedCounting = 'AAgQGCAoMDhASFBYYGhweICIkJigqLC4wMjQ2ODo8Pg';

describe('pairing code', () => {
  it('writes a one-time secret and local addresses, never a vault key', () => {
    assert.equal(
      pairingCode({ secret: zero, port: 51234, hosts: ['192.168.1.20'] }),
      'nod-pair:v2:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:51234:192.168.1.20',
    );
    assert.equal(
      pairingCode({
        secret: counting,
        port: 8,
        hosts: ['10.0.0.5', '203.0.113.9', '172.20.1.1'],
      }),
      `nod-pair:v2:${encodedCounting}:8:10.0.0.5,172.20.1.1`,
    );
  });

  it('reads back what it was made from', () => {
    const code = readPairingCode(
      `nod-pair:v2:${encodedCounting}:51234:192.168.1.20,10.1.2.3`,
    );
    assert.deepEqual([...code.secret], [...counting]);
    assert.equal(code.port, 51234);
    assert.deepEqual(code.hosts, ['192.168.1.20', '10.1.2.3']);
  });

  it('won’t make a code for a computer with no local network', () => {
    assert.throws(
      () => pairingCode({ secret: zero, port: 1, hosts: ['8.8.8.8'] }),
      /local network/,
    );
  });

  it('refuses anything else a camera might see', () => {
    for (const text of [
      '',
      'https://example.com',
      `nod-pair:v1:${encodedCounting}:https://relay.example.com/`,
      `nod-pair:v2:${encodedCounting}:51234`,
      `nod-pair:v2:${encodedCounting.slice(1)}:51234:192.168.1.20`,
      `nod-pair:v2:${encodedCounting.slice(0, -1)}h:51234:192.168.1.20`,
      `nod-pair:v2:${encodedCounting}:0:192.168.1.20`,
      `nod-pair:v2:${encodedCounting}:65536:192.168.1.20`,
      `nod-pair:v2:${encodedCounting}:0080:192.168.1.20`,
      `nod-pair:v2:${encodedCounting}:51234:8.8.8.8`,
      `nod-pair:v2:${encodedCounting}:51234:relay.example.com`,
      `nod-pair:v2:${encodedCounting}:51234:192.168.1.20:extra`,
      `nod-pair:v2:${encodedCounting}:51234:10.0.0.1,10.0.0.2,10.0.0.3,10.0.0.4,10.0.0.5`,
    ]) {
      assert.throws(() => readPairingCode(text), /pairing code/, text);
    }
  });
});

describe('local addresses', () => {
  it('takes only private and link-local IPv4', () => {
    for (const host of [
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.0.10',
      '169.254.3.4',
    ]) {
      assert.equal(isLocalAddress(host), true, host);
    }
    for (const host of [
      '127.0.0.1',
      '172.15.0.1',
      '172.32.0.1',
      '8.8.8.8',
      '192.169.0.1',
      '010.0.0.1',
      '10.0.0.256',
      'localhost',
      'fe80::1',
    ]) {
      assert.equal(isLocalAddress(host), false, host);
    }
  });
});

describe('pairing offer', () => {
  const key = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);

  it('opens with the secret from the code and gives the vault key and relay', () => {
    const sealed = sealPairingOffer(counting, {
      key,
      relayUrl: 'https://relay.example.com',
    });
    const offer = openPairingOffer(counting, sealed);
    assert.deepEqual([...offer.key], [...key]);
    assert.equal(offer.relayUrl, 'https://relay.example.com/');
  });

  it('doesn’t open with another secret, or when changed', () => {
    const sealed = sealPairingOffer(counting, {
      key,
      relayUrl: 'https://relay.example.com',
    });
    assert.throws(() => openPairingOffer(zero, sealed), /couldn’t be read/);
    const changed = sealed.slice();
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    assert.throws(
      () => openPairingOffer(counting, changed),
      /couldn’t be read/,
    );
  });

  it('refuses a relay a phone shouldn’t sync through', () => {
    for (const relayUrl of [
      'http://relay.example.com',
      'https://192.168.1.10',
      'https://relay.example.com/?words=secret',
    ]) {
      assert.throws(
        () => sealPairingOffer(counting, { key, relayUrl }),
        /https|host name|login/,
        relayUrl,
      );
    }
  });
});

describe('asking the computer for the offer', () => {
  const key = Uint8Array.from({ length: 32 }, (_, index) => index);
  const code = {
    secret: counting,
    port: 51234,
    hosts: ['192.168.1.20', '10.0.0.5'],
  };
  const sealed = sealPairingOffer(counting, {
    key,
    relayUrl: 'https://relay.example.com',
  });
  const answer = (
    status: number,
    body: Uint8Array,
  ): Awaited<ReturnType<Fetch>> => ({
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => (name === 'content-length' ? String(body.length) : null),
    },
    body: null,
    arrayBuffer: async () => body.slice().buffer,
  });

  it('skips an address where something else answers, and takes the computer’s offer', async () => {
    const asked: string[] = [];
    const offer = await requestPairingOffer(code, async (url) => {
      asked.push(url);
      return url.includes('192.168.1.20')
        ? answer(200, new Uint8Array([1, 2, 3]))
        : answer(200, sealed);
    });
    assert.deepEqual(asked, [
      'http://192.168.1.20:51234/v1/pair',
      'http://10.0.0.5:51234/v1/pair',
    ]);
    assert.deepEqual([...offer.key], [...key]);
  });

  it('says when the code was already used', async () => {
    await assert.rejects(
      requestPairingOffer(code, async () => answer(404, new Uint8Array())),
      /already used/,
    );
  });

  it('says when the computer can’t be reached', async () => {
    await assert.rejects(
      requestPairingOffer(code, async () => {
        throw new Error('offline');
      }),
      /same Wi‑Fi/,
    );
  });

  it('doesn’t read an answer larger than an offer', async () => {
    let read = false;
    await assert.rejects(
      requestPairingOffer(code, async () => ({
        ...answer(200, sealed),
        headers: { get: () => String(10 * 1024 * 1024) },
        arrayBuffer: async () => {
          read = true;
          return new ArrayBuffer(0);
        },
      })),
      /same Wi‑Fi/,
    );
    assert.equal(read, false);
  });
});
