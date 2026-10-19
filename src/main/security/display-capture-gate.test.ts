import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createDisplayCaptureGate } from './display-capture-gate.ts';

describe('createDisplayCaptureGate', () => {
  it('stays shut until the app opens it', () => {
    const gate = createDisplayCaptureGate(() => 1000, 5000);
    assert.equal(gate.pass(), false);
  });

  it('lets exactly one request through after opening', () => {
    const gate = createDisplayCaptureGate(() => 1000, 5000);
    gate.open();
    assert.equal(gate.pass(), true);
    assert.equal(gate.pass(), false);
  });

  it('shuts again once the window has passed', () => {
    let time = 1000;
    const gate = createDisplayCaptureGate(() => time, 5000);
    gate.open();
    time = 6000;
    assert.equal(gate.pass(), false);
  });

  it('is still open just before the window ends', () => {
    let time = 1000;
    const gate = createDisplayCaptureGate(() => time, 5000);
    gate.open();
    time = 5999;
    assert.equal(gate.pass(), true);
  });
});
