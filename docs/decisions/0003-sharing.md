# 0003: Sharing notes with other people

- Status: proposed
- Scope: `packages/core/src/crypto`, `packages/core/src/sync`, `packages/core/src/sharing`, `apps/desktop/relay`, `apps/desktop/src/main/sync`, `apps/mobile/src/lib/sync`

## Context

0001 syncs one person's meetings between their own devices. Everything in it
rests on one fact: every device in a vault belongs to the same person, so one
key is enough, every device may write, and nothing needs to say who wrote
what. People now want to hand a meeting's notes to a colleague or keep a
team's notes in one place. That breaks the fact: several people, who come and
go, with different rights, and no device that belongs to all of them.

The rules in `.agents/rules/local-first.md` still hold: content leaves a
device only as ciphertext the transport cannot read, and no server feature
may need plaintext. So a share link that opens in a browser without a key, and
a comment thread the server stores, are out of reach by design.

Two patterns exist for this among encrypted, local-first apps:

- **Keys wrapped per member, membership kept by an account server.** A
  shared space gets a random key, wrapped for each member under a public key
  derived from that member's recovery secret, with the wrapped keys stored as
  ciphertext and a key generation retired when a member leaves. Who is a
  member, with what role, and how people are invited is the server's business,
  tied to accounts. The server never holds a key, but without accounts the
  pattern has no way to say who may change the membership.
- **A signed access list the server validates.** Each shared space has an
  append-only log of records; every record names its author's signing
  identity and signs the previous record's id. A validator that both clients
  and the server run decides who may do what, and every write to data carries
  the writer's identity, a signature and the list head it was made under, so
  the server refuses writes from anyone without the right while never holding
  a key. The space key is wrapped per member; removing a member is one record
  that also rotates the key, with the old key wrapped under the new one so a
  member reads history back from the newest key. An invitation is a keypair
  whose public half goes into the list and whose private half goes into a
  link. Two people who know each other's identity can also share a space
  whose key both derive from a Diffie-Hellman exchange, with no list at all.

### What a first design got wrong

A first sketch kept the relay as it is (one token per vault, derived from the
vault key) and put a wrapped team key per member next to the files. 0001
already records why that fails ("Subkeys and changing the phrase"): whoever
holds the old key holds the old relay token, and can forge or delete whatever
rests on it, including the grants meant to lock them out. The same token lets
any member overwrite or delete every other member's files, since "a device
writes only its own files" is a rule the clients follow, not one the relay
enforces. And a shared symmetric key says nothing about who published a file.
None of this matters inside one person's vault, and all of it matters the
moment there are two people.

## Options considered

1. **A plaintext snapshot of the summary on the server.** Gives web viewing,
   comments and "anyone with the link". Rejected: it is a central store of
   readable notes, which `local-first.md` forbids.
2. **A team vault with wrapped keys beside the files, no server logic.**
   Rejected for the reasons above.
3. **A per-note key wrapped for each recipient, no shared space.** 0001
   expected this ("sharing a meeting with another person, which needs
   per-meeting keys"). Revocation is "stop sending", nothing rotates. It
   covers "send this to a colleague" but not a team's shared notes, and every
   note costs one wrap per recipient per device. The one-to-one vault below
   gives the same result with less machinery, so 0001's forecast is not
   followed.
4. **An access list the relay validates.** The relay gains a signed log per
   shared vault and checks every request against it, still without a key.
   Chosen: it is the only one of the four that gives roles and removal without
   plaintext, and its parts are the primitives 0001 already ships plus
   signatures.

## Decision

Sharing comes in two shapes, both end-to-end encrypted, both built on a
person's **identity** derived from their vault root key:

- a **one-to-one vault** between two people, whose key both derive from their
  identities. No list, no invitation to accept, no roles, no revocation.
- a **team vault** with a random key and an **access list** the relay keeps
  and validates. Owner, admin, writer and reader roles, invitations by link,
  removal with key rotation.

What is shared is never the meeting itself. A person shares a **note**: a
document of its own holding a title and a summary, written from a meeting
and never carrying its transcript, its memo or anything about audio.

### Identity

A person's identity is derived from their vault root key, so every device
they pair has it without anything new to write down, and nothing new to back
up:

- a signing key: Ed25519 from the seed HKDF-SHA256(root key, salt
  `nod:vault`, info `identity-sign`, 32 bytes);
- a wrapping key: X25519 from HKDF-SHA256(root key, salt `nod:vault`, info
  `identity-wrap`, 32 bytes);
- a blinding key: HKDF-SHA256(root key, salt `nod:vault`, info
  `device-blind`, 32 bytes), used only to name this person's devices in
  shared vaults (below).

The keys are derived separately rather than converted from one another, so no
key is used in two protocols. The **identity** is the signing public key. An
**identity card** is the signing public key, the wrapping public key and the
signing key's signature over both, as `nod-id:v1:<base64url>`; it is public,
travels over any channel, and is checked by its signature before use. The
card proves possession of the signing key only; a card that names someone
else's wrapping key wastes a wrap and nothing more. A card shows a short
**identity code** (the first 80 bits of SHA-256 of the signing public key,
in five groups of four hex digits) so two people can compare it aloud; 64
bits would leave finding a second key with the same code within reach of a
well-funded attacker.

Signatures follow RFC 8032 strictly: the verifier refuses small-order public
keys, which anyone can sign for, and other spellings of one point. A card
whose wrapping key is of small order is refused too, since every shared
secret with it is zero and a key change that wraps for it would fail. Every
byte string a card or a record carries in base64url must be in its one
canonical spelling, so a record can't take another id by spelling its
signature another way.

Everything the signing key signs (cards, access-list records, sealed files,
relay requests, join proofs) is one binary framing defined in core, with
fixed field order and length-prefixed fields, under a distinct prefix per use
(`nod:sig:card:v1`, `nod:sig:acl:v1`, `nod:sig:file:v2`, `nod:sig:relay:v1`,
`nod:sig:join:v1`, `nod:sig:invite:v1`), so a signature made for one purpose
can't be presented as another. A record's id is SHA-256 of the record with its signature.

### Changing the phrase

Changing the phrase (0001) changes the root key and so the identity, and the
reason to change it is that the old one may be in someone else's hands. So
the switch hands every share over to the new identity and leaves the old one
nothing:

- before anything changes, the device reads the list of every team the old
  identity manages; when one can't be reached, the change waits, or goes on
  only if the person agrees to leave that team behind, since the old
  identity's rights can only be passed on through the list;
- for each team the old identity manages, it adds the new identity's card
  (as an admin where it was the owner, as a writer where it was an admin,
  since only owners make admins), and an owner hands ownership over with an
  `ownerChange`, keeping a writer's role. The new identity's first round on
  that team removes the old identity with an `accountsRemove`, which rotates
  the key, so the old phrase opens nothing written from then on. Where the
  old identity was an admin, the new one, a writer, can't remove it; the app
  says to ask the owner;
- for each team the old identity doesn't manage, it asks to leave
  (`requestRemove`), and the new identity has to be invited again;
- for each one-to-one vault, the device removes its own files from the vault,
  as 0001 does with the old personal vault, and marks the share stopped. The
  peer is not told; one-to-one shares can't be revoked, so the two people
  exchange cards again under the new identity.

The device keeps the old root key and its old device id in its settings,
beside the new ones, until every team the old identity may manage is
handed over. A team it can't hand over, because the relay failed part way
or the app quit or crashed, stays in the old identity's shares list. Later
sync rounds load the old identity into a session of their own, at most
every few minutes, and check that every team in that list can be reached.
Only then does the app's own session drop its identity while the old one
ends, so nothing the user does runs as the identity that is ending, and a
call that waited behind the end is refused rather than run as it. The old
identity is never left with rights no device can pass on. Each step is safe
to run twice: the list is read again first, and a successor already added
isn't added again. Changing the phrase again, or entering another one,
before that is done leaves those teams to the old identity, so the app asks
first. Telling the old personal vault's other devices is not resumed, so
after a crash they may need the new phrase entered by hand.

A join request the old identity made and nobody answered yet can't be
withdrawn, since no record does that; a manager who approves it later lets
in an identity no device holds, and removes it like any member who left.

Entering another existing phrase on a device is not a change of identity:
other devices may go on with the old phrase. That device only takes its own
copies out of the shared vaults and teams it was in; the old identity's
shares and memberships stay as they are. The same holds for a phone that
stops syncing or pairs with another phrase.

### Where a person's shares are kept

Which people and teams a person shares with is state of their own, and it
follows them to every device the way meetings do: a **shares** document in
the personal vault at `devices/<device>/shares.bin`, sealed and published
like a meeting:

```
{
  schema: 1,
  peers: { [identity as hex]: { card: string, stoppedAt: number | null } },
  teams: { [vaultId]: { host: string, leftAt: number | null } }
}
```

Each entry is a whole value keyed by identity (the signing public key as
hex) or vault id, so two devices adding shares at once keep both, and
stopping one is a value every device adopts. Every device starts the
document from the same fixed first change, so their lists share one history
and merge rather than compete. The list belongs to one vault: a device that
takes another phrase starts another list, since to the people it shared with
it is another person. A stop made on any of the person's devices ends the
share on all of them once the list arrives: each removes its own copies from
the shared vault and stops syncing it. The notes stay on each device, and
are shared again if the person is added back. A team's root key is not
stored there; a device recovers it from the access list, where it is wrapped
for this identity. A one-to-one key is derived from the peer's card. So
pairing a phone (0001) hands it every share along with the root key, and
nothing else has to be carried over. Older builds don't know the path and skip
the file.

The sync engine of 0001 runs one vault per device. It becomes one **round per
vault**: the personal vault and each shared vault have their own device id,
listing, published log and key, and share nothing but the schedule. Settings
keep a list of vaults rather than one.

### Blinded device ids

A device never writes under its own device id in a shared vault. It writes
under HMAC-SHA256(blinding key, `nod:device:<vault id>:<device id>`) as hex:
stable for that device in that vault across key rotations, computable only by
its owner, and unrelated to the id the same device uses in the personal vault
or any other shared vault. A relay that holds a person's own vault and a
shared one can't tell the two devices are one.

In a team vault the relay binds a device folder to the identity that first
writes into it, for as long as the vault exists, and refuses every other
identity there, so no member can take over another's folder, even an emptied
one. A write whose file header names another identity than the request is
refused too. A relay that lost its state rebuilds the bindings from the
identity field of the files it holds. An owner or admin may delete the files
of a folder whose identity is no longer in the list, so a removed member's
copies don't count against the vault forever.

### Sealed files, version 2

Files in a shared vault use version 2 of the sealed format from 0001. The
first byte is `2`, followed by

```
keyId      16 bytes   which key generation sealed this (see Removal and rotation)
identity   32 bytes   the publisher's signing public key
signature  64 bytes   Ed25519 over the version byte, keyId, identity, nonce,
                      ciphertext and the associated data
nonce, ciphertext     AES-256-GCM as in version 1
```

The associated data is the version byte followed by
`nod:sync:v2:<vault>:<device>:<note>:<keyId hex>:<identity hex>`, as 0001
requires of every version after the first, so a file can't be moved to another
vault, device, note or generation, or re-signed by someone else. A file is read
only when the signature verifies and the publisher had write permission in the
list state that introduced the generation the key id names; a new write is
accepted only under the current
generation. Version 1 stays what personal vaults write: nothing there needs
a signature, and devices on older builds keep reading them. An older build
that meets a version 2 file skips it as unreadable and reports it, as 0001
has it do for any file it can't open. Random 96-bit nonces under one key stay
far below the count where collisions matter, since a vault's key seals notes,
not transcripts, and rotates with its membership.

The signature says who **published** this copy of the document. A shared
note is merged from every member's copy, so the text inside says nothing by
itself about who typed which words; the app shows whose copy a change arrived
in, not more.

### One-to-one vaults

Two people exchange identity cards (a QR code, a pasted string, a message in
any app) and compare identity codes. Each device then derives

```
secret   = X25519(own wrapping key, other wrapping public key)
root key = HKDF-SHA256(secret, salt `nod:vault`,
                       info `one-to-one:<lower identity>:<higher identity>`, 32 bytes)
```

with the two identities as base64url, the lower one first by byte order of
the public keys, so both sides get the same root key, and from it the file
key, relay token and vault id exactly as 0001 does. A card naming the
device's own identity, or a shared secret of all zeros, is refused. A
one-to-one vault is therefore an ordinary vault to the relay and to the
folder transport: the same registration, the same token, the same layout. It
exists as soon as both sides know each other; there is nothing to accept. Its
two identities are its only accepted publishers, both are writers, it has one
key generation, and its files carry a key id of sixteen zero bytes.

Both people write version 2 files, so each knows whose copy a change came
in. Both hold the whole key and the whole token, so there is no revocation
and no protection of one side's files from the other: either person, or
whoever holds either person's old phrase, can delete the other's copies from
the place. Stopping a share removes this device's own files and stops syncing
that vault, and the other person keeps what they already received, as they
would a sent email. The app says exactly that when a share is stopped. The
vault is deterministic, so the same two people always get the same vault
until one of them changes their phrase.

Shared vaults neither write nor read the closing notice of 0001
(`closed.json`): it carries no identity, so in a vault with two people it
would let either stop the other's devices for good. The team relay refuses
the path.

### Team vaults

A team vault has a random root key and an **access list**: an append-only
log of records, each naming its author's identity, signing the previous
record's id, and carrying one of

| record            | who may add it     | what it does                                                    |
| ----------------- | ------------------ | --------------------------------------------------------------- |
| root              | the creator        | names the owner and wraps the root key for them                 |
| invite            | owner, admin       | publishes an invite's public keys, the role it grants, approval |
| inviteRevoke      | owner, admin       | retires an invite; a no-approval invite also rotates the key    |
| requestJoin       | anyone with a link | asks to join, identity signed by the invite signing key         |
| inviteJoin        | anyone with a link | joins through a no-approval invite, re-wrapping the key         |
| requestAccept     | owner, admin       | wraps the root key for the requester, sets their role           |
| requestDecline    | owner, admin       | declines a request                                              |
| accountsAdd       | owner, admin       | adds people by identity card, wrapping the key for each         |
| permissionChanges | owner, admin       | changes roles; taking write away rotates the key                |
| accountsRemove    | owner, admin       | removes people and rotates the key in the same record           |
| keyChange         | owner, admin       | rotates the key without changing membership                     |
| requestRemove     | any member         | asks to leave; an owner or admin answers with accountsRemove    |
| ownerChange       | owner              | makes another member the owner, keeps a role for the old one    |

Owners and admins manage members and invites and have everything a writer
has; only an owner makes, demotes or removes an admin, and admins can't touch
each other; nobody removes an owner, who leaves only after an `ownerChange`;
readers read, writers also write. The validator that decides this is one
module in `packages/core/src/sharing`, exported as `@nod/core/sharing`, and
the relay runs the same module, so a client and the relay never disagree
about who may do what.

A team vault's id is the first 16 bytes of SHA-256 of its root record, as
hex, not a derivation from the key, so rotating the key never moves the
vault. The creator registers
the vault by posting the root record to `/v1/vaults/<id>/acl`; the relay
checks the hash and that the record is signed by the owner it names. Every
later record is appended there and accepted only when it carries the current
head as its previous id (compare-and-append, so two admins acting at once
produce one winner and one retry) and passes the validator against the state
the list had.

The two join records are the exception, since a non-member can't know the
head: the relay accepts one without a previous id and appends it where it
lands. Clients accept a record without a previous id only for the two join
types and treat a join record whose id they have already seen as a
duplicate; ids are stable because every signature has one spelling and
Ed25519 signatures are deterministic, so a relay can't replay a declined
request as a new one. The relay accepts a join record only with a valid join
proof for a live invite, at most one pending per identity and invite, and at
most thirty-two pending per invite. Only members read the list; a requester
learns the outcome by asking `/v1/vaults/<id>/acl/<record id>` with a request
signed by the identity in the record, which answers pending, declined or
accepted, and once accepted they are a member and read the list.

Every client keeps the list it last validated for each team vault and
refuses one that doesn't extend it record for record, so a relay that serves
an older list, or splices records out from before a join record, can't hide
a removal or a rotation. A relay can still withhold new records; that is
not detected. Every change that takes write away (a removal, a demotion
from writer, a revoked no-approval invite) rotates the key, so a key id also
says which members could write at the time. A demotion from admin to writer
doesn't rotate: the person can still write, and clients take a members
document only from someone who manages the team now.

A relay refusing the list to an identity is its word, not the list's: the
app keeps the team and says the relay refuses it, until a list the device
validates leaves the identity out or the person leaves the team themselves.
The relay's answer that a join request was declined is taken as given; a
relay could deny the request anyway.

A team vault has no token. The relay authenticates every request to it by a
header `Authorization: Nod-Identity <identity> <time> <nonce> <signature>`:
the identity as base64url, the time in milliseconds since the epoch, a random
nonce, and the identity's signature under the relay prefix over the relay
host, the method, the path, the vault id, SHA-256 of the body, the time and
the nonce. The relay accepts a time within five minutes of its own, remembers
the nonces of writes and deletes for that window (a replayed read returns
only ciphertext its sender already holds), and checks the identity's role in
the list: readers
and writers read, writers write files under their own bound device folder,
and files are deleted only by the identity bound to their folder or, for a
folder whose identity has left the list, by an owner or admin. The relay
knows a vault's kind from how it was registered (token or root record) and
never mixes the two.

The relay refuses a file whose key id is not the list's current generation,
so nothing new is ever sealed under a retired key. For that it parses only
the fixed header of a version 2 file (the first 113 bytes) and nothing after
it.

The relay sees the identities in the list, the roles, the member count, the
device count and the file sizes and times, never a key, a name or a note.
The team's name and its members' display names live in a **members**
document written by owners and admins,
`{ schema: 1, team: string, names: { [identity]: string } }`, sealed and
published like a note at `devices/<blinded device>/members.bin`. A person an
owner or admin added by card learns where the team is from a **team link**,
`nod-team:v1:<vault id>:<relay host>`, which holds nothing secret: a person the list doesn't name gets nothing from
it.

### Invitations

An owner or admin makes an invite: a random Ed25519 signing keypair and a
random X25519 wrapping keypair, whose public halves go into an `invite`
record with the role it grants and whether joining needs approval. The
private halves go into an **invite file**, sealed with AES-256-GCM under a
random key that only the link holds, written with a signed request to
`/v1/vaults/<id>/invites/<file id>` and fetched from there by anyone without
one; the file id is the first 16 bytes of SHA-256 of the sealed file, as hex,
which nobody can guess since the file holds fresh random keys. The file holds
the team's name, the inviter's identity card, the vault id, the role, the
invite's private keys and, for an invite that needs no approval, the root
key wrapped under the invite's wrapping key with its generation id, copied
from the invite record, so the joiner needs nothing from a list they can't
read yet. The inviter's identity signs all of it under the invite prefix, so
a link can't name someone it doesn't come from, and the joiner refuses a
file whose hash isn't the file id the link names. The link is `nod-join:v1:<vault id>:<file id>:<file key,
base64url>:<relay host>`, the host last so a port in it can't be mistaken for
a field; the host
is validated like any relay address in 0001 (`https:`, a host and a short
plain path, nothing else). The relay keeps at most eight invite files per
vault, each for seven days; the invite record stays live until it is
revoked, and the app says so.

Someone opening the link fetches and opens the file, sees the team's name
and who invited them, and appends a `requestJoin`. The first list they read
once they are in must show that the identity the link named wrote the
invite record; otherwise the app leaves the team and says why. A
`requestJoin` carries their identity card, the
invite record's id, their identity signed with the invite signing key under
the join prefix as proof they hold the link, and the display name they chose,
sealed under the inviter's wrapping key so the relay never sees it. Owners
and admins see the request on their next sync round, in a dialog main draws
that shows the requester's identity code, and their name when this device is
the inviter's and can open it, and tells the approver to compare the code
with the person over another channel, since a leaked link lets anyone ask,
and to ask them their name where it can't be shown. Approving appends
`requestAccept` with the root key wrapped under the requester's wrapping key
and a role no higher than the invite's, and writes the name into the members
document.

An invite that needs no approval wraps the root key under the invite's
wrapping public key inside the `invite` record itself (and the invite file
carries a copy), so the joiner takes it directly and appends an `inviteJoin`
that re-wraps it under their own identity. The app warns that such a link
works like a key: anyone who ever saw it can join until it is revoked, and
anyone who has it and the team's files can read them without joining. Revoking such an invite rotates
the key, and every key rotation (a removal, a demotion, a revocation, a
`keyChange`) retires every no-approval invite, since the key its record
wraps is no longer the current one; so a removed member who kept a link can't
come back under a new identity.

Wrapping a key for a recipient is X25519 between a fresh ephemeral key and
the recipient's wrapping public key, HKDF-SHA256 of the shared secret (salt
`nod:vault`, info `wrap` followed by the ephemeral and the recipient public
keys, 32 bytes), then AES-256-GCM with an all-zero nonce, since the key is
used once, and
`nod:wrap:<vault id>:<record type>:<key id>:<recipient wrapping public key>`
as associated data, so a wrapped key can't be replayed into another vault,
record, generation or recipient; the ephemeral public key is stored beside
the ciphertext. The root record's wrap leaves the vault id empty, since the
vault's id is the root's hash and doesn't exist yet when it is wrapped.

### Removal and rotation

Removing a member is one `accountsRemove` record that also carries a **key
change**: a new random root key wrapped under each remaining member's
wrapping key and nobody else's, together with the old root key sealed under
the new one with `nod:keychain:<vault id>:<old key id>:<new key id>` as
associated data. Invites get no wrap: an approval invite's private keys sit
in a file anyone with the link opens, and the accept record wraps the key
for the person it lets in. A key change wrapping for anyone but the
remaining members is refused. The same key
change rides on a demotion that takes write away, on the revocation of a
no-approval invite, and on a `keyChange` of its own. A key generation's id is
16 random bytes the record that introduces it names (the root record names
the first), never used twice in one list; a hash of the record can't serve,
since the record's wraps and chain have to name the generation before the
record exists. A file says which generation sealed it, and a member who holds
the newest key opens every generation back to the first by following the
chain. A generation remembers everyone who could write while it was current,
and a file is opened when its publisher is in that set. A copy is taken only
from someone who can still write now: a removed or demoted writer who kept
an old key can't edit or delete anything after the fact, and what they wrote
before reaches everyone in the copies of the devices that still write, which
publish their own copy once theirs is the only one taken. A person added
later therefore reads the team's whole history, which is what a shared notebook is for. Keys that begin at joining
were rejected: every generation would have to be kept and wrapped forever,
and a note edited across a join would be half-readable.

The validator can check that a key change wraps something for every
remaining member, not what it wraps. A member whose wrap doesn't open, or
opens to a key whose chain doesn't lead back to the generation before (an
admin who wrapped a key of their own for one member), says so in the app,
names the admin who wrote the record, and never seals anything under a key
id it couldn't derive; an owner or admin who can open it repairs the list
with a `keyChange`. A member who joined after the generation before can't
check that, and would only notice that the others' files don't open.

After a rotation a device seals a file under the new key the next time that
file changes; files that haven't changed stay under their generation, since
the removed member already had them and the chain keeps them readable for
everyone else. The relay refuses new files under the
old key id from then on, so the removed member can't read later edits. What
they already received stays with them, as 0001 says of a lost device:
nothing can take that back. The app says so when a member is removed.

A member who leaves appends `requestRemove`, once; until an owner or admin
answers it with an `accountsRemove`, they are still a member and the key is
not rotated.

### Teams need a relay

A folder (0001) has no server to run the validator. A team kept there would
have no single list, so two devices appending at the same moment fork it,
and a removed member who keeps access to the folder can fork from before
their removal and win new devices over. Teams live on a relay only; a
person who syncs through a folder shares one to one through it, and makes or
joins teams through a relay.

### Shared notes

A shared note is an Automerge document of its own, published at
`devices/<blinded device>/notes/<note>.bin`:

```
{
  schema: 1,
  id: string,          // random, unrelated to the meeting's id
  title: string,       // whole value
  summary: string,     // text CRDT
  sharedAt: number,
  deletedAt: number | null
}
```

Sharing a meeting writes a new note from its title and summary into the
chosen vault under this device's blinded id. Shared notes are listed on
their own, by the person or team they are shared with, and the meeting
records where its notes went in a `sharedAs` map keyed by note id (`{ target,
sharedAt }`, the target being the peer's identity or the team vault's id), so
the app can show it and open the copy; two devices sharing one meeting at
once keep both entries. Documents from before the field read it as empty,
devices that predate it carry it along untouched, as 0001 has them do for
folders, and a meeting with no shares writes no such field, so an imported
meeting's first change stays what earlier versions wrote. From then on the
note is its own text: the
team edits it, and the person's private summary is not changed by that, nor
is the note changed by later edits to the private summary. Sharing again
makes another note. A mirror that followed both sides would have two
histories Automerge can't merge.

Every member with write permission publishes its own copy of a note it
holds, as devices do in 0001, and deletion is `deletedAt` and a tombstone
exactly as there: deletion wins over concurrent edits, and an older copy of
a note that someone replays can't undo it. So any writer can delete any note
in a team vault, and readers can delete nothing; the relay's check on a
`DELETE` of a file only keeps one member from removing another's copy from
the place.

### Cryptography

Everything new is from the same audited family as 0001, in
`packages/core/src/crypto`: Ed25519 and X25519 from `@noble/curves` (MIT, no
dependency beyond `@noble/hashes`, no install scripts, runs on Hermes, pinned
to an exact version like the other noble packages), HKDF, HMAC and SHA-256
from `@noble/hashes`, AES-256-GCM from `@noble/ciphers`. The app composes them
into the identity, the version 2 file, the key wrap and the one-to-one
derivation above and writes no primitive of its own. As in 0001, the
compatibility tests against `node:crypto` live in
`apps/desktop/src/main/security`, since core imports no Node module; what
`node:crypto` lacks is checked against fixed test vectors there.

## Consequences

- New dependency that ships in both apps: `@noble/curves`.
- `packages/core` gains `sharing` (identity cards, the access list and its
  validator, shared notes, the shares document). Both relays run the
  validator from `@nod/core/sharing`, bundled into them at build time: the
  plain relay stays one file that runs with `node` and nothing installed,
  built from the workspace rather than written by hand, and the Vercel one
  keeps its own package and deploy. The bundles are build output, made by
  one command and never committed; self-hosting builds the one file and
  runs it.
- A relay that hasn't been updated keeps serving every personal vault as
  before and every one-to-one vault, since those are token vaults on the same
  routes. The hosted relay refuses the `notes/` and `shares.bin` paths it
  doesn't know (the plain relay stores any safe path, so it needs no update
  for this), and neither has `/acl`. The app reads a refusal of the shares
  list as "this relay doesn't do sharing yet", shows it with the sync state,
  and keeps syncing meetings through it. Team vaults need an updated relay.
- Personal vaults stay on version 1. Signing a person's own files would buy
  nothing against a relay that already can't read them and would cost
  re-publishing every meeting.
- New formats, each with its migration path in core: sealed files version 2,
  the note, members and shares documents, the `sharedAs` field on meetings,
  the `notes/`, `shares.bin` and `members.bin` paths in the layout, and the relay
  routes `/acl`, `/acl/<record id>` and `/invites/`. Version 1 files and
  personal vaults are untouched.
- The sync engine and the sync settings hold several vaults instead of one.
  The relay's limit on new vaults per hour now counts a person's shared
  vaults too, and its limits gain members, pending requests and invite files
  per vault.
- The relay keeps more state per team vault (the list, device folder
  bindings, seen nonces, invite files) and does more work per request
  (signature checks, the validator).
- A person's identity follows their phrase: changing the phrase hands the
  teams the old identity manages to the new one, which then removes the old
  identity with a new key, asks to leave every other team, and ends every
  one-to-one share, which has to be made again (see Changing the phrase).
  Pairing a phone needs nothing new, since it gets the root key and the
  shares document.
- Nothing gives forward secrecy or recovery after a compromise for content:
  a stolen phrase opens every one-to-one vault and every team generation
  wrapped for that identity, back to each team's first. An owner who loses
  their phrase can't be removed; the team can only be made again.
- What a writer wrote and no device that still writes has taken is lost
  when that writer is removed or demoted: no copy is taken from them after
  that, and nothing tells the stale writer's last edit from one made after
  the fact.
- Readers have the key. Roles limit what the relay accepts, not what a member
  can copy; the app never suggests otherwise.
- A malicious admin can lock members out or split them onto different keys;
  the app makes a wrap that doesn't open, or doesn't lead back along the
  chain, visible to the member it was meant for rather than preventing it,
  since the relay can't read a wrap either. Managers also set display names,
  so a name proves nothing; dialogs show the identity code beside it.
- A relay can withhold new records of a list or serve different members
  different heads; clients detect a list that goes back, not one that stops
  growing. A join request's outcome (`/acl/<record id>`) is the relay's
  word until the list shows the record that answers it. The relay also sees each identity's devices and, through network
  addresses, can link blinded device ids across vaults.
- A link to an invite that needs no approval works like a key, and the app
  says so; the invite file on the relay lasts seven days, the invite record
  until it is revoked.
- The validator is a consensus rule: a record type an older client doesn't
  know stops it reading that team's list, so a new record type ships to
  every client and relay before anyone writes one.
- Membership is visible to the relay as identities. Someone who can read the
  relay's storage learns who shares with whom, not what.
- Showing and scanning identity cards, and approving join requests, are
  dialogs main draws on desktop. The phone reads and edits shared notes and
  syncs shared vaults; it shows no card, scans none and approves nothing.
- 0001's "Not covered yet" item (sharing a meeting with another person) is
  closed by this record, by another road than it expected.
- The work lands in two changes, each with its own review rounds: identity
  and the version 2 file in core together with one-to-one vaults and shared
  notes on desktop and mobile (the relay changes only its accepted paths);
  then team vaults on a relay (the list, the relay's routes and signed
  requests, members and roles in Settings, the join dialog).
- A browser viewer for a single note is outside this record. It would need
  Automerge in the browser and a per-note read token on the relay, and gets
  a record of its own if it is ever built.
