import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseAppState } from './app-state.ts';

const fresh = {
  onboardingCompleted: false,
  suggestMeetings: true,
  quietMeetingApps: [],
};

describe('parseAppState', () => {
  it('reads a completed onboarding', () => {
    assert.deepEqual(parseAppState({ onboardingCompleted: true }), {
      ...fresh,
      onboardingCompleted: true,
    });
  });

  it('starts onboarding again when the file is missing or unreadable', () => {
    for (const raw of [undefined, null, 'true', 42, []]) {
      assert.deepEqual(parseAppState(raw), fresh);
    }
  });

  it('accepts only a real true, so a damaged value never skips onboarding', () => {
    for (const value of ['true', 1, 'yes', {}]) {
      assert.deepEqual(parseAppState({ onboardingCompleted: value }), fresh);
    }
  });

  it('drops keys it does not know', () => {
    assert.deepEqual(parseAppState({ onboardingCompleted: true, extra: 'x' }), {
      ...fresh,
      onboardingCompleted: true,
    });
  });

  it('suggests meetings unless they were turned off', () => {
    assert.equal(parseAppState({}).suggestMeetings, true);
    assert.equal(
      parseAppState({ suggestMeetings: 'no' }).suggestMeetings,
      true,
    );
    assert.equal(
      parseAppState({ suggestMeetings: false }).suggestMeetings,
      false,
    );
  });

  it('keeps only well-formed quiet apps, once each', () => {
    assert.deepEqual(
      parseAppState({
        quietMeetingApps: ['zoom', 'zoom', 'Teams', 7, '../x', 'chrome'],
      }).quietMeetingApps,
      ['zoom', 'chrome'],
    );
    assert.deepEqual(
      parseAppState({ quietMeetingApps: 'zoom' }).quietMeetingApps,
      [],
    );
  });
});
