// SPDX-FileCopyrightText: 2026 Dima Barabash
// SPDX-License-Identifier: AGPL-3.0-only

import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  identityCard,
  relayRequestWindowMs,
  relayToken,
  signRelayRequest,
  vaultIdOf,
  type Identity,
} from '@nod/core/crypto';
import {
  createTeamRelay,
  fetchInviteFile,
  HeadMoved,
  NotAMember,
  openInviteFile,
  replayAccessList,
  sealInviteFile,
  teamVaultIdOf,
  type AccessState,
  type SignedAccessRecord,
} from '@nod/core/sharing';
import {
  accountsAddRecord,
  accountsRemoveRecord,
  inviteFileFor,
  inviteRecord,
  keyChangeRecord,
  requestAcceptRecord,
  requestJoinRecord,
  requestRemoveRecord,
  rootRecord,
  sealedNote,
  testIdentities,
  type CurrentKey,
} from '@nod/core/sharing/testing';
import { createRelayTransport, type Fetch } from '@nod/core/sync';
import { createRelay, type ServerLimits } from './server.ts';

describe('relay server team vaults', () => {
  const { owner, admin, writer, reader, stranger, hex } = testIdentities();
  const start = Date.UTC(2026, 0, 1);
  const dev = {
    d0: '0'.repeat(64),
    d1: '1'.repeat(64),
    d2: '2'.repeat(64),
    dx: 'f'.repeat(64),
  };
  let clock = start;
  let directory = '';
  let url = '';
  let close = async () => {};
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const reasons: string[] = [];

  afterEach(async () => {
    await close();
    close = async () => {};
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = '';
    }
  });

  async function startRelay(
    extra: {
      host?: string;
      limits?: Partial<ServerLimits>;
      sourceUrl?: string;
    } = {},
  ) {
    clock = start;
    directory = await mkdtemp(join(tmpdir(), 'nod-relay-'));
    await listen(extra);
  }

  // A relay over the current data directory, as a restart would bring up.
  async function listen(
    extra: {
      host?: string;
      limits?: Partial<ServerLimits>;
      sourceUrl?: string;
    } = {},
  ) {
    const server = createRelay(join(directory, 'data'), {
      now: () => clock,
      ...extra,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address: AddressInfo | string | null = server.address();
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
    close = () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
  }

  const relayFetch: Fetch = async (target, init) => {
    sent.push({ url: target, init });
    const response = await fetch(target, init);
    reasons.push(await response.clone().text());
    return response;
  };

  const place = (identity: Identity, vaultId: string, now = () => clock) =>
    createTeamRelay({ url, vaultId, identity, fetch: relayFetch, now });

  // A request signed by hand, for routes the app's client doesn't send.
  async function signed(
    who: Identity,
    vaultId: string,
    method: string,
    path: string,
    body?: Uint8Array,
    host?: string,
  ) {
    const target = new URL(`${url}v1/vaults/${vaultId}${path}`);
    const authorization = signRelayRequest(
      who,
      {
        host: host ?? target.host,
        method,
        path: `${target.pathname}${target.search}`,
        vaultId,
        body: body ?? null,
      },
      clock,
    );
    const response = await fetch(target, {
      method,
      headers: { authorization },
      ...(body ? { body: Buffer.from(body) } : {}),
    });
    reasons.push(await response.clone().text());
    return response;
  }

  async function refused(
    action: Promise<unknown>,
    status: number,
    reason?: string,
  ) {
    await assert.rejects(action, new RegExp(`answered ${status}`));
    if (reason !== undefined) {
      assert.equal(reasons.at(-1), reason);
    }
  }

  function stateOf(
    vaultId: string,
    records: SignedAccessRecord[],
  ): AccessState {
    const replayed = replayAccessList(vaultId, records);
    if (!replayed.ok) {
      throw new Error(replayed.reason);
    }
    return replayed.state;
  }

  async function startTeam(extra: { limits?: Partial<ServerLimits> } = {}) {
    await startRelay(extra);
    const root = rootRecord(owner, clock);
    const vaultId = teamVaultIdOf(root.record);
    const at = place(owner, vaultId);
    await at.list.append(root.record);
    const key: CurrentKey = { keyId: root.keyId, rootKey: root.rootKey };
    const state = async () => stateOf(vaultId, await at.list.read());
    return { vaultId, root, at, key, state };
  }

  it('tells anyone where its source is, when the operator names it', async () => {
    await startRelay({ sourceUrl: 'https://code.example.org/nod-relay' });
    const response = await fetch(`${url}source`);
    assert.equal(response.status, 200);
    assert.equal(
      await response.text(),
      'This server runs the Nod sync relay, licensed under the GNU Affero General Public License v3.0 only.\nIts source code: https://code.example.org/nod-relay\n',
    );
    await close();
    await listen();
    assert.equal((await fetch(`${url}source`)).status, 404);
  });

  it('registers a team by its root record and keeps its list on disk', async () => {
    const { vaultId, root, at, key, state } = await startTeam();
    assert.deepEqual(await at.list.read(), [root.record]);
    const stored: unknown = JSON.parse(
      await readFile(join(directory, 'data', vaultId, 'acl.json'), 'utf8'),
    );
    assert.equal(Array.isArray(stored) ? stored.length : -1, 1);

    const other = rootRecord(stranger, clock);
    await refused(
      place(owner, teamVaultIdOf(other.record)).list.append(other.record),
      403,
      'the record isn’t the requester’s',
    );
    await refused(
      place(stranger, vaultId).list.append(other.record),
      403,
      'not a member',
    );
    await refused(
      place(owner, teamVaultIdOf(other.record)).list.append(root.record),
      400,
      'the root isn’t this vault’s',
    );
    await assert.rejects(
      place(owner, teamVaultIdOf(other.record)).list.read(),
      /isn’t on this relay/,
    );

    const stale = await state();
    await at.list.append(
      accountsAddRecord(
        owner,
        stale,
        key,
        [{ card: identityCard(writer), role: 'writer' }],
        clock,
      ),
    );
    await assert.rejects(
      at.list.append(
        inviteRecord(owner, stale, key, 'reader', true, clock).record,
      ),
      HeadMoved,
    );
    await refused(
      place(writer, vaultId).list.append(
        inviteRecord(writer, await state(), key, 'reader', true, clock).record,
      ),
      400,
      'only an owner or admin invites, and only an owner invites admins',
    );
    const token = relayToken(randomBytes(32));
    const response = await fetch(`${url}v1/vaults/${vaultId}/acl`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 401);
    const asToken = createRelayTransport({
      url,
      vaultId,
      token,
      fetch: relayFetch,
    });
    await assert.rejects(asToken.register(), /403/);
    assert.deepEqual(await asToken.list('devices/'), []);
    assert.equal(
      (
        await fetch(`${url}v1/vaults/${vaultId}/files`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
      404,
    );
  });

  it('keeps a token vault a token vault', async () => {
    await startRelay();
    const vaultKey = randomBytes(32);
    const vaultId = vaultIdOf(vaultKey);
    const transport = createRelayTransport({
      url,
      vaultId,
      token: relayToken(vaultKey),
      fetch: relayFetch,
    });
    await transport.register();
    await transport.write('devices/a/meetings/m1.bin', Buffer.from('sealed'));
    const root = rootRecord(owner, clock);
    await refused(
      place(owner, vaultId).list.append(root.record),
      400,
      'the root isn’t this vault’s',
    );
    const teamId = teamVaultIdOf(root.record);
    await mkdir(join(directory, 'data', teamId), { recursive: true });
    await writeFile(join(directory, 'data', teamId, 'token'), 'planted');
    await assert.rejects(
      place(owner, teamId).list.append(root.record),
      HeadMoved,
    );
    assert.equal(reasons.at(-1), 'this id names a token vault');
    await assert.rejects(
      place(owner, vaultId).list.read(),
      /isn’t on this relay/,
    );
    assert.deepEqual(
      (await transport.list('devices/')).map((file) => file.path),
      ['devices/a/meetings/m1.bin'],
    );
  });

  it('takes join requests from outsiders, answers them only, and serves invite files to anyone', async () => {
    const { vaultId, at, key, state } = await startTeam();
    const invite = inviteRecord(
      owner,
      await state(),
      key,
      'writer',
      true,
      clock,
    );
    await at.list.append(invite.record);
    const file = inviteFileFor({ vaultId, invite, inviter: owner, host: url });
    const sealed = sealInviteFile(file);
    await at.putInvite(sealed.fileId, sealed.sealed);
    const link = { vaultId, fileId: sealed.fileId, key: sealed.key, host: url };
    const fetched = await fetchInviteFile(link, relayFetch);
    assert.equal(
      openInviteFile(fetched ?? new Uint8Array(), sealed.key)?.team,
      'Team',
    );
    await refused(
      place(stranger, vaultId).putInvite(sealed.fileId, sealed.sealed),
      403,
    );
    await refused(
      at.putInvite('0'.repeat(32), sealed.sealed),
      400,
      'the file id isn’t the file’s hash',
    );
    for (let count = 1; count < 8; count += 1) {
      const more = sealInviteFile({ ...file, team: `Team ${count}` });
      await at.putInvite(more.fileId, more.sealed);
    }
    const ninth = sealInviteFile({ ...file, team: 'Ninth' });
    await refused(at.putInvite(ninth.fileId, ninth.sealed), 507);
    clock += 7 * 24 * 60 * 60 * 1000;
    assert.equal(await fetchInviteFile(link, relayFetch), null);
    await at.putInvite(ninth.fileId, ninth.sealed);

    const request = requestJoinRecord(stranger, file, null, clock);
    const asker = place(stranger, vaultId);
    await asker.list.append(request);
    assert.equal(await asker.status(request.id), 'pending');
    assert.equal(await at.status(request.id), 'unknown');
    await assert.rejects(asker.list.read(), NotAMember);
    await at.list.append(
      requestAcceptRecord(
        owner,
        await state(),
        key,
        request.id,
        'writer',
        clock,
      ),
    );
    assert.equal(await asker.status(request.id), 'accepted');
    assert.equal((await asker.list.read()).length, 4);
  });

  it('lets writers publish signed files under the current key into their own folder, and delete by its rules', async () => {
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [
          { card: identityCard(admin), role: 'admin' },
          { card: identityCard(writer), role: 'writer' },
          { card: identityCard(reader), role: 'reader' },
        ],
        clock,
      ),
    );
    const files = (who: Identity) => place(who, vaultId).transport;
    const note = `devices/${dev.d1}/notes/n1.bin`;
    const published = sealedNote(key, writer);
    assert.notEqual(await files(writer).write(note, published), null);
    assert.deepEqual(
      (await files(reader).list('devices/')).map((file) => file.path),
      [note],
    );
    assert.deepEqual(
      Buffer.from((await files(reader).read(note, 10_000)) ?? []),
      Buffer.from(published),
    );
    await refused(files(stranger).list('devices/'), 403, 'not a member');
    await refused(
      files(reader).write(
        `devices/${dev.d2}/notes/n1.bin`,
        sealedNote(key, reader),
      ),
      403,
      'readers don’t write',
    );
    await refused(
      files(writer).write(
        `devices/${dev.d1}/notes/n2.bin`,
        sealedNote(key, owner),
      ),
      403,
      'the file names another publisher',
    );
    await refused(
      files(writer).write(
        `devices/${dev.d1}/notes/n2.bin`,
        Buffer.from('plain'),
      ),
      400,
      'not a signed file',
    );
    for (const path of [
      `devices/${dev.d1}/meetings/m1.bin`,
      `devices/${dev.d1}/closed.json`,
      `devices/${dev.d1}/shares.bin`,
    ]) {
      await refused(files(writer).write(path, sealedNote(key, writer)), 400);
    }
    await refused(
      files(writer).write(
        `devices/${dev.d1}/members.bin`,
        sealedNote(key, writer),
      ),
      403,
      'only an owner or admin names members',
    );
    await files(owner).write(
      `devices/${dev.d0}/members.bin`,
      sealedNote(key, owner),
    );
    await refused(
      files(owner).write(
        `devices/${dev.d1}/notes/n9.bin`,
        sealedNote(key, owner),
      ),
      403,
      'another identity’s device folder',
    );
    await rm(join(directory, 'data', vaultId, 'team.json'));
    await refused(
      files(owner).write(
        `devices/${dev.d1}/notes/n9.bin`,
        sealedNote(key, owner),
      ),
      403,
      'another identity’s device folder',
    );

    const rotated = keyChangeRecord(owner, await state(), key, clock);
    await at.list.append(rotated.record);
    await refused(
      files(writer).write(note, sealedNote(key, writer, 'later')),
      409,
      'sealed under a retired key',
    );
    const next: CurrentKey = {
      keyId:
        rotated.record.body.type === 'keyChange'
          ? rotated.record.body.keyChange.keyId
          : '',
      rootKey: rotated.rootKey,
    };
    await files(writer).write(note, sealedNote(next, writer, 'later'));
    await files(writer).write(
      `devices/${dev.d1}/notes/n2.bin`,
      sealedNote(next, writer),
    );

    await refused(
      files(admin).remove(note),
      403,
      'another identity’s device folder',
    );
    await refused(files(reader).remove(note), 403);
    await files(writer).remove(note);
    await files(writer).remove(`devices/${dev.d1}/notes/none.bin`);
    assert.equal(await files(admin).read(note, 10_000), null);
    const removed = accountsRemoveRecord(
      owner,
      await state(),
      next,
      [hex(writer)],
      clock,
    );
    await at.list.append(removed.record);
    await refused(files(writer).list('devices/'), 403, 'not a member');
    await files(admin).remove(`devices/${dev.d1}/notes/n2.bin`);
    assert.deepEqual(
      (await files(owner).list('devices/')).map((file) => file.path),
      [`devices/${dev.d0}/members.bin`],
    );
  });

  it('takes each signed request once, and only within its time window', async () => {
    const { vaultId, at, key } = await startTeam();
    await at.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
    const write = sent.at(-1);
    assert.ok(write);
    const replayed = await fetch(write.url, write.init);
    assert.equal(replayed.status, 403);
    assert.equal(await replayed.text(), 'a replayed request');
    await at.transport.list('devices/');
    const listing = sent.at(-1);
    assert.ok(listing);
    assert.equal((await fetch(listing.url, listing.init)).status, 200);
    assert.equal(
      (
        await fetch(
          listing.url.replace('prefix=devices', 'prefix=devices%2Fd0'),
          listing.init,
        )
      ).status,
      401,
    );
    const late = place(owner, vaultId, () => clock - relayRequestWindowMs - 1);
    await refused(late.list.read(), 401);
    const within = place(
      owner,
      vaultId,
      () => clock - relayRequestWindowMs + 1000,
    );
    assert.equal((await within.list.read()).length, 1);
  });

  it('refuses a replay for as long as the request’s own time is good', async () => {
    const { vaultId, key } = await startTeam();
    const ahead = place(
      owner,
      vaultId,
      () => clock + relayRequestWindowMs - 1000,
    );
    await ahead.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
    const write = sent.at(-1);
    assert.ok(write);
    clock += relayRequestWindowMs + 2000;
    const replayed = await fetch(write.url, write.init);
    assert.equal(replayed.status, 403);
    assert.equal(await replayed.text(), 'a replayed request');
  });

  it('remembers nonces only for requests it acts on, and caps them', async () => {
    const { vaultId, at, key, state } = await startTeam({
      limits: { liveNonces: 32, repairNonces: 4 },
    });
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(reader), role: 'reader' }],
        clock,
      ),
    );
    for (let count = 0; count < 3; count += 1) {
      await refused(
        place(stranger, vaultId).transport.remove(
          `devices/${dev.d0}/notes/n1.bin`,
        ),
        403,
      );
      await refused(
        place(reader, vaultId).transport.write(
          `devices/${dev.d2}/notes/n1.bin`,
          sealedNote(key, reader),
        ),
        403,
      );
      await refused(
        place(stranger, vaultId).list.append(
          requestRemoveRecord(stranger, await state(), clock),
        ),
        403,
      );
    }
    const files = at.transport;
    await files.write(`devices/${dev.d0}/notes/n1.bin`, sealedNote(key, owner));
    await files.write(`devices/${dev.d0}/notes/n2.bin`, sealedNote(key, owner));
    await assert.rejects(
      files.write(`devices/${dev.d0}/notes/n3.bin`, sealedNote(key, owner)),
      /429/,
    );
    clock += relayRequestWindowMs + 1;
    await files.write(`devices/${dev.d0}/notes/n3.bin`, sealedNote(key, owner));
  });

  it('verifies the public host it is told about, not the one the proxy sends', async () => {
    await startRelay({ host: 'relay.example.com' });
    const root = rootRecord(owner, clock);
    const vaultId = teamVaultIdOf(root.record);
    await refused(place(owner, vaultId).list.append(root.record), 401);
    const through = createTeamRelay({
      url: 'https://relay.example.com/',
      vaultId,
      identity: owner,
      fetch: (target, init) =>
        relayFetch(target.replace('https://relay.example.com/', url), init),
      now: () => clock,
    });
    await through.list.append(root.record);
    assert.equal((await through.list.read()).length, 1);
    await refused(place(owner, vaultId).list.read(), 401);
  });

  it('lets nobody write or delete in a folder whose owner it can’t tell', async () => {
    const { vaultId, at, key, state } = await startTeam();
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(admin), role: 'admin' }],
        clock,
      ),
    );
    const folder = join(directory, 'data', vaultId, 'files', 'devices', dev.dx);
    await mkdir(join(folder, 'notes'), { recursive: true });
    await writeFile(join(folder, 'notes', 'x.bin'), 'not a signed file');
    for (const who of [owner, admin]) {
      await refused(
        place(who, vaultId).transport.remove(`devices/${dev.dx}/notes/x.bin`),
        403,
        'another identity’s device folder',
      );
      await refused(
        place(who, vaultId).transport.write(
          `devices/${dev.dx}/notes/y.bin`,
          sealedNote(key, who),
        ),
        403,
        'another identity’s device folder',
      );
    }
    await at.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
  });
  it('keeps a token vault to the files a vault has, within its quota', async () => {
    await startRelay({
      limits: { files: 2, vaultBytes: 10, newVaultsPerHour: 2 },
    });
    const vaultKey = randomBytes(32);
    const vaultId = vaultIdOf(vaultKey);
    const token = relayToken(vaultKey);
    const send = (method: string, path: string, body?: string) =>
      fetch(`${url}v1/vaults/${vaultId}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body }),
      });
    assert.equal((await send('PUT', '')).status, 201);
    const file = (name: string) => `/files/devices/a/meetings/${name}.bin`;
    for (const path of [
      '/files/pairing/r1/offer.json',
      '/files/devices/a/meetings/deep/m.bin',
      '/files/devices/a/other.bin',
      '/files/token',
    ]) {
      assert.equal((await send('PUT', path, 'x')).status, 400, path);
    }
    assert.equal((await send('GET', '/files?prefix=pairing/')).status, 400);
    assert.equal((await send('PUT', file('a'), '123456')).status, 204);
    assert.equal((await send('PUT', file('b'), '12345')).status, 507);
    assert.equal((await send('PUT', file('b'), '1234')).status, 204);
    assert.equal((await send('PUT', file('c'), '')).status, 507);
    assert.equal((await send('PUT', file('a'), '12')).status, 204);
    assert.equal((await send('PUT', file('c'), '')).status, 507);
    assert.equal((await send('DELETE', file('b'))).status, 204);
    assert.equal((await send('PUT', file('c'), '12345678')).status, 204);
    assert.deepEqual(
      (await (await send('GET', '/files?prefix=devices/')).json()).map(
        (entry: { path: string }) => entry.path,
      ),
      ['devices/a/meetings/a.bin', 'devices/a/meetings/c.bin'],
    );

    const register = (key: Buffer) =>
      fetch(`${url}v1/vaults/${vaultIdOf(key)}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${relayToken(key)}` },
      });
    assert.equal((await register(randomBytes(32))).status, 201);
    const limited = await register(randomBytes(32));
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('x-relay-refusal'), 'new-vaults');
    assert.equal(limited.headers.get('retry-after'), '3600');
    assert.equal((await send('PUT', '')).status, 204);
    const root = rootRecord(owner, clock);
    await refused(
      place(owner, teamVaultIdOf(root.record)).list.append(root.record),
      429,
    );
    clock += 60 * 60 * 1000;
    assert.equal((await register(randomBytes(32))).status, 201);
  });

  it('serves only lowercase vault ids, so no two spellings name one folder', async () => {
    const { vaultId, at, key } = await startTeam();
    await at.transport.write(
      `devices/${dev.d0}/notes/n1.bin`,
      sealedNote(key, owner),
    );
    const upper = vaultId.toUpperCase();
    assert.notEqual(upper, vaultId);
    assert.equal(
      (await signed(owner, upper, 'GET', '/files?prefix=devices/')).status,
      404,
    );
    assert.equal(
      (
        await signed(
          owner,
          vaultId,
          'PUT',
          `/files/devices/${'a'.repeat(64).toUpperCase()}/notes/n1.bin`,
          sealedNote(key, owner),
        )
      ).status,
      400,
    );
  });

  it('turns away a large write from outside the team before reading it', async () => {
    const { vaultId, key } = await startTeam();
    const path = `/files/devices/${dev.d1}/notes/n1.bin`;
    const response = await signed(
      stranger,
      vaultId,
      'PUT',
      path,
      new Uint8Array(17 * 1024 * 1024),
    );
    assert.equal(response.status, 403);
    assert.equal(await response.text(), 'not a member');
    const missing = await signed(
      owner,
      'e'.repeat(32),
      'PUT',
      path,
      sealedNote(key, owner),
    );
    assert.equal(missing.status, 404);
    const large = await signed(
      owner,
      vaultId,
      'PUT',
      path,
      new Uint8Array(16 * 1024 * 1024 + 1),
    );
    assert.equal(large.status, 413);
  });

  it('takes no body where none belongs, and counts invite files as writes', async () => {
    const { vaultId, at, key, state } = await startTeam({
      limits: { identityWritesPerHour: 1 },
    });
    const note = `/files/devices/${dev.d0}/notes/n1.bin`;
    const withBody = await signed(
      owner,
      vaultId,
      'DELETE',
      note,
      Buffer.from('x'),
    );
    assert.equal(withBody.status, 413);
    const register = await signed(owner, vaultId, 'PUT', '', Buffer.from('x'));
    assert.equal(register.status, 413);
    const posted = await signed(
      owner,
      vaultId,
      'POST',
      note,
      new Uint8Array(17 * 1024 * 1024),
    );
    assert.equal(posted.status, 405);
    const invite = inviteRecord(
      owner,
      await state(),
      key,
      'writer',
      true,
      clock,
    );
    await at.list.append(invite.record);
    const sealed = sealInviteFile(
      inviteFileFor({ vaultId, invite, inviter: owner, host: url }),
    );
    await refused(
      at.putInvite(sealed.fileId, sealed.sealed),
      429,
      'this identity took its share of the hour',
    );
  });

  it('keeps no nonce for a request the hour refused', async () => {
    const { vaultId, at, key, state } = await startTeam({
      limits: { identityWritesPerHour: 2 },
    });
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(writer), role: 'writer' }],
        clock,
      ),
    );
    const mine = place(writer, vaultId).transport;
    await mine.write(`devices/${dev.d1}/notes/n1.bin`, sealedNote(key, writer));
    await mine.write(`devices/${dev.d1}/notes/n2.bin`, sealedNote(key, writer));
    for (const note of ['n3', 'n4', 'n5']) {
      await refused(
        mine.write(
          `devices/${dev.d1}/notes/${note}.bin`,
          sealedNote(key, writer),
        ),
        429,
        'this identity took its share of the hour',
      );
    }
    await refused(
      mine.remove(`devices/${dev.d1}/notes/n1.bin`),
      429,
      'this identity took its share of the hour',
    );
    const meta: unknown = JSON.parse(
      await readFile(join(directory, 'data', vaultId, 'team.json'), 'utf8'),
    );
    const live: unknown = Reflect.get(Object(meta), 'nonces');
    assert.equal(
      (Array.isArray(live) ? live : []).filter(
        (entry: unknown) => Reflect.get(Object(entry), 'by') === hex(writer),
      ).length,
      2,
    );
  });

  it('remembers nonces across a restart, and leaves the register call free', async () => {
    await startRelay({
      host: 'relay.example.com',
      limits: { liveNonces: 16, repairNonces: 4 },
    });
    const root = rootRecord(owner, clock);
    const vaultId = teamVaultIdOf(root.record);
    const host = 'relay.example.com';
    const register = await signed(
      owner,
      vaultId,
      'PUT',
      '/acl',
      Buffer.from(JSON.stringify(root.record)),
      host,
    );
    assert.equal(register.status, 204);
    const key: CurrentKey = { keyId: root.keyId, rootKey: root.rootKey };
    const note = `/files/devices/${dev.d0}/notes/n1.bin`;
    const target = new URL(`${url}v1/vaults/${vaultId}${note}`);
    const body = sealedNote(key, owner);
    const authorization = signRelayRequest(
      owner,
      { host, method: 'PUT', path: target.pathname, vaultId, body },
      clock,
    );
    const write = () =>
      fetch(`${url}v1/vaults/${vaultId}${note}`, {
        method: 'PUT',
        headers: { authorization },
        body: Buffer.from(body),
      });
    assert.equal((await write()).status, 204);
    await close();
    await listen({ host, limits: { liveNonces: 16, repairNonces: 4 } });
    const replayed = await write();
    assert.equal(replayed.status, 403);
    assert.equal(await replayed.text(), 'a replayed request');

    for (let count = 0; count < 3; count += 1) {
      assert.equal(
        (await signed(owner, vaultId, 'PUT', '', undefined, host)).status,
        204,
      );
    }
    const full = await signed(owner, vaultId, 'DELETE', note, undefined, host);
    assert.equal(full.status, 429);
    assert.equal(full.headers.get('x-relay-refusal'), 'writes');
    assert.equal(await full.text(), 'too many live requests');
  });

  it('caps each member’s share of the hour and records, and keeps the list’s last room for repairs', async () => {
    const { vaultId, at, key, state } = await startTeam({
      limits: {
        identityWritesPerHour: 1,
        managerRecordsPerHour: 2,
        listBytes: 64 * 1024,
        listReserveBytes: 64 * 1024 - 1500,
      },
    });
    await at.list.append(
      accountsAddRecord(
        owner,
        await state(),
        key,
        [{ card: identityCard(writer), role: 'writer' }],
        clock,
      ),
    );
    const mine = place(writer, vaultId).transport;
    await mine.write(`devices/${dev.d1}/notes/n1.bin`, sealedNote(key, writer));
    await refused(
      mine.write(`devices/${dev.d1}/notes/n2.bin`, sealedNote(key, writer)),
      429,
      'this identity took its share of the hour',
    );
    await refused(
      at.list.append(
        inviteRecord(owner, await state(), key, 'reader', true, clock).record,
      ),
      507,
      'the list keeps its last room for repairs',
    );
    const removed = accountsRemoveRecord(
      owner,
      await state(),
      key,
      [hex(writer)],
      clock,
    );
    await at.list.append(removed.record);
    const next: CurrentKey = {
      keyId:
        removed.record.body.type === 'accountsRemove'
          ? removed.record.body.keyChange.keyId
          : '',
      rootKey: removed.rootKey,
    };
    await refused(
      at.list.append(keyChangeRecord(owner, await state(), next, clock).record),
      429,
      'too many records from this identity this hour',
    );
    clock += 60 * 60 * 1000;
    await at.list.append(
      keyChangeRecord(owner, await state(), next, clock).record,
    );
  });

  it('keeps a token and an identity each to their own kind of vault', async () => {
    const { vaultId, key } = await startTeam();
    const vaultKey = randomBytes(32);
    const tokenVault = vaultIdOf(vaultKey);
    const token = relayToken(vaultKey);
    const asToken = (id: string, method: string, path: string, body?: string) =>
      fetch(`${url}v1/vaults/${id}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body }),
      });
    assert.equal((await asToken(tokenVault, 'PUT', '')).status, 201);
    assert.equal(
      (
        await asToken(
          tokenVault,
          'PUT',
          '/files/devices/a/meetings/m1.bin',
          'x',
        )
      ).status,
      204,
    );
    const note = `/files/devices/${dev.d0}/notes/n1.bin`;
    for (const [method, path, status] of [
      ['PUT', '', 403],
      ['GET', '/files', 404],
      ['GET', note, 404],
      ['PUT', note, 404],
      ['DELETE', note, 404],
      ['GET', '/acl', 401],
      ['PUT', '/acl', 401],
      ['PUT', `/invites/${'a'.repeat(32)}`, 401],
    ] satisfies Array<[string, string, number]>) {
      assert.equal(
        (
          await asToken(
            vaultId,
            method,
            path,
            method === 'PUT' ? 'x' : undefined,
          )
        ).status,
        status,
        `${method} ${path}`,
      );
    }
    const meeting = '/files/devices/a/meetings/m1.bin';
    for (const [method, path, status] of [
      ['PUT', '', 404],
      ['GET', '/files', 404],
      ['GET', meeting, 404],
      ['PUT', meeting, 404],
      ['DELETE', meeting, 404],
      ['GET', '/acl', 404],
    ] satisfies Array<[string, string, number]>) {
      assert.equal(
        (
          await signed(
            owner,
            tokenVault,
            method,
            path,
            method === 'PUT' && path !== ''
              ? sealedNote(key, owner)
              : undefined,
          )
        ).status,
        status,
        `${method} ${path}`,
      );
    }
    assert.equal(
      (
        await signed(
          owner,
          tokenVault,
          'PUT',
          '/acl',
          Buffer.from(JSON.stringify(rootRecord(owner, clock).record)),
        )
      ).status,
      400,
    );
    assert.deepEqual(
      (await readdir(join(directory, 'data', tokenVault))).sort(),
      ['files', 'token'],
    );
    assert.deepEqual(
      await (
        await asToken(tokenVault, 'GET', '/files?prefix=devices/')
      )
        .json()
        .then((files: Array<{ path: string }>) =>
          files.map((file) => file.path),
        ),
      ['devices/a/meetings/m1.bin'],
    );
  });
});
