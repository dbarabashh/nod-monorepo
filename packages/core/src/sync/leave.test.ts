import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { removePublishedFiles } from './leave.ts';
import { createMemoryTransport } from './testing/index.ts';
import { RequestRefused, type Transport } from './transport.ts';

function refusing(status: number): Transport & { removed: string[] } {
  const memory = createMemoryTransport();
  const removed: string[] = [];
  return {
    ...memory,
    removed,
    remove: async (path) => {
      if (path.endsWith('shares.bin')) {
        throw new RequestRefused(`The relay answered ${status}`, status);
      }
      removed.push(path);
    },
  };
}

describe('leaving a vault', () => {
  it('removes the meetings this device still holds and its shares list', async () => {
    const memory = createMemoryTransport();
    for (const path of [
      'devices/d1/meetings/m-1.bin',
      'devices/d1/meetings/m-2.bin',
      'devices/d1/shares.bin',
      'devices/d2/meetings/m-3.bin',
    ]) {
      await memory.write(path, new Uint8Array([1]));
    }
    await removePublishedFiles(memory, 'd1', ['m-1']);
    assert.deepEqual(memory.paths().sort(), [
      'devices/d1/meetings/m-2.bin',
      'devices/d2/meetings/m-3.bin',
    ]);
  });

  it('leaves a place from before sharing, which refuses the shares list path', async () => {
    const old = refusing(400);
    await removePublishedFiles(old, 'd1', ['m-1']);
    assert.deepEqual(old.removed, ['devices/d1/meetings/m-1.bin']);
    await assert.rejects(
      removePublishedFiles(refusing(403), 'd1', []),
      /answered 403/,
    );
  });
});
