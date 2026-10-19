import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseAppState } from './app-state.ts';

describe('parseAppState', () => {
  it('reads a completed onboarding', () => {
    assert.deepEqual(parseAppState({ onboardingCompleted: true }), {
      onboardingCompleted: true,
    });
  });

  it('starts onboarding again when the file is missing or unreadable', () => {
    for (const raw of [undefined, null, 'true', 42, []]) {
      assert.deepEqual(parseAppState(raw), { onboardingCompleted: false });
    }
  });

  it('accepts only a real true, so a damaged value never skips onboarding', () => {
    for (const value of ['true', 1, 'yes', {}]) {
      assert.deepEqual(parseAppState({ onboardingCompleted: value }), {
        onboardingCompleted: false,
      });
    }
  });

  it('drops keys it does not know', () => {
    assert.deepEqual(parseAppState({ onboardingCompleted: true, extra: 'x' }), {
      onboardingCompleted: true,
    });
  });
});
