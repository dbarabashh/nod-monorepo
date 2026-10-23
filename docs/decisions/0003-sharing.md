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
**identity code** (the first 64 bits of SHA-256 of the signing public key,
grouped like the vault code) so two people can compare it aloud.

Everything the signing key signs (cards, access-list records, sealed files,
relay requests, join proofs) is one binary framing defined in core, with
fixed field order and length-prefixed fields, under a distinct prefix per use
(`nod:sig:card:v1`, `nod:sig:acl:v1`, `nod:sig:file:v2`, `nod:sig:relay:v1`,
`nod:sig:join:v1`), so a signature made for one purpose can't be presented as
another. A record's id is SHA-256 of the record with its signature.

### Changing the phrase

Changing the phrase (0001) changes the root key and so the identity, and the
reason to change it is that the old one may be in someone else's hands. So
the switch hands every share over to the new identity and leaves the old one
nothing:

- for each team, the old identity signs an `accountsAdd` of the new
  identity's card with its own role (a writer where it was an admin, since
  only owners make admins), an owner signs an `ownerChange` to the new
  identity as well, and the old identity signs a `requestRemove` for itself.
  These records are queued at the switch and delivered on the next round, so
  being offline never blocks the change (0001). A record needs the list's
  current head as its previous id, so the device keeps the old signing key,
  sealed as the root key is, for the one purpose of signing them again on
  top of whatever head it finds, and discards it once every team has them.
  Once they are in the list, the new identity removes the old one where it
  has the right; elsewhere the dialog says that an owner or admin finishes
  the removal;
- for each one-to-one vault, the device removes its own files from the vault,
  as 0001 does with the old personal vault, and the peer's app says the share
  ended when it sees them gone. One-to-one shares can't be revoked otherwise,
  so the two people exchange cards again under the new identity.

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
vault; it is also the id of the first key generation. The creator registers
the vault by posting the root record to `/v1/vaults/<id>/acl`; the relay
checks the hash and that the record is signed by the owner it names. Every
later record is appended there and accepted only when it carries the current
head as its previous id (compare-and-append, so two admins acting at once
produce one winner and one retry) and passes the validator against the state
the list had.

The two join records are the exception, since a non-member can't know the
head: the relay accepts one without a previous id and files it in a relay
envelope that names where it landed. Clients take such an envelope only for
the two join types, treat a join record whose id they have already seen as
a duplicate, and so a relay can neither replay a declined request nor move
one between forks. The relay accepts a join record only with a valid join
proof for a live invite, at most one pending per identity and invite, and at
most thirty-two pending per invite. Only members read the list; a requester
learns the outcome by asking `/v1/vaults/<id>/acl/<record id>` with a request
signed by the identity in the record, which answers pending, declined or
accepted, and once accepted they are a member and read the list.

Every client keeps the latest validated head it has seen for each team vault
and refuses a list that doesn't extend it, so a relay or folder that serves
an older list can't hide a removal or a rotation. Every change that takes a
right away (a removal, a demotion from writer, a revoked no-approval invite)
rotates the key, so a key id also says which members could write at the time
and a file sealed by someone who had lost the right is refused by the
generation check alone.

A team vault has no token. The relay authenticates every request to it by a
header `Authorization: Nod-Identity <identity> <time> <nonce> <signature>`:
the identity as base64url, the time in milliseconds since the epoch, a random
nonce, and the identity's signature under the relay prefix over the relay
host, the method, the path, the vault id, SHA-256 of the body, the time and
the nonce. The relay accepts a time within five minutes of its own, remembers
nonces for that window, and checks the identity's role in the list: readers
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
Members' display names live in a **members** document written by owners and
admins, `{ schema: 1, names: { [identity]: string } }`, sealed and published
like a note.

### Invitations

An owner or admin makes an invite: a random Ed25519 signing keypair and a
random X25519 wrapping keypair, whose public halves go into an `invite`
record with the role it grants and whether joining needs approval. The
private halves go into an **invite file**, sealed with AES-256-GCM under a
random key that only the link holds, written with a signed request to
`/v1/vaults/<id>/invites/<file id>` and fetched from there by anyone without
one; the file id is the first 16 bytes of SHA-256 of the sealed file, as hex,
which nobody can guess since the file holds fresh random keys. The file holds
the team's name, the inviter's identity card, the vault id and the invite's
private keys. The link is `nod-join:v1:<file id>:<file key, base64url>:<relay
host>`, the host last so a port in it can't be mistaken for a field; the host
is validated like any relay address in 0001 (`https:`, a host and a short
plain path, nothing else). The relay keeps at most eight invite files per
vault, each for seven days, and the app re-creates one when an invite is
shown again.

Someone opening the link fetches and opens the file, sees the team's name
and who invited them, and appends a `requestJoin`: their identity card, the
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
wrapping public key inside the `invite` record itself, so the joiner takes
it directly and appends an `inviteJoin` that re-wraps it under their own
identity. The app warns that anyone who ever saw that link can join until it
is revoked. Revoking such an invite rotates the key, and removing a member
retires every no-approval invite in the same record, so a removed member who
kept a link can't come back under a new identity.

Wrapping a key for a recipient is X25519 between a fresh ephemeral key and
the recipient's wrapping public key, HKDF-SHA256 of the shared secret (salt
`nod:vault`, info `wrap` followed by the ephemeral and the recipient public
keys, 32 bytes), then AES-256-GCM with an all-zero nonce, since the key is
used once, and
`nod:wrap:<vault id>:<record type>:<key id>:<recipient wrapping public key>`
as associated data, so a wrapped key can't be replayed into another record,
generation or recipient, and an invite is a recipient like any other; the
ephemeral public key is stored beside the ciphertext.

### Removal and rotation

Removing a member is one `accountsRemove` record that also carries a **key
change**: a new random root key wrapped under each remaining member's
wrapping key and under each still-active approval invite's wrapping key,
together with the old root key sealed under the new one with
`nod:keychain:<vault id>:<old key id>:<new key id>` as associated data. The
same key change rides on a demotion that takes write away, on the revocation
of a no-approval invite, and on a `keyChange` of its own. A key generation's
id is the first 16 bytes of SHA-256 of the record that introduced it (the
root record for the first), so a file says which generation sealed it, and a
member who holds the newest key opens every generation back to the first by
following the chain. A person added later therefore reads the team's whole
history, which is what a shared notebook is for. Keys that begin at joining
were rejected: every generation would have to be kept and wrapped forever,
and a note edited across a join would be half-readable.

The validator can check that a key change wraps something for every
remaining member, not what it wraps. A member whose wrap doesn't open, or
opens to a key that doesn't unseal the chain, says so in the app, names the
admin who wrote the record, and never seals anything under a key id it
couldn't derive; an owner or admin who can open it repairs the list with a
`keyChange`.

After a rotation a device seals a file under the new key the next time that
file changes; files that haven't changed stay under their generation, since
the removed member already had them and the chain keeps them readable for
everyone else. A removed member's earlier files stay readable the same way,
on the relay and on a folder alike. The relay refuses new files under the
old key id from then on, so the removed member can't read later edits. What
they already received stays with them, as 0001 says of a lost device:
nothing can take that back. The app says so when a member is removed.

A member who leaves appends `requestRemove`; until an owner or admin answers
it with an `accountsRemove`, they are still a member and the key is not
rotated.

### Team vaults on the folder transport

A folder (0001) has no server to run the validator, so a team vault there is
weaker and the app says so:

- the list lives at `devices/<blinded device>/acl.log`, written by the owner
  and only there, so an owner with two devices never has two writers on one
  file; clients take the longest valid chain among the owner's folders, and
  an owner device that finds another of its folders ahead signs its own
  unapplied records again on top of that chain, as devices do after a
  refused append on the relay. Admins can't act on a folder;
- joining by link is impossible, since an outsider can't read the folder;
  the owner adds people by identity card (`accountsAdd`);
- every client validates signatures, roles and key ids itself and ignores
  files that fail, so a reader who writes a file is ignored, not stopped;
- a removed member still holds the old key, so a file under an older
  generation from an identity that no longer has write permission is read
  only at a version this device already held before the rotation; a newer one is
  ignored, and an ignored file counts as absent when a device decides
  whether the vault lacks a note's version;
- whoever the folder service still lets in can delete files. Removing a
  person from the team does not remove them from the folder; the folder
  service's own sharing is the real gate, and Nod can only stop handing them
  new keys.

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
their own, by the person they are shared with; the meeting itself records
nothing about it in this record's first change. A `sharedAs` field on the
meeting, so the app can show where a meeting went and open the shared copy,
comes with the team vault change, with its migration (documents from before
it read it as empty, and devices that predate it carry it along untouched,
as 0001 has them do for folders). From then on the note is its own text: the
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
  keeps its own package and deploy. The repository ships the built relay, so
  self-hosting changes only in which file is run.
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
  the `notes/`, `shares.bin` and `acl.log` paths in the layout, and the relay
  routes `/acl`, `/acl/<record id>` and `/invites/`. Version 1 files and
  personal vaults are untouched.
- The sync engine and the sync settings hold several vaults instead of one.
  The relay's limit on new vaults per hour now counts a person's shared
  vaults too, and its limits gain members, pending requests and invite files
  per vault.
- The relay keeps more state per team vault (the list, device folder
  bindings, seen nonces, invite files) and does more work per request
  (signature checks, the validator).
- A person's identity follows their phrase: changing the phrase hands every
  team over to the new identity and ends every one-to-one share, which has
  to be made again. Pairing a phone needs nothing new, since it gets the
  root key and the shares document.
- Readers have the key. Roles limit what the relay accepts, not what a member
  can copy; the app never suggests otherwise.
- A malicious admin can lock members out or split them onto different keys;
  the app makes that visible rather than preventing it, since the relay can't
  read a wrap either.
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
  then team vaults (the list, the relay's routes and signed requests, members
  and roles in Settings, the join dialog, the folder transport's reduced
  form).
- A browser viewer for a single note is outside this record. It would need
  Automerge in the browser and a per-note read token on the relay, and gets
  a record of its own if it is ever built.
