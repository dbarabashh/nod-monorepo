import { strict as assert } from 'node:assert';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { useTempDir } from '../testing/temp-dir.ts';
import { createFolderTransport } from './folder-transport.ts';

describe('createFolderTransport', () => {
  const dir = useTempDir('sync-folder-');

  it('writes, lists, reads and removes files under a prefix', async () => {
    const transport = createFolderTransport(dir());
    await transport.write('devices/a/meetings/m1.bin', Buffer.from('one'));
    await transport.write('devices/b/meetings/m2.bin', Buffer.from('two'));
    await transport.write('pairing/r1/request.json', Buffer.from('{}'));

    const listed = await transport.list('devices/');
    assert.deepEqual(listed.map((file) => file.path).sort(), [
      'devices/a/meetings/m1.bin',
      'devices/b/meetings/m2.bin',
    ]);
    assert.deepEqual(
      Buffer.from(
        (await transport.read('devices/b/meetings/m2.bin', 1_000_000)) ?? [],
      ),
      Buffer.from('two'),
    );
    assert.equal(
      await transport.read('devices/c/meetings/m3.bin', 1_000_000),
      null,
    );

    await transport.remove('devices/a/meetings/m1.bin');
    assert.deepEqual(
      (await transport.list('devices/')).map((file) => file.path),
      ['devices/b/meetings/m2.bin'],
    );
  });

  it('changes a file version when the file changes', async () => {
    const transport = createFolderTransport(dir());
    await transport.write('vault.json', Buffer.from('a'));
    const [before] = await transport.list('');
    await transport.write('vault.json', Buffer.from('bb'));
    const [after] = await transport.list('');
    assert.notEqual(after?.version, before?.version);
  });

  it('hides half-written files and refuses paths that climb out', async () => {
    const transport = createFolderTransport(dir());
    await transport.write('devices/a/meetings/m1.bin', Buffer.from('x'));
    await writeFile(
      join(dir(), 'devices', 'a', 'meetings', 'm2.bin.tmp-1'),
      'x',
    );
    assert.deepEqual(
      (await transport.list('devices/')).map((file) => file.path),
      ['devices/a/meetings/m1.bin'],
    );
    await assert.rejects(transport.read('../outside.bin', 1_000_000), /Unsafe/);
    await assert.rejects(
      transport.write('devices/../../x', Buffer.from('x')),
      /Unsafe/,
    );
    await assert.rejects(transport.list('../'), /Unsafe/);
  });

  it('lists nothing in a folder that has no sync data yet', async () => {
    assert.deepEqual(
      await createFolderTransport(join(dir(), 'missing')).list('devices/'),
      [],
    );
  });

  it('refuses links planted in the shared folder, so it never writes outside it', async () => {
    const outside = join(dir(), 'private');
    await mkdir(outside);
    await writeFile(join(outside, 'm1.bin'), 'my meeting');
    const root = join(dir(), 'shared');
    await mkdir(join(root, 'devices', 'a'), { recursive: true });
    await symlink(outside, join(root, 'devices', 'a', 'meetings'));
    const transport = createFolderTransport(root);

    await assert.rejects(
      transport.write('devices/a/meetings/m1.bin', Buffer.from('x')),
      /link/,
    );
    await assert.rejects(transport.remove('devices/a/meetings/m1.bin'), /link/);
    await assert.rejects(
      transport.read('devices/a/meetings/m1.bin', 1_000),
      /link/,
    );
    assert.equal(await readFile(join(outside, 'm1.bin'), 'utf8'), 'my meeting');
  });

  it('refuses a file larger than the caller allows', async () => {
    const transport = createFolderTransport(dir());
    await transport.write('vault.json', Buffer.alloc(2_000));
    await assert.rejects(
      transport.read('vault.json', 1_000),
      /larger than expected/,
    );
  });
});
