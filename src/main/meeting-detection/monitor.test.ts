import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';
import type { MicUse } from './parse.ts';
import { respawning } from './monitor.ts';

describe('keeping a watcher running', () => {
  it('starts it again after it exits, waiting longer each time', (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    const exits: Array<(missing: boolean) => void> = [];
    const reports: MicUse[] = [];
    let kills = 0;
    const stop = respawning((_onChange, onExit) => {
      exits.push(onExit);
      return () => {
        kills += 1;
      };
    })((use) => reports.push(use));

    assert.equal(exits.length, 1);
    exits[0]?.(false);
    assert.deepEqual(reports, [null]);
    mock.timers.tick(4_999);
    assert.equal(exits.length, 1);
    mock.timers.tick(1);
    assert.equal(exits.length, 2);

    exits[1]?.(false);
    mock.timers.tick(9_999);
    assert.equal(exits.length, 2);
    mock.timers.tick(1);
    assert.equal(exits.length, 3);

    stop();
    assert.equal(kills, 3);
    exits[2]?.(false);
    mock.timers.tick(120_000);
    assert.equal(exits.length, 3);
  });

  it('waits only briefly again after a watcher ran for a long time', (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    const exits: Array<(missing: boolean) => void> = [];
    respawning((_onChange, onExit) => {
      exits.push(onExit);
      return () => {};
    })(() => {});
    exits[0]?.(false);
    mock.timers.tick(5_000);
    exits[1]?.(false);
    mock.timers.tick(10_000);
    mock.timers.tick(120_000);
    exits[2]?.(false);
    mock.timers.tick(5_000);
    assert.equal(exits.length, 4);
  });

  it('does not try again when the program is not there', (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    const exits: Array<(missing: boolean) => void> = [];
    const reports: MicUse[] = [];
    respawning((_onChange, onExit) => {
      exits.push(onExit);
      return () => {};
    })((use) => reports.push(use));
    exits[0]?.(true);
    mock.timers.tick(600_000);
    assert.equal(exits.length, 1);
    assert.deepEqual(reports, [null]);
  });

  it('starts again once when a watcher reports its end twice', (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.after(() => mock.timers.reset());
    const exits: Array<(missing: boolean) => void> = [];
    const reports: MicUse[] = [];
    respawning((_onChange, onExit) => {
      exits.push(onExit);
      return () => {};
    })((use) => reports.push(use));
    exits[0]?.(false);
    exits[0]?.(false);
    mock.timers.tick(60_000);
    assert.equal(exits.length, 2);
    assert.deepEqual(reports, [null]);
  });
});
