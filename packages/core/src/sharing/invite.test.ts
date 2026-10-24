import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  identityCard,
  identityOf,
  randomKey,
  toBase64Url,
} from '../crypto/index.ts';
import {
  inviteFileIdOf,
  joinLink,
  openInviteFile,
  parseJoinLink,
  sealInviteFile,
  signInviteFile,
  type InviteFile,
} from './invite.ts';

const inviter = identityOf(new Uint8Array(32).fill(1));

const file: InviteFile = signInviteFile(inviter, {
  team: 'Roadmap',
  inviter: identityCard(inviter),
  vaultId: 'ab'.repeat(16),
  invite: 'cd'.repeat(32),
  signingKey: '01'.repeat(32),
  wrappingKey: '02'.repeat(32),
  role: 'writer',
  approval: true,
  key: null,
  host: 'https://sync.example.com/',
});

describe('invite file', () => {
  it('seals under a fresh key and opens back to the same file', () => {
    const { sealed, key, fileId } = sealInviteFile(file);
    assert.equal(fileId, inviteFileIdOf(sealed));
    assert.match(fileId, /^[0-9a-f]{32}$/);
    assert.deepEqual(openInviteFile(sealed, key), file);
    assert.equal(openInviteFile(sealed, randomKey()), null);
    assert.notEqual(sealInviteFile(file).fileId, fileId);
  });

  it('refuses a file not signed by the inviter it names', () => {
    const someone = identityOf(new Uint8Array(32).fill(2));
    const { signature: _dropped, ...unsigned } = file;
    const forged = signInviteFile(someone, unsigned);
    const sealed = sealInviteFile(forged);
    assert.equal(openInviteFile(sealed.sealed, sealed.key), null);
    const changed = sealInviteFile({ ...file, role: 'reader' });
    assert.equal(openInviteFile(changed.sealed, changed.key), null);
  });

  it('refuses a file with a bad inviter card, host or role', () => {
    for (const broken of [
      { ...file, inviter: 'nod-id:v1:AAAA' },
      { ...file, host: 'http://sync.example.com/' },
      { ...file, role: 'owner' },
      { ...file, team: '' },
      { ...file, vaultId: 'short' },
      { ...file, key: { wrap: 'AAAA', keyId: 'ab'.repeat(16) } },
      { ...file, approval: false },
      { ...file, approval: false, key: { wrap: 'AAAA', keyId: 'short' } },
    ]) {
      const sealed = sealInviteFile(JSON.parse(JSON.stringify(broken)));
      assert.equal(openInviteFile(sealed.sealed, sealed.key), null);
    }
  });
});

describe('join link', () => {
  it('carries the file id, the key and the host, host last', () => {
    const key = randomKey();
    const link = joinLink({
      vaultId: 'ef'.repeat(16),
      fileId: 'ab'.repeat(16),
      key,
      host: 'https://sync.example.com:8443/relay',
    });
    assert.equal(
      link,
      `nod-join:v1:${'ef'.repeat(16)}:${'ab'.repeat(16)}:${toBase64Url(key)}:https://sync.example.com:8443/relay`,
    );
    const parsed = parseJoinLink(` ${link} `);
    assert.ok(parsed);
    assert.equal(parsed.vaultId, 'ef'.repeat(16));
    assert.equal(parsed.fileId, 'ab'.repeat(16));
    assert.deepEqual(parsed.key, key);
    assert.equal(parsed.host, 'https://sync.example.com:8443/relay');
  });

  it('refuses a link with a short key, a bad id or an unsafe host', () => {
    const key = toBase64Url(randomKey());
    assert.equal(
      parseJoinLink(
        `nod-join:v1:${'ab'.repeat(16)}:AAAA:https://sync.example.com`,
      ),
      null,
    );
    assert.equal(
      parseJoinLink(`nod-join:v1:xyz:${key}:https://sync.example.com`),
      null,
    );
    assert.equal(
      parseJoinLink(
        `nod-join:v1:${'ab'.repeat(16)}:${key}:http://sync.example.com`,
      ),
      null,
    );
    assert.equal(
      parseJoinLink(
        `nod-join:v1:${'ab'.repeat(16)}:${key}:https://sync.example.com/?x=1`,
      ),
      null,
    );
    assert.equal(
      parseJoinLink(`nod-id:v1:${'ab'.repeat(16)}:${key}:https://a.b`),
      null,
    );
  });
});
