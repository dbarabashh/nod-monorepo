import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bytesOf } from './encoding.ts';
import { identityOf } from './identity.ts';
import {
  relayRequestWindowMs,
  signRelayRequest,
  verifyRelayRequest,
} from './relay-request.ts';

const alice = identityOf(new Uint8Array(32).fill(1));
const request = {
  host: 'sync.example.com',
  method: 'PUT',
  path: '/v1/vaults/abc/files/devices/d1/notes/n1.bin',
  vaultId: 'abc',
  body: bytesOf('sealed'),
};
const now = 1_700_000_000_000;

describe('signed relay requests', () => {
  it('names the identity and verifies within the window', () => {
    const header = signRelayRequest(alice, request, now);
    assert.match(
      header,
      /^Nod-Identity [A-Za-z0-9_-]{43} \d+ [A-Za-z0-9_-]+ [A-Za-z0-9_-]+$/,
    );
    const verified = verifyRelayRequest(header, request, now + 1_000);
    assert.ok(verified);
    assert.deepEqual(verified.identity, alice.publicKey);
    assert.equal(verified.time, now);
    assert.ok(
      verifyRelayRequest(header, { ...request, method: 'put' }, now),
      'the method is compared without regard to case',
    );
  });

  it('refuses a request moved to another host, path, vault, body or method', () => {
    const header = signRelayRequest(alice, request, now);
    for (const changed of [
      { ...request, host: 'other.example.com' },
      { ...request, path: '/v1/vaults/abc/files/devices/d2/notes/n1.bin' },
      { ...request, vaultId: 'abd' },
      { ...request, body: bytesOf('other') },
      { ...request, body: null },
      { ...request, method: 'DELETE' },
    ]) {
      assert.equal(verifyRelayRequest(header, changed, now), null);
    }
  });

  it('refuses a request outside the window or with a damaged header', () => {
    const header = signRelayRequest(alice, request, now);
    assert.equal(
      verifyRelayRequest(header, request, now + relayRequestWindowMs + 1),
      null,
    );
    assert.equal(
      verifyRelayRequest(header, request, now - relayRequestWindowMs - 1),
      null,
    );
    assert.equal(
      verifyRelayRequest(
        header.replace('Nod-Identity', 'Bearer'),
        request,
        now,
      ),
      null,
    );
    const parts = header.split(' ');
    parts[2] = String(now + 1);
    assert.equal(verifyRelayRequest(parts.join(' '), request, now), null);
    assert.equal(verifyRelayRequest(`${header} extra`, request, now), null);
  });

  it('takes a nonce and a time in one spelling only, so a replay can’t look new', () => {
    const header = signRelayRequest(alice, request, now);
    const parts = header.split(' ');
    const nonce = parts[3] ?? '';
    // The last character of a 16-byte nonce carries two bits; the others
    // decode to the same bytes.
    const last = nonce.at(-1) ?? '';
    const other =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
        .split('')
        .find(
          (char) =>
            char !== last &&
            (char.charCodeAt(0) & 0x30) === (last.charCodeAt(0) & 0x30),
        );
    assert.ok(other);
    parts[3] = `${nonce.slice(0, -1)}${other}`;
    assert.equal(verifyRelayRequest(parts.join(' '), request, now), null);
    parts[3] = `${nonce}==`;
    assert.equal(verifyRelayRequest(parts.join(' '), request, now), null);
    parts[3] = nonce;
    parts[2] = `0${now}`;
    assert.equal(verifyRelayRequest(parts.join(' '), request, now), null);
    parts[2] = String(now);
    assert.ok(verifyRelayRequest(parts.join(' '), request, now));
  });

  it('uses a fresh nonce every time', () => {
    assert.notEqual(
      signRelayRequest(alice, request, now),
      signRelayRequest(alice, request, now),
    );
  });
});
