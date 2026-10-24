import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as Automerge from '@automerge/automerge';
import {
  identityCard,
  identityCodeOf,
  identityHex,
  identityOf,
} from '../crypto/index.ts';
import {
  addPeer,
  addTeam,
  leaveTeam,
  createSharesDocument,
  loadSharesDocument,
  mergeSharesDocuments,
  readSharesDocument,
  saveSharesDocument,
  stopPeer,
} from './shares-document.ts';

const bob = identityOf(new Uint8Array(32).fill(2));
const carol = identityOf(new Uint8Array(32).fill(3));
const bobCard = identityCard(bob);
const carolCard = identityCard(carol);

describe('shares document', () => {
  it('keeps the people a person shares with, with the code to show for each', () => {
    let shares = addPeer(createSharesDocument(), bobCard);
    assert.deepEqual(readSharesDocument(shares), {
      peers: [
        {
          identity: identityHex(bob.publicKey),
          code: identityCodeOf(bob.publicKey),
          card: bobCard,
          stoppedAt: null,
        },
      ],
      teams: [],
    });
    shares = stopPeer(shares, identityHex(bob.publicKey), 5_000);
    const read = readSharesDocument(saveAndLoad(shares));
    assert.equal(read?.peers[0]?.stoppedAt, 5_000);
    assert.throws(() => addPeer(shares, 'nod-id:v1:junk'), /identity card/);
  });

  it('reads teams, and leaves out an entry with no team vault id or relay', () => {
    const vaultId = 'ab'.repeat(16);
    const shares = Automerge.change(
      addTeam(createSharesDocument(), vaultId, {
        host: 'https://relay.example/',
        request: null,
        invitedBy: null,
        replaces: null,
      }),
      (fields) => {
        fields.teams['vault-t'] = { host: 'relay.example', leftAt: 6_000 };
        fields.teams['ef'.repeat(16)] = { host: '', leftAt: null };
        fields.teams['12'.repeat(16)] = {
          host: 'http://relay.example/',
          leftAt: null,
        };
      },
    );
    assert.deepEqual(readSharesDocument(saveAndLoad(shares))?.teams, [
      {
        vaultId,
        host: 'https://relay.example/',
        leftAt: null,
        request: null,
        invitedBy: null,
        replaces: null,
      },
    ]);
    const asked = addTeam(shares, 'cd'.repeat(16), {
      host: 'https://other.example/',
      request: 'ef'.repeat(32),
      invitedBy: { invite: 'ab'.repeat(32), identity: '12'.repeat(32) },
      replaces: '34'.repeat(32),
    });
    assert.deepEqual(readSharesDocument(asked)?.teams[1], {
      vaultId: 'cd'.repeat(16),
      host: 'https://other.example/',
      leftAt: null,
      request: 'ef'.repeat(32),
      invitedBy: { invite: 'ab'.repeat(32), identity: '12'.repeat(32) },
      replaces: '34'.repeat(32),
    });
    const left = leaveTeam(asked, vaultId, 7_000);
    assert.deepEqual(readSharesDocument(left)?.teams[0], {
      vaultId,
      host: 'https://relay.example/',
      leftAt: 7_000,
      request: null,
      invitedBy: null,
      replaces: null,
    });
  });

  it('keeps shares two devices added at once, and a stop either made', () => {
    const base = createSharesDocument();
    const laptop = addPeer(Automerge.clone(base), bobCard);
    const phone = addPeer(Automerge.clone(base), carolCard);
    const merged = readSharesDocument(mergeSharesDocuments(laptop, phone));
    assert.deepEqual(
      merged?.peers.map((peer) => peer.identity).sort(),
      [identityHex(bob.publicKey), identityHex(carol.publicKey)].sort(),
    );
    const stopped = stopPeer(
      Automerge.clone(laptop),
      identityHex(bob.publicKey),
      9_000,
    );
    assert.equal(
      readSharesDocument(mergeSharesDocuments(laptop, stopped))?.peers[0]
        ?.stoppedAt,
      9_000,
    );
  });

  it('drops a card that doesn’t verify or sits under another identity', () => {
    const planted = Automerge.change(
      addPeer(createSharesDocument(), bobCard),
      (fields) => {
        fields.peers['deadbeef'] = { card: carolCard, stoppedAt: null };
        fields.peers['bad'] = { card: 'nod-id:v1:AAAA', stoppedAt: null };
      },
    );
    assert.deepEqual(
      readSharesDocument(planted)?.peers.map((peer) => peer.identity),
      [identityHex(bob.publicKey)],
    );
    assert.equal(
      readSharesDocument(
        Automerge.change(createSharesDocument(), (fields) => {
          fields.schema = 2;
        }),
      ),
      null,
    );
  });
});

function saveAndLoad(document: ReturnType<typeof createSharesDocument>) {
  const loaded = loadSharesDocument(saveSharesDocument(document));
  assert.ok(loaded);
  return loaded.document;
}
