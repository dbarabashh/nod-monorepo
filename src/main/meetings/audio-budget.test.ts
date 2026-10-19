import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createAudioBudget } from './audio-budget.ts';

describe('createAudioBudget', () => {
  function setup() {
    let time = 0;
    const budget = createAudioBudget({
      now: () => time,
      samplesPerSecond: 100,
      burstSeconds: 2,
    });
    return { budget, advance: (ms: number) => (time += ms) };
  }

  it('admits audio sent at the rate it is captured', () => {
    const { budget, advance } = setup();
    for (let second = 0; second < 10; second += 1) {
      advance(1_000);
      assert.equal(budget.admit(100), true);
    }
  });

  it('refuses a flood beyond the burst, then recovers with time', () => {
    const { budget, advance } = setup();
    assert.equal(budget.admit(150), true);
    assert.equal(budget.admit(50), true);
    assert.equal(budget.admit(1), false);
    advance(500);
    assert.equal(budget.admit(50), true);
    assert.equal(budget.admit(1), false);
  });

  it('never saves up more than the burst while idle', () => {
    const { budget, advance } = setup();
    advance(60_000);
    assert.equal(budget.admit(201), false);
    assert.equal(budget.admit(200), true);
  });

  it('treats a clock that went backwards as no time passing', () => {
    const { budget, advance } = setup();
    assert.equal(budget.admit(200), true);
    advance(-60_000);
    assert.equal(budget.admit(1), false);
    advance(1_000);
    assert.equal(budget.admit(100), true);
  });
});
