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

  // Teams come with the second change; a list written by a newer device
  // already reads here.
  it('reads the teams a newer device wrote', () => {
    const shares = Automerge.change(createSharesDocument(), (fields) => {
      fields.teams['vault-t'] = { host: 'relay.example', leftAt: 6_000 };
    });
    assert.deepEqual(readSharesDocument(saveAndLoad(shares))?.teams, [
      { vaultId: 'vault-t', host: 'relay.example', leftAt: 6_000 },
    ]);
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
