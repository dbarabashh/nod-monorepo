import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { MeetingApp } from './apps.ts';
import {
  dismissSuggestion,
  nextSuggestion,
  noSuggestion,
  type Detection,
  type SuggestionState,
} from './suggestion.ts';

const zoom: MeetingApp = { key: 'zoom', name: 'Zoom', kind: 'call' };
const chrome: MeetingApp = { key: 'chrome', name: 'Chrome', kind: 'browser' };
const hold = 2_000;

function detection(apps: MeetingApp[], change: Partial<Detection> = {}) {
  return {
    apps,
    recording: false,
    enabled: true,
    muted: new Set<string>(),
    ...change,
  };
}

function step(
  state: SuggestionState,
  apps: MeetingApp[],
  now: number,
  change: Partial<Detection> = {},
) {
  return nextSuggestion(state, detection(apps, change), now, hold);
}

describe('suggesting to take notes', () => {
  it('waits until the app has held the microphone for a moment', () => {
    const first = step(noSuggestion, [zoom], 1_000);
    assert.equal(first.state.showing, null);
    assert.equal(first.checkAt, 3_000);

    const early = step(first.state, [zoom], 2_999);
    assert.equal(early.state.showing, null);

    const ready = step(early.state, [zoom], 3_000);
    assert.deepEqual(ready.state.showing, zoom);
    assert.equal(ready.checkAt, null);
  });

  it('does not suggest a short use of the microphone', () => {
    const first = step(noSuggestion, [zoom], 1_000);
    const released = step(first.state, [], 2_500);
    const later = step(released.state, [], 10_000);
    assert.equal(later.state.showing, null);
    assert.equal(later.checkAt, null);
  });

  it('suggests once per call and again after the microphone was let go', () => {
    let state = step(noSuggestion, [zoom], 0).state;
    state = step(state, [zoom], 2_000).state;
    assert.deepEqual(state.showing, zoom);
    state = dismissSuggestion(state);
    state = step(state, [zoom], 60_000).state;
    assert.equal(state.showing, null);

    state = step(state, [], 61_000).state;
    state = step(state, [zoom], 62_000).state;
    state = step(state, [zoom], 64_000).state;
    assert.deepEqual(state.showing, zoom);
  });

  it('hides the suggestion when the call ends', () => {
    let state = step(noSuggestion, [zoom], 0).state;
    state = step(state, [zoom], 2_000).state;
    state = step(state, [], 5_000).state;
    assert.equal(state.showing, null);
  });

  it('prefers a call app over a browser holding the microphone too', () => {
    let state = step(noSuggestion, [chrome, zoom], 0).state;
    state = step(state, [chrome, zoom], 2_000).state;
    assert.deepEqual(state.showing, zoom);
  });

  it('stays quiet while recording, and for that call afterwards', () => {
    let state = step(noSuggestion, [zoom], 0, { recording: true }).state;
    state = step(state, [zoom], 5_000, { recording: true }).state;
    assert.equal(state.showing, null);
    const after = step(state, [zoom], 9_000);
    assert.equal(after.state.showing, null);
    assert.equal(after.checkAt, null);
  });

  it('never suggests a muted app or when suggestions are off', () => {
    const muted = new Set(['zoom']);
    let state = step(noSuggestion, [zoom], 0, { muted }).state;
    state = step(state, [zoom], 5_000, { muted }).state;
    assert.equal(state.showing, null);

    state = step(noSuggestion, [zoom], 0, { enabled: false }).state;
    state = step(state, [zoom], 5_000, { enabled: false }).state;
    assert.equal(state.showing, null);
  });

  it('takes a suggestion away when its app is muted while it shows', () => {
    let state = step(noSuggestion, [zoom], 0).state;
    state = step(state, [zoom], 2_000).state;
    state = step(state, [zoom], 3_000, { muted: new Set(['zoom']) }).state;
    assert.equal(state.showing, null);
  });
});
