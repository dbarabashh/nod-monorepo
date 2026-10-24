import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  blindedDeviceId,
  fileKeyOf,
  fromHex,
  identityCard,
  identityCodeOf,
  identityHex,
  identityOf,
  randomKey,
  sealSigned,
  vaultIdOf,
} from '../crypto/index.ts';
import {
  memoryReceivedLog,
  type PublishedEntry,
  type PublishedLog,
} from '../sync/engine.ts';
import { noteContext, notePath } from '../sync/layout.ts';
import {
  setSummary,
  startMeeting,
  type MeetingFiles,
} from '../meetings/index.ts';
import { memoryFiles, plainCipher } from '../meetings/testing/index.ts';
import {
  createSharingSession,
  type TeamInfo,
  type TeamRelays,
} from './session.ts';
import type { SingleFile } from './single-document-store.ts';
import { extendsKnown, signRecord } from './access-list.ts';
import {
  joinLink,
  openInviteFile,
  parseJoinLink,
  sealInviteFile,
  signInviteFile,
  teamLink,
} from './invite.ts';
import { noteTombstone, saveNoteDocument } from './note-document.ts';
import { recoverTeamKeys } from './team-keys.ts';
import { createMemoryTeamRelay } from './testing/index.ts';

function memoryFile(): SingleFile {
  let data: Uint8Array | null = null;
  return {
    read: async () => data,
    write: async (next) => {
      data = next;
    },
    setAside: async () => {
      data = null;
    },
  };
}

type TeamFileMap = Map<
  string,
  { notes: MeetingFiles; members: SingleFile; list: SingleFile }
>;

// A device's files: another identity on the same device (after a change of
// phrase), or the same one after a restart, finds what it kept on disk.
type Device = {
  teamFiles: TeamFileMap;
  sharesData: Map<string, Uint8Array>;
  logs: Map<string, PublishedLog>;
};

function newDevice(): Device {
  return { teamFiles: new Map(), sharesData: new Map(), logs: new Map() };
}

function memoryLog(): PublishedLog {
  const entries = new Map<string, PublishedEntry>();
  return {
    get: (id) => entries.get(id),
    set: (id, entry) => {
      entries.set(id, entry);
    },
    received: memoryReceivedLog(),
  };
}
function person(
  deviceId: string,
  relays: TeamRelays,
  rootKey = randomKey(),
  device: Device = newDevice(),
) {
  const { teamFiles, sharesData, logs } = device;
  const noteFiles = new Map<string, MeetingFiles>();
  let changes = 0;
  const session = createSharingSession({
    sharesFileFor: (vaultId) => ({
      read: async () => sharesData.get(vaultId) ?? null,
      write: async (data) => {
        sharesData.set(vaultId, data);
      },
      setAside: async () => {
        sharesData.delete(vaultId);
      },
    }),
    noteFilesFor: (vaultId) => {
      const files = noteFiles.get(vaultId) ?? memoryFiles();
      noteFiles.set(vaultId, files);
      return files;
    },
    teamFilesFor: (vaultId) => {
      const files = teamFiles.get(vaultId) ?? {
        notes: memoryFiles(),
        members: memoryFile(),
        list: memoryFile(),
      };
      teamFiles.set(vaultId, files);
      return files;
    },
    relays,
    // What was published and received survives a restart, as on disk.
    publishedLogFor: async (scope) => {
      const log = logs.get(scope) ?? memoryLog();
      logs.set(scope, log);
      return log;
    },
    cipher: async () => plainCipher,
    newId: () => `note-${deviceId}-${++changes}`,
    now: () => 1_000 + ++changes,
    onChange: () => {},
  });
  const identity = identityOf(rootKey);
  return {
    session,
    rootKey,
    deviceId,
    identity,
    card: identityCard(identity),
    code: identityCodeOf(identity.publicKey),
    load: () => session.load({ key: rootKey, deviceId }),
    device,
  };
}

function teamsOf(session: ReturnType<typeof person>['session']): TeamInfo[] {
  const snapshot = session.snapshot();
  assert.equal(snapshot.status, 'ready');
  return snapshot.status === 'ready' ? snapshot.teams : [];
}

const meeting = setSummary(
  startMeeting('m-1', 'Planning', 1_000),
  'We plan to ship teams.',
);

describe('teams on a relay', () => {
  it('lets a person ask to join by link, and an owner accept them with their name', async () => {
    const relay = createMemoryTeamRelay();
    const owner = person('laptop', relay.relays);
    const sam = person('phone', relay.relays);
    await owner.load();
    await sam.load();

    const vaultId = await owner.session.createTeam(
      'Roadmap',
      'Olga',
      relay.host,
    );
    assert.match(vaultId, /^[0-9a-f]{32}$/);
    let [team] = teamsOf(owner.session);
    assert.equal(team?.name, 'Roadmap');
    assert.equal(team?.role, 'owner');
    assert.equal(team?.members[0]?.name, 'Olga');

    const link = await owner.session.inviteToTeam(vaultId, 'writer', true);
    assert.match(link, /^nod-join:v1:/);
    const preview = await sam.session.previewJoin(link);
    assert.equal(preview.team, 'Roadmap');
    assert.equal(preview.inviterCode, owner.code);
    assert.equal(preview.role, 'writer');
    assert.equal(preview.approval, true);

    const asked = await sam.session.join(link, 'Sam');
    assert.equal(asked.pending, true);
    assert.equal(teamsOf(sam.session)[0]?.pending, true);
    await assert.rejects(sam.session.join(link, 'Sam'), /already/);
    await assert.rejects(
      sam.session.shareMeeting(meeting, 'Planning', vaultId),
      /hasn’t been answered/,
    );

    await owner.session.round(null);
    [team] = teamsOf(owner.session);
    assert.equal(team?.requests.length, 1);
    assert.equal(team?.requests[0]?.code, sam.code);
    assert.equal(team?.requests[0]?.name, 'Sam');
    const requestId = team?.requests[0]?.id ?? '';
    await owner.session.answerRequest(vaultId, requestId, {
      accept: true,
      role: 'writer',
    });
    [team] = teamsOf(owner.session);
    assert.equal(team?.requests.length, 0);
    assert.deepEqual(
      team?.members.map((member) => [member.name, member.role]).sort(),
      [
        ['Olga', 'owner'],
        ['Sam', 'writer'],
      ],
    );

    // The next round turns Sam's request into membership, and the names
    // arrive with the owner's member document.
    await sam.session.round(null);
    await sam.session.round(null);
    const [joined] = teamsOf(sam.session);
    assert.equal(joined?.pending, false);
    assert.equal(joined?.role, 'writer');
    assert.equal(joined?.name, 'Roadmap');
    assert.equal(joined?.members.length, 2);
    assert.equal(joined?.error, null);
    assert.deepEqual(joined?.invites, []);

    const shared = await owner.session.shareMeeting(
      meeting,
      'Planning',
      vaultId,
    );
    assert.equal(shared.label, 'Roadmap');
    await owner.session.round(null);
    await sam.session.round(null);
    const seen = sam.session.snapshot();
    assert.equal(seen.status, 'ready');
    assert.deepEqual(
      seen.notes.map((note) => [note.title, note.target, note.label]),
      [['Planning', vaultId, 'Roadmap']],
    );
    await sam.session.editNote(
      vaultId,
      shared.id,
      'We plan to ship teams, then polish.',
    );
    await sam.session.round(null);
    await owner.session.round(null);
    assert.equal(
      (await owner.session.note(vaultId, shared.id)).summary,
      'We plan to ship teams, then polish.',
    );
    assert.equal(
      relay
        .files(vaultId)
        .paths()
        .filter((path) => path.includes('/notes/')).length,
      2,
    );
  });

  it('joins at once through a no-approval invite, and a removal shuts the person out', async () => {
    const relay = createMemoryTeamRelay();
    const owner = person('laptop', relay.relays);
    const sam = person('phone', relay.relays);
    await owner.load();
    await sam.load();
    const vaultId = await owner.session.createTeam(
      'Roadmap',
      'Olga',
      relay.host,
    );
    const link = await owner.session.inviteToTeam(vaultId, 'reader', false);
    const joined = await sam.session.join(link, 'Sam');
    assert.equal(joined.pending, false);
    await sam.session.round(null);
    assert.equal(teamsOf(sam.session)[0]?.role, 'reader');
    await assert.rejects(
      sam.session.shareMeeting(meeting, 'Planning', vaultId),
      /Readers can’t/,
    );

    const shared = await owner.session.shareMeeting(
      meeting,
      'Planning',
      vaultId,
    );
    await owner.session.round(null);
    await sam.session.round(null);
    assert.equal(
      (await sam.session.note(vaultId, shared.id)).title,
      'Planning',
    );
    // The owner's next round names Sam from the join record.
    assert.equal(
      teamsOf(owner.session)[0]?.members.find(
        (member) => member.code === sam.code,
      )?.name,
      'Sam',
    );
    assert.equal(teamsOf(owner.session)[0]?.invites.length, 1);

    await owner.session.removeMembers(vaultId, [
      teamsOf(owner.session)[0]?.members.find(
        (member) => member.code === sam.code,
      )?.identity ?? '',
    ]);
    const after = relay.state(vaultId);
    assert.equal(after?.generations.length, 2);
    assert.equal(Object.keys(after?.members ?? {}).length, 1);
    // Removing retires the no-approval invite with the key.
    assert.deepEqual(teamsOf(owner.session)[0]?.invites, []);
    await owner.session.editNote(vaultId, shared.id, 'Edited after removal.');
    await owner.session.round(null);
    assert.equal(
      (await owner.session.note(vaultId, shared.id)).summary,
      'Edited after removal.',
    );
    // The relay now refuses Sam the list. That is its word, not the list's,
    // so Sam's device keeps the team and says so rather than leaving it.
    await sam.session.round(null);
    const refused = sam.session.snapshot();
    assert.equal(refused.status, 'ready');
    assert.equal(refused.teams.length, 1);
    assert.match(refused.teams[0]?.error ?? '', /no longer lets you read/);
  });

  it('lets a member leave, and keeps the owner from leaving a team with others in it', async () => {
    const relay = createMemoryTeamRelay();
    const owner = person('laptop', relay.relays);
    const sam = person('phone', relay.relays);
    await owner.load();
    await sam.load();
    const vaultId = await owner.session.createTeam(
      'Roadmap',
      'Olga',
      relay.host,
    );
    await owner.session.addTeamMembers(vaultId, [
      { card: sam.card, role: 'admin', name: 'Sam' },
    ]);
    await sam.session.addKnownTeam(teamLink({ vaultId, host: relay.host }));
    await sam.session.round(null);
    assert.equal(teamsOf(sam.session)[0]?.role, 'admin');
    await assert.rejects(owner.session.leaveTeam(vaultId), /Hand the team/);
    await owner.session.shareMeeting(meeting, 'Planning', vaultId);
    await owner.session.round(null);
    await sam.session.round(null);
    await sam.session.shareMeeting(meeting, 'Sam’s notes', vaultId);
    await sam.session.round(null);
    await sam.session.leaveTeam(vaultId);
    assert.deepEqual(teamsOf(sam.session), []);
    await owner.session.round(null);
    const [team] = teamsOf(owner.session);
    assert.equal(
      team?.members.find((member) => member.code === sam.code)?.leaving,
      true,
    );
    assert.equal(
      relay
        .files(vaultId)
        .paths()
        .filter((path) => path.includes('/notes/')).length,
      1,
      'Sam’s copies left the vault',
    );
    await owner.session.transferTeam(
      vaultId,
      team?.members.find((member) => member.code === sam.code)?.identity ?? '',
      'writer',
    );
    assert.equal(teamsOf(owner.session)[0]?.role, 'writer');
  });
});

describe('an invite naming someone it doesn’t come from', () => {
  it('leaves the team once the list shows another identity wrote the invite', async () => {
    const relay = createMemoryTeamRelay();
    const owner = person('laptop', relay.relays);
    const alice = person('tablet', relay.relays);
    const sam = person('phone', relay.relays);
    await owner.load();
    await sam.load();
    const vaultId = await owner.session.createTeam(
      'Roadmap',
      'Olga',
      relay.host,
    );
    const link = parseJoinLink(
      await owner.session.inviteToTeam(vaultId, 'reader', false),
    );
    assert.ok(link);
    const sealed = await relay.relays.fetchInvite(link);
    assert.ok(sealed);
    const real = openInviteFile(sealed, link.key);
    assert.ok(real);
    // Alice, who isn't in the team, re-signs the owner's invite as her own,
    // so the link shows her code, which Sam checks with her.
    const { signature: _owners, ...unsigned } = real;
    const forged = sealInviteFile(
      signInviteFile(alice.identity, { ...unsigned, inviter: alice.card }),
    );
    await relay
      .open(vaultId, owner.identity)
      .putInvite(forged.fileId, forged.sealed);
    const preview = await sam.session.previewJoin(
      joinLink({ ...link, fileId: forged.fileId, key: forged.key }),
    );
    assert.equal(preview.inviterCode, alice.code);
    await assert.rejects(
      sam.session.join(
        joinLink({ ...link, fileId: forged.fileId, key: forged.key }),
        'Sam',
      ),
      /wasn’t made by the person the link named/,
    );
    const after = sam.session.snapshot();
    assert.equal(after.status, 'ready');
    assert.deepEqual(after.teams, []);
  });

  it('refuses a file that isn’t the one the link’s id names', async () => {
    const relay = createMemoryTeamRelay();
    const owner = person('laptop', relay.relays);
    await owner.load();
    const vaultId = await owner.session.createTeam(
      'Roadmap',
      'Olga',
      relay.host,
    );
    const link = parseJoinLink(
      await owner.session.inviteToTeam(vaultId, 'reader', true),
    );
    assert.ok(link);
    const sealed = await relay.relays.fetchInvite(link);
    assert.ok(sealed);
    // A place that answers every id with this one file: the key opens it,
    // but it isn't what the link names.
    const swapping: TeamRelays = {
      ...relay.relays,
      fetchInvite: async () => sealed,
    };
    const sam = person('phone', swapping);
    await sam.load();
    assert.equal(
      (await sam.session.previewJoin(joinLink(link))).role,
      'reader',
    );
    await assert.rejects(
      sam.session.previewJoin(joinLink({ ...link, fileId: 'ab'.repeat(16) })),
      /could not be read/,
    );
  });
});

describe('a writer who was removed', () => {
  it('can’t change notes under the key they kept, and what they wrote before stays', async () => {
    const relay = createMemoryTeamRelay();
    const owner = person('laptop', relay.relays);
    const sam = person('phone', relay.relays);
    await owner.load();
    await sam.load();
    const vaultId = await owner.session.createTeam(
      'Roadmap',
      'Olga',
      relay.host,
    );
    await owner.session.addTeamMembers(vaultId, [
      { card: sam.card, role: 'writer', name: 'Sam' },
    ]);
    await sam.session.addKnownTeam(teamLink({ vaultId, host: relay.host }));
    await sam.session.round(null);
    const samNote = await sam.session.shareMeeting(
      meeting,
      'From Sam',
      vaultId,
    );
    const ownerNote = await owner.session.shareMeeting(
      meeting,
      'Planning',
      vaultId,
    );
    await sam.session.round(null);
    await owner.session.round(null);
    const before = relay.state(vaultId);
    assert.ok(before);
    const samKey = recoverTeamKeys(before, sam.identity).current;
    assert.ok(samKey);
    await owner.session.removeMembers(vaultId, [
      identityHex(sam.identity.publicKey),
    ]);
    // Sam slips a deletion of the owner's note under the old key into the
    // place, past a relay that would refuse it.
    const samDevice = blindedDeviceId(sam.identity, vaultId, 'phone');
    await relay
      .files(vaultId)
      .write(
        notePath(samDevice, ownerNote.id),
        sealSigned(
          fileKeyOf(samKey.rootKey),
          fromHex(samKey.keyId),
          sam.identity,
          saveNoteDocument(noteTombstone(ownerNote.id, 5)),
          noteContext(vaultId, samDevice, ownerNote.id),
        ),
      );
    await owner.session.round(null);
    assert.equal(
      (await owner.session.note(vaultId, ownerNote.id)).title,
      'Planning',
    );
    // Sam's earlier note stays, and goes on in the owner's own copy.
    assert.equal(
      (await owner.session.note(vaultId, samNote.id)).title,
      'From Sam',
    );
    const ownerDevice = blindedDeviceId(owner.identity, vaultId, 'laptop');
    assert.ok(
      relay.files(vaultId).paths().includes(notePath(ownerDevice, samNote.id)),
    );
  });
});

describe('a removal learned at startup', () => {
  it('still judges again what was received, so the device publishes its own copy', async () => {
    const relay = createMemoryTeamRelay();
    const laptop = person('laptop', relay.relays);
    const sam = person('phone', relay.relays);
    await laptop.load();
    await sam.load();
    const vaultId = await laptop.session.createTeam(
      'Roadmap',
      'Olga',
      relay.host,
    );
    await laptop.session.addTeamMembers(vaultId, [
      { card: sam.card, role: 'writer', name: 'Sam' },
    ]);
    await sam.session.addKnownTeam(teamLink({ vaultId, host: relay.host }));
    await sam.session.round(null);
    const samNote = await sam.session.shareMeeting(
      meeting,
      'From Sam',
      vaultId,
    );
    await sam.session.round(null);
    await laptop.session.round(null);
    assert.equal(
      (await laptop.session.note(vaultId, samNote.id)).title,
      'From Sam',
    );

    // While the laptop is closed, the owner's other device removes Sam.
    const tablet = person('tablet', relay.relays, laptop.rootKey);
    await tablet.load();
    await tablet.session.addKnownTeam(teamLink({ vaultId, host: relay.host }));
    await tablet.session.removeMembers(vaultId, [
      identityHex(sam.identity.publicKey),
    ]);

    const restarted = person(
      'laptop',
      relay.relays,
      laptop.rootKey,
      laptop.device,
    );
    await restarted.load();
    await restarted.session.round(null);
    await restarted.session.round(null);
    const laptopDevice = blindedDeviceId(laptop.identity, vaultId, 'laptop');
    assert.ok(
      relay.files(vaultId).paths().includes(notePath(laptopDevice, samNote.id)),
      'the laptop publishes its own copy of what only Sam held',
    );
  });
});

describe('a change of phrase', () => {
  it('hands the teams an owner or admin manages to the new identity, and only leaves the rest', async () => {
    const relay = createMemoryTeamRelay();
    const owner = person('laptop', relay.relays);
    const sam = person('phone', relay.relays);
    await owner.load();
    await sam.load();
    const fresh = person('laptop', relay.relays, randomKey(), owner.device);
    const owned = await owner.session.createTeam('Owned', 'Olga', relay.host);
    const theirs = await sam.session.createTeam('Theirs', 'Sam', relay.host);
    await sam.session.addTeamMembers(theirs, [
      { card: owner.card, role: 'reader', name: 'Olga' },
    ]);
    await owner.session.addKnownTeam(
      teamLink({ vaultId: theirs, host: relay.host }),
    );
    await owner.session.round(null);

    const oldHex = identityHex(owner.identity.publicKey);
    const freshHex = identityHex(fresh.identity.publicKey);
    const handed = await owner.session.endIdentity(null, {
      card: fresh.card,
      vaultId: vaultIdOf(fresh.rootKey),
    });
    assert.deepEqual(handed, {
      handed: [
        {
          link: `nod-team:v1:${owned}:${relay.host}`,
          replaces: oldHex,
        },
      ],
      unfinished: [],
    });
    assert.deepEqual(teamsOf(owner.session), []);
    const ownedState = relay.state(owned);
    assert.equal(ownedState?.owner, freshHex);
    assert.equal(ownedState?.members[oldHex]?.role, 'writer');
    // A team the old identity only read in it asks to leave.
    assert.equal(relay.state(theirs)?.members[oldHex]?.leaving, true);

    // The successor takes the team up and removes the old identity, with a
    // new key, so the old phrase opens nothing written from then on.
    // The device's own shares list for the new phrase already names the
    // team, so loading it is all the successor needs.
    await fresh.load();
    await fresh.session.round(null);
    const after = relay.state(owned);
    assert.equal(after?.members[oldHex], undefined);
    assert.equal(after?.generations.length, 2);
    const [team] = teamsOf(fresh.session);
    assert.equal(team?.role, 'owner');
    assert.equal(team?.name, 'Owned');
    assert.equal(team?.error, null);
    assert.equal(
      team?.members.find((member) => member.identity === freshHex)?.name,
      'Olga',
    );
    // Taken up once: a second round removes nobody again.
    await fresh.session.round(null);
    assert.equal(relay.state(owned)?.generations.length, 2);
  });

  it('refuses what waited behind the end of an identity, until another is loaded', async () => {
    const relay = createMemoryTeamRelay();
    const owner = person('laptop', relay.relays);
    await owner.load();
    const fresh = person('laptop', relay.relays, randomKey(), owner.device);
    const ending = owner.session.endIdentity(null, {
      card: fresh.card,
      vaultId: vaultIdOf(fresh.rootKey),
    });
    const waiting = owner.session.createTeam('Late', 'Olga', relay.host);
    await ending;
    await assert.rejects(waiting, /moving to the new phrase/);
    assert.throws(
      () => owner.session.identityCard(),
      /moving to the new phrase/,
    );
    await owner.load();
    assert.deepEqual(teamsOf(owner.session), []);
    await owner.session.createTeam('Later', 'Olga', relay.host);
  });

  it('leaves a device without touching the identity’s shares', async () => {
    const relay = createMemoryTeamRelay();
    const owner = person('laptop', relay.relays);
    await owner.load();
    const vaultId = await owner.session.createTeam('Owned', 'Olga', relay.host);
    await owner.session.shareMeeting(meeting, 'Planning', vaultId);
    await owner.session.round(null);
    assert.equal(relay.files(vaultId).paths().length, 2);
    await owner.session.leaveDevice(null);
    // The device's copies are gone; the identity is still the owner, and
    // its shares list still names the team for its other devices.
    assert.equal(relay.files(vaultId).paths().length, 0);
    assert.equal(
      relay.state(vaultId)?.members[identityHex(owner.identity.publicKey)]
        ?.leaving,
      false,
    );
    await owner.load();
    assert.equal(teamsOf(owner.session).length, 1);
  });
});

describe('a change of phrase that stops part way', () => {
  it('keeps the team on both sides once the successor was added, and finishes when run again', async () => {
    const relay = createMemoryTeamRelay();
    let down = true;
    // The relay takes everything but the hand-over of ownership, for now.
    const failing: TeamRelays = {
      ...relay.relays,
      open: async (host, vaultId, identity) => {
        const place = await relay.relays.open(host, vaultId, identity);
        return {
          ...place,
          list: {
            ...place.list,
            append: async (record) => {
              if (record.body.type === 'ownerChange' && down) {
                throw new Error('The relay can’t be reached');
              }
              await place.list.append(record);
            },
          },
        };
      },
    };
    const owner = person('laptop', failing);
    await owner.load();
    const fresh = person('laptop', failing, randomKey(), owner.device);
    const vaultId = await owner.session.createTeam('Owned', 'Olga', relay.host);
    const successor = { card: fresh.card, vaultId: vaultIdOf(fresh.rootKey) };
    const ended = await owner.session.endIdentity(null, successor);
    assert.equal(ended.handed.length, 1);
    assert.deepEqual(ended.unfinished, ['Owned']);
    const snapshot = owner.session.snapshot();
    assert.equal(snapshot.status, 'ready');
    assert.match(snapshot.error ?? '', /only in part/);
    const state = relay.state(vaultId);
    assert.equal(state?.owner, identityHex(owner.identity.publicKey));
    assert.equal(
      state?.members[identityHex(fresh.identity.publicKey)]?.role,
      'admin',
    );
    await fresh.load();
    assert.equal(teamsOf(fresh.session)[0]?.vaultId, vaultId);

    // The old identity's list still names the team, so ending it again
    // after a restart hands ownership over.
    down = false;
    const restarted = person('laptop', failing, owner.rootKey, owner.device);
    await restarted.load();
    assert.deepEqual(
      teamsOf(restarted.session).map((team) => team.vaultId),
      [vaultId],
    );
    const again = await restarted.session.endIdentity(null, successor);
    assert.deepEqual(again.unfinished, []);
    assert.equal(
      relay.state(vaultId)?.owner,
      identityHex(fresh.identity.publicKey),
    );
  });

  it('keeps a team it couldn’t reach in the old identity’s list, and the successor out of it', async () => {
    const relay = createMemoryTeamRelay();
    let down = false;
    const flaky: TeamRelays = {
      ...relay.relays,
      open: async (host, vaultId, identity) => {
        const place = await relay.relays.open(host, vaultId, identity);
        return {
          ...place,
          list: {
            ...place.list,
            read: async () => {
              if (down) {
                throw new Error('The relay can’t be reached');
              }
              return place.list.read();
            },
          },
        };
      },
    };
    const owner = person('laptop', flaky);
    await owner.load();
    const fresh = person('laptop', relay.relays, randomKey(), owner.device);
    const vaultId = await owner.session.createTeam('Owned', 'Olga', relay.host);
    down = true;
    const ended = await owner.session.endIdentity(null, {
      card: fresh.card,
      vaultId: vaultIdOf(fresh.rootKey),
    });
    assert.deepEqual(ended, { handed: [], unfinished: ['Owned'] });
    assert.equal(
      relay.state(vaultId)?.owner,
      identityHex(owner.identity.publicKey),
    );
    const restarted = person('laptop', flaky, owner.rootKey, owner.device);
    await restarted.load();
    assert.deepEqual(
      teamsOf(restarted.session).map((team) => team.vaultId),
      [vaultId],
    );
    await fresh.load();
    assert.deepEqual(teamsOf(fresh.session), []);
  });

  it('counts as out of reach a team this device last saw it not manage', async () => {
    const relay = createMemoryTeamRelay();
    let down = false;
    const flaky: TeamRelays = {
      ...relay.relays,
      open: async (host, vaultId, identity) => {
        const place = await relay.relays.open(host, vaultId, identity);
        return {
          ...place,
          list: {
            ...place.list,
            read: async () => {
              if (down) {
                throw new Error('The relay can’t be reached');
              }
              return place.list.read();
            },
          },
        };
      },
    };
    const sam = person('phone', relay.relays);
    const reader = person('laptop', flaky);
    await sam.load();
    await reader.load();
    const vaultId = await sam.session.createTeam('Theirs', 'Sam', relay.host);
    await sam.session.addTeamMembers(vaultId, [
      { card: reader.card, role: 'reader', name: 'Olga' },
    ]);
    await reader.session.addKnownTeam(teamLink({ vaultId, host: relay.host }));
    await reader.session.round(null);
    assert.equal(teamsOf(reader.session)[0]?.role, 'reader');
    down = true;
    assert.equal((await reader.session.unreachableTeams()).length, 1);
  });

  it('refuses to end an identity whose shares list didn’t open', async () => {
    const relay = createMemoryTeamRelay();
    class Unreadable extends Map<string, Uint8Array> {
      override get(): never {
        throw new Error('The keychain is locked');
      }
    }
    const owner = person('laptop', relay.relays, randomKey(), {
      ...newDevice(),
      sharesData: new Unreadable(),
    });
    assert.equal(await owner.load(), false);
    await assert.rejects(
      owner.session.endIdentity(null, { card: owner.card, vaultId: 'x' }),
      /shares couldn’t be read/,
    );
  });

  for (const moved of [false, true]) {
    it(`finishes a hand-over a crash cut short ${moved ? 'after' : 'before'} ownership moved, adding the successor only once`, async () => {
      const relay = createMemoryTeamRelay();
      let crashed = false;
      // The app dies while ownership is being handed over: the call never
      // returns, and nothing after it runs.
      const crashing: TeamRelays = {
        ...relay.relays,
        open: async (host, vaultId, identity) => {
          const place = await relay.relays.open(host, vaultId, identity);
          return {
            ...place,
            list: {
              ...place.list,
              append: async (record) => {
                if (record.body.type === 'ownerChange' && !crashed) {
                  crashed = true;
                  if (moved) {
                    await place.list.append(record);
                  }
                  return new Promise<void>(() => {});
                }
                await place.list.append(record);
              },
            },
          };
        },
      };
      const owner = person('laptop', crashing);
      await owner.load();
      const fresh = person('laptop', relay.relays, randomKey(), owner.device);
      const vaultId = await owner.session.createTeam(
        'Owned',
        'Olga',
        relay.host,
      );
      const successor = {
        card: fresh.card,
        vaultId: vaultIdOf(fresh.rootKey),
      };
      void owner.session.endIdentity(null, successor);
      while (!crashed) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      const restarted = person(
        'laptop',
        relay.relays,
        owner.rootKey,
        owner.device,
      );
      await restarted.load();
      const handed = await restarted.session.endIdentity(null, successor);

      assert.deepEqual(handed.unfinished, []);
      assert.equal(handed.handed.length, 1);
      const snapshot = restarted.session.snapshot();
      assert.equal(snapshot.status === 'ready' && snapshot.error, null);
      const oldHex = identityHex(owner.identity.publicKey);
      const freshHex = identityHex(fresh.identity.publicKey);
      const state = relay.state(vaultId);
      assert.equal(state?.owner, freshHex);
      assert.equal(state?.members[oldHex]?.role, 'writer');
      await fresh.load();
      await fresh.session.round(null);
      assert.equal(relay.state(vaultId)?.members[oldHex], undefined);
      assert.equal(teamsOf(fresh.session)[0]?.role, 'owner');
    });
  }

  it('has an admin’s old identity ask to leave once its successor is in', async () => {
    const relay = createMemoryTeamRelay();
    const sam = person('phone', relay.relays);
    const admin = person('laptop', relay.relays);
    await sam.load();
    await admin.load();
    const fresh = person('laptop', relay.relays, randomKey(), admin.device);
    const vaultId = await sam.session.createTeam('Theirs', 'Sam', relay.host);
    await sam.session.addTeamMembers(vaultId, [
      { card: admin.card, role: 'admin', name: 'Olga' },
    ]);
    await admin.session.addKnownTeam(teamLink({ vaultId, host: relay.host }));
    await admin.session.round(null);
    await admin.session.endIdentity(null, {
      card: fresh.card,
      vaultId: vaultIdOf(fresh.rootKey),
    });
    const state = relay.state(vaultId);
    assert.equal(
      state?.members[identityHex(admin.identity.publicKey)]?.leaving,
      true,
    );
    assert.equal(
      state?.members[identityHex(fresh.identity.publicKey)]?.role,
      'writer',
    );
    await fresh.load();
    await fresh.session.round(null);
    assert.match(
      teamsOf(fresh.session)[0]?.error ?? '',
      /ask its owner to remove it/,
    );
  });
});

describe('a list that extends the known one', () => {
  it('is the known records, in order, with more on top; a splice is not', () => {
    const me = identityOf(randomKey());
    const [a, b, c, d] = [1, 2, 3, 4].map((at) =>
      signRecord(me, null, at, { type: 'requestRemove' }),
    );
    assert.ok(a && b && c && d);
    assert.equal(extendsKnown([], [a]), true);
    assert.equal(extendsKnown([a, b], [a, b]), true);
    assert.equal(extendsKnown([a, b], [a, b, c]), true);
    assert.equal(extendsKnown([a, b], [a]), false);
    assert.equal(extendsKnown([a, b, c], [a, c, d]), false);
    assert.equal(extendsKnown([a, b], [b, a]), false);
  });
});
