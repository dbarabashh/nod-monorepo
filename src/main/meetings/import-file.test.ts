import { strict as assert } from 'node:assert';
import { truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Meeting } from '../../core/meetings/index.ts';
import { useTempDir } from '../testing/temp-dir.ts';
import { createMeetingImport } from './import-file.ts';

function setup(file: string | null) {
  const received: Meeting[][] = [];
  let choose: () => Promise<string | null> = async () => file;
  const run = createMeetingImport({
    recorder: {
      importMeetings: async (meetings) => {
        received.push([...meetings]);
        return { added: meetings.length, present: 0, failed: 0 };
      },
    },
    chooseFile: () => choose(),
  });
  return {
    run,
    received,
    holdChoice: () => {
      let release = () => {};
      choose = () =>
        new Promise((resolve) => {
          release = () => resolve(null);
          choose = async () => file;
        });
      return () => release();
    },
  };
}

const exportText = JSON.stringify({
  format: 'nod-meetings',
  version: 1,
  meetings: [
    {
      id: 'a',
      title: 'Planning',
      startedAt: '2026-09-01T10:00:00Z',
      endedAt: null,
      summary: '',
      transcript: [],
    },
    { id: 'broken' },
  ],
});

describe('importing a meetings file', () => {
  const dir = useTempDir('import-file-');

  it('imports the meetings in the chosen file', async () => {
    const file = join(dir(), 'nod-meetings.json');
    await writeFile(file, exportText);
    const { run, received } = setup(file);

    assert.deepEqual(await run(), {
      status: 'imported',
      added: 1,
      present: 0,
      failed: 0,
      skipped: 1,
    });
    assert.deepEqual(
      received.map((batch) => batch.map((meeting) => meeting.id)),
      [['imported-a']],
    );
  });

  it('reads a file saved with a byte order mark', async () => {
    const file = join(dir(), 'nod-meetings.json');
    await writeFile(file, `\uFEFF${exportText}`);
    const { run, received } = setup(file);
    assert.equal((await run()).status, 'imported');
    assert.equal(received.length, 1);
  });

  it('says a file that is gone could not be opened, without its path', async () => {
    const file = join(dir(), 'gone.json');
    await assert.rejects(setup(file).run(), (error: Error) => {
      assert.equal(
        error.message,
        'This file couldn’t be opened. Check that it is still there and try again.',
      );
      return true;
    });
  });

  it('does nothing when no file is chosen', async () => {
    const { run, received } = setup(null);
    assert.deepEqual(await run(), { status: 'cancelled' });
    assert.deepEqual(received, []);
  });

  it('refuses a file that is not an export', async () => {
    const notJson = join(dir(), 'notes.json');
    await writeFile(notJson, 'not json');
    await assert.rejects(setup(notJson).run(), /isn’t a meetings export/);

    const otherJson = join(dir(), 'other.json');
    await writeFile(otherJson, '{"format":"other"}');
    await assert.rejects(setup(otherJson).run(), /isn’t a meetings export/);
  });

  it('refuses a file too large to be an export without reading it', async () => {
    const file = join(dir(), 'huge.json');
    await writeFile(file, '');
    await truncate(file, 100 * 1024 * 1024 + 1);
    await assert.rejects(setup(file).run(), /too large/);
  });

  it('runs one import at a time', async () => {
    const { run, holdChoice } = setup(null);
    const release = holdChoice();
    const first = run();
    await assert.rejects(run(), /already being imported/);
    release();
    assert.deepEqual(await first, { status: 'cancelled' });
    assert.deepEqual(await run(), { status: 'cancelled' });
  });
});
