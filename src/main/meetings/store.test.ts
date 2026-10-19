import { strict as assert } from 'node:assert';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  appendTranscript,
  createDocument,
  editSummary,
  serializeMeetings,
  setSummary,
  startMeeting,
  updateDocument,
} from '../../core/meetings/index.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createMeetingStore, isMeetingId, type Cipher } from './store.ts';

function reversing(onEncrypt: () => void = () => {}): Cipher {
  return {
    encrypt: (plain, context) => {
      onEncrypt();
      return Buffer.concat([
        Buffer.from(`${context}|`),
        Buffer.from(plain).reverse(),
      ]);
    },
    decrypt: (data, context) => {
      const prefix = Buffer.from(`${context}|`);
      if (!Buffer.from(data.subarray(0, prefix.length)).equals(prefix)) {
        throw new Error('wrong context');
      }
      return Buffer.from(data.subarray(prefix.length)).reverse();
    },
  };
}

const meeting = setSummary(
  appendTranscript(startMeeting('m1', 'Salary talk', 1_000), [
    { id: 'l1', speaker: 'me', startMs: 0, endMs: 900, text: 'Let us start.' },
  ]),
  'We agreed on a raise.',
);

describe('createMeetingStore', () => {
  const dir = useTempDir('meetings-');
  const store = (cipher = reversing(), written: string[] = []) =>
    createMeetingStore({
      directory: join(dir(), 'meetings'),
      cipher: async () => cipher,
      legacy: {
        file: join(dir(), 'meetings.bin'),
        decrypt: (data) => Buffer.from(data).reverse().toString(),
      },
      onWrite: (id) => written.push(id),
    });

  it('starts empty when nothing was saved', async () => {
    assert.deepEqual(await store().load(), []);
  });

  it('saves each meeting to its own encrypted file and reads it back', async () => {
    const written: string[] = [];
    const first = store(reversing(), written);
    await first.load();
    await first.save(meeting);
    await first.save(startMeeting('m2', 'Other', 2_000));

    assert.deepEqual(written, ['m1', 'm2']);
    const files = (await readdir(join(dir(), 'meetings'))).sort();
    assert.deepEqual(files, ['m1.bin', 'm2.bin']);
    const raw = await readFile(join(dir(), 'meetings', 'm1.bin'));
    assert.equal(raw.includes('raise'), false);
    assert.deepEqual(
      (await store().load()).find((saved) => saved.id === 'm1'),
      meeting,
    );
  });

  it('writes only the meeting that changed', async () => {
    const written: string[] = [];
    const saving = store(reversing(), written);
    await saving.load();
    await saving.save(meeting);
    await saving.save(startMeeting('m2', 'Other', 2_000));
    written.length = 0;
    await saving.save(editSummary(meeting, 'We agreed on a bigger raise.'));
    assert.deepEqual(written, ['m1']);
  });

  it('writes a save that arrives during a write once that write is done', async () => {
    let writes = 0;
    let second: Promise<void> = Promise.resolve();
    let saving = store();
    const cipher = reversing(() => {
      writes += 1;
      if (writes === 1) {
        second = saving.save(editSummary(meeting, 'Changed meanwhile.'));
      }
    });
    saving = store(cipher);
    await saving.load();
    await saving.save(meeting);
    await second;
    assert.equal(writes, 2);
    assert.equal((await store().load())[0]?.summary, 'Changed meanwhile.');
  });

  it('fails the saves that were waiting for a write that failed', async () => {
    let writes = 0;
    let waiting: Array<Promise<void>> = [];
    let saving = store();
    const cipher = reversing(() => {
      writes += 1;
      if (writes === 1) {
        waiting = [
          saving.save(editSummary(meeting, 'One.')),
          saving.save(editSummary(meeting, 'Two.')),
        ];
      } else {
        throw new Error('disk full');
      }
    });
    saving = store(cipher);
    await saving.load();
    await saving.save(meeting);
    const [skipped, last] = waiting;
    await assert.rejects(skipped ?? Promise.resolve(), /disk full/);
    await assert.rejects(last ?? Promise.resolve(), /disk full/);
    assert.equal(writes, 2);
  });

  it('moves meetings from the old single file once, then removes it', async () => {
    const legacyJson = JSON.stringify(
      serializeMeetings([meeting, startMeeting('m2', 'Other', 2_000)]),
    );
    await writeFile(
      join(dir(), 'meetings.bin'),
      Buffer.from(legacyJson).reverse(),
    );

    const loaded = await store().load();
    assert.deepEqual(loaded.map((saved) => saved.id).sort(), ['m1', 'm2']);
    assert.deepEqual(await readdir(dir()), ['meetings']);
    assert.deepEqual(
      (await store().load()).find((saved) => saved.id === 'm1'),
      meeting,
    );
  });

  it('keeps a file it cannot read, refuses to overwrite it, and still loads the rest', async () => {
    const first = store();
    await first.load();
    await first.save(meeting);
    await first.save(startMeeting('m2', 'Other', 2_000));
    await writeFile(join(dir(), 'meetings', 'm1.bin'), 'not a meeting');

    const second = store();
    assert.deepEqual(
      (await second.load()).map((saved) => saved.id),
      ['m2'],
    );
    await assert.rejects(second.save(meeting), /could not be read/);
    assert.equal(
      await readFile(join(dir(), 'meetings', 'm1.bin'), 'utf8'),
      'not a meeting',
    );
  });

  it('keeps a deleted meeting as a tombstone that never comes back', async () => {
    const first = store();
    await first.load();
    await first.save(meeting);
    await first.remove('m1', 5_000);
    await assert.rejects(first.save(meeting), /deleted/);

    const second = store();
    assert.deepEqual(await second.load(), []);
    assert.deepEqual(second.ids(), ['m1']);
  });

  it('merges a document from another device and only writes when it adds something', async () => {
    const written: string[] = [];
    const local = store(reversing(), written);
    await local.load();
    await local.save(meeting);
    const shared = local.document('m1');
    assert.ok(shared);
    written.length = 0;

    assert.equal(local.merge('m1', shared).state, null);
    assert.deepEqual(written, []);

    const remote = updateDocument(
      createDocument(meeting),
      meeting,
      editSummary(meeting, 'Changed on the phone.'),
    );
    const merged = local.merge('m1', remote);
    assert.equal(merged.state?.kind, 'meeting');
    await merged.written;
    assert.deepEqual(written, ['m1']);
    assert.equal(local.merge('m2', remote).state, null);
  });

  it('lets a copy from another device replace a file it could not read, keeping the old file', async () => {
    const first = store();
    await first.load();
    await first.save(meeting);
    await writeFile(join(dir(), 'meetings', 'm1.bin'), 'not a meeting');

    const second = store();
    await second.load();
    const merged = second.merge('m1', createDocument(meeting));
    assert.equal(merged.state, null);
    assert.equal((await merged.written)?.kind, 'meeting');

    const files = await readdir(join(dir(), 'meetings'));
    assert.ok(
      files.some((name) => name.startsWith('m1.bin.damaged-')),
      files.join(),
    );
    assert.deepEqual(await store().load(), [meeting]);
  });

  it('never shares a save that failed, and writes it again on the next sync', async () => {
    let failing = false;
    const flaky = reversing(() => {
      if (failing) {
        throw new Error('disk full');
      }
    });
    const saving = store(flaky);
    await saving.load();
    await saving.save(meeting);
    const published = saving.document('m1');

    failing = true;
    await assert.rejects(
      saving.save(editSummary(meeting, 'Not saved yet.')),
      /disk full/,
    );
    assert.equal(saving.document('m1'), published);

    failing = false;
    assert.ok(published);
    const retried = saving.merge('m1', published);
    assert.equal(retried.state, null);
    await retried.written;
    assert.equal((await store().load())[0]?.summary, 'Not saved yet.');
  });

  it('restores a migrated meeting whose new file is damaged from the old file', async () => {
    await writeFile(
      join(dir(), 'meetings.bin'),
      Buffer.from(JSON.stringify(serializeMeetings([meeting]))).reverse(),
    );
    await store().load();
    await writeFile(join(dir(), 'meetings', 'm1.bin'), 'not a meeting');
    await writeFile(
      join(dir(), 'meetings.bin'),
      Buffer.from(JSON.stringify(serializeMeetings([meeting]))).reverse(),
    );

    assert.deepEqual(await store().load(), [meeting]);
  });

  it('only accepts meeting ids that are safe as file names', () => {
    assert.equal(isMeetingId('2f1c9a3e-1b2c-4d5e-8f90-123456789abc'), true);
    assert.equal(isMeetingId('../keys'), false);
    assert.equal(isMeetingId(''), false);
  });
});
