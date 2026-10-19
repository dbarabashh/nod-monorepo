import { strict as assert } from 'node:assert';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { startMeeting } from '../../core/meetings/index.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createMeetingStore, type Cipher } from './store.ts';

const reversing: Cipher = {
  encrypt: (plain) => Buffer.from(plain).reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString(),
};

describe('createMeetingStore', () => {
  const dir = useTempDir('meetings-');
  const file = () => join(dir(), 'meetings.bin');

  it('starts empty when nothing was saved', async () => {
    assert.deepEqual(await createMeetingStore(file(), reversing).load(), []);
  });

  it('saves through the cipher, so no title is stored in plain text', async () => {
    const meetings = [startMeeting('m1', 'Salary talk', 1_000)];
    await createMeetingStore(file(), reversing).save(meetings);

    assert.equal(
      (await readFile(file(), 'utf8')).includes('Salary talk'),
      false,
    );
    assert.deepEqual(
      await createMeetingStore(file(), reversing).load(),
      meetings,
    );
    assert.deepEqual(await readdir(dir()), ['meetings.bin']);
  });

  it('refuses to read data it cannot decrypt instead of starting over', async () => {
    await writeFile(file(), 'not encrypted');
    const broken: Cipher = {
      ...reversing,
      decrypt: () => {
        throw new Error('Error while decrypting the ciphertext');
      },
    };
    await assert.rejects(
      createMeetingStore(file(), broken).load(),
      /decrypting/,
    );
  });

  it('reports a file it cannot read instead of starting empty', async () => {
    await mkdir(file());
    await assert.rejects(createMeetingStore(file(), reversing).load(), {
      code: 'EISDIR',
    });
  });

  it('skips a queued save that a newer one replaced', async () => {
    let writes = 0;
    const counting: Cipher = {
      ...reversing,
      encrypt: (plain) => {
        writes += 1;
        return reversing.encrypt(plain);
      },
    };
    const store = createMeetingStore(file(), counting);
    await Promise.all([
      store.save([startMeeting('a', 'A', 1)]),
      store.save([startMeeting('b', 'B', 2)]),
      store.save([startMeeting('c', 'C', 3)]),
    ]);
    assert.equal(writes, 1);
    assert.deepEqual(
      (await store.load()).map((meeting) => meeting.id),
      ['c'],
    );
  });

  it('writes overlapping saves one after another', async () => {
    const store = createMeetingStore(file(), reversing);
    await Promise.all([
      store.save([startMeeting('a', 'A', 1)]),
      store.save([startMeeting('b', 'B', 2)]),
    ]);
    assert.deepEqual(
      (await store.load()).map((meeting) => meeting.id),
      ['b'],
    );
  });
});
