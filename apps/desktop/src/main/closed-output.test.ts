import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { ignoreClosedOutput } from './closed-output.ts';

function failure(code: string): Error {
  return Object.assign(new Error(`write ${code}`), { code });
}

describe('ignoreClosedOutput', () => {
  it('keeps running when the terminal it writes to has closed', () => {
    const output = new EventEmitter();
    ignoreClosedOutput([output]);
    assert.doesNotThrow(() => output.emit('error', failure('EPIPE')));
  });

  it('still reports any other output error', () => {
    const output = new EventEmitter();
    ignoreClosedOutput([output]);
    assert.throws(() => output.emit('error', failure('ENOSPC')), /ENOSPC/);
  });
});
