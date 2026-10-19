import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';
import { createSyncScheduler } from './scheduler.ts';

describe('sync scheduler', () => {
  it('ignores changes until it was started, so a failed load never syncs', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let rounds = 0;
      const scheduler = createSyncScheduler({
        refresh: async () => {
          rounds += 1;
        },
        idleDelayMs: () => 60_000,
      });
      scheduler.soon();
      mock.timers.tick(10_000);
      await Promise.resolve();
      assert.equal(rounds, 0);

      scheduler.start();
      mock.timers.tick(0);
      await Promise.resolve();
      assert.equal(rounds, 1);
      scheduler.stop();
    } finally {
      mock.timers.reset();
    }
  });
});
