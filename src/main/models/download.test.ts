import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { useTempDir } from '../testing/temp-dir.ts';
import { ChecksumError, downloadFile, type Fetch } from './download.ts';
import { stallingFetch } from '../testing/fake-fetch.ts';

const content = Buffer.from('0123456789abcdefghij');
const sha256 = createHash('sha256').update(content).digest('hex');

type Call = { range: string | undefined };

function server(options: { ignoreRange?: boolean; body?: Buffer } = {}) {
  const calls: Call[] = [];
  const body = options.body ?? content;
  const fetch: Fetch = async (_url, init) => {
    const range = init.headers.Range;
    calls.push({ range });
    const match = /^bytes=(\d+)-$/.exec(range ?? '');
    if (match && !options.ignoreRange) {
      return new Response(new Uint8Array(body.subarray(Number(match[1]))), {
        status: 206,
      });
    }
    return new Response(new Uint8Array(body), { status: 200 });
  };
  return { fetch, calls };
}

describe('downloadFile', () => {
  const dir = useTempDir('download-');
  let destination: string;

  beforeEach(() => {
    destination = join(dir(), 'model.bin');
  });

  function run(
    fetch: Fetch,
    progress: number[] = [],
    signal = new AbortController().signal,
  ) {
    return downloadFile({
      url: 'https://example.test/model.bin',
      sizeBytes: content.length,
      sha256,
      destination,
      fetch,
      signal,
      onProgress: (bytes) => progress.push(bytes),
    });
  }

  it('downloads, verifies and moves the file into place', async () => {
    const { fetch, calls } = server();
    const progress: number[] = [];
    await run(fetch, progress);
    assert.deepEqual(await readFile(destination), content);
    assert.deepEqual(await readdir(dir()), ['model.bin']);
    assert.deepEqual(calls, [{ range: undefined }]);
    assert.equal(progress.at(-1), 20);
  });

  it('resumes from a partial file with a range request', async () => {
    await writeFile(`${destination}.partial`, content.subarray(0, 8));
    const { fetch, calls } = server();
    await run(fetch);
    assert.deepEqual(await readFile(destination), content);
    assert.deepEqual(calls, [{ range: 'bytes=8-' }]);
  });

  it('starts over when the server ignores the range', async () => {
    await writeFile(`${destination}.partial`, content.subarray(0, 8));
    const { fetch } = server({ ignoreRange: true });
    await run(fetch);
    assert.deepEqual(await readFile(destination), content);
  });

  it('rejects and removes a file that does not match the checksum', async () => {
    const tampered = Buffer.from(content);
    tampered[3] = 0;
    const { fetch } = server({ body: tampered });
    await assert.rejects(run(fetch), ChecksumError);
    assert.deepEqual(await readdir(dir()), []);
  });

  it('skips the network when the verified file is already there', async () => {
    await writeFile(destination, content);
    const { fetch, calls } = server();
    await run(fetch);
    assert.deepEqual(calls, []);
  });

  it('fails on an HTTP error without keeping anything', async () => {
    const fetch: Fetch = async () => new Response('missing', { status: 404 });
    await assert.rejects(run(fetch), /HTTP 404/);
    assert.deepEqual(await readdir(dir()), []);
  });

  it('keeps a consistent partial file when paused mid-stream and resumes from it', async () => {
    const controller = new AbortController();
    const { fetch: stalling, started } = stallingFetch(
      new Uint8Array(content.subarray(0, 8)),
    );
    const paused = run(stalling, [], controller.signal);
    await started;
    controller.abort();
    await assert.rejects(paused);
    assert.deepEqual(
      await readFile(`${destination}.partial`),
      content.subarray(0, 8),
    );

    const { fetch, calls } = server();
    await run(fetch);
    assert.deepEqual(await readFile(destination), content);
    assert.deepEqual(calls, [{ range: 'bytes=8-' }]);
  });

  it('verifies a complete partial file without asking the server again', async () => {
    await writeFile(`${destination}.partial`, content);
    const { fetch, calls } = server();
    await run(fetch);
    assert.deepEqual(await readFile(destination), content);
    assert.deepEqual(calls, []);
  });

  it('fails cleanly, without hanging, when the file cannot be written', async () => {
    destination = join(dir(), 'missing', 'model.bin');
    const { fetch } = server();
    await assert.rejects(run(fetch), { code: 'ENOENT' });
  });
});
