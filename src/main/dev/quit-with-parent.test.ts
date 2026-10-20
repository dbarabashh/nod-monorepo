import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { processAlive, quitWithParent } from './quit-with-parent.ts';

describe('quitting with the parent process', () => {
  it('quits once, when the parent is gone', () => {
    let tick = () => {};
    let stopped = false;
    let parentAlive = true;
    let quits = 0;
    quitWithParent({
      parent: 42,
      isAlive: (pid) => pid === 42 && parentAlive,
      every: (callback) => {
        tick = callback;
        return () => {
          stopped = true;
        };
      },
      quit: () => {
        quits += 1;
      },
    });

    tick();
    assert.equal(quits, 0);
    parentAlive = false;
    tick();
    assert.equal(quits, 1);
    assert.equal(stopped, true);
  });

  it('tells a running process from one that is gone', () => {
    assert.equal(processAlive(process.pid), true);
    assert.equal(processAlive(2 ** 22 + 12_345), false);
  });
});
