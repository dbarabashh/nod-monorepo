import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { displayName } from './display-name.ts';

describe('displayName', () => {
  it('drops bidi overrides and zero-width characters, and flattens line breaks', () => {
    assert.equal(displayName('Road‮pam‬'), 'Roadpam');
    assert.equal(displayName('⁧Sam⁩'), 'Sam');
    assert.equal(displayName('A​‍b﻿'), 'Ab');
    assert.equal(displayName(' Sam\n\nOlga x\t'), 'Sam Olga x');
    assert.equal(displayName('​'), '');
  });

  it('keeps ordinary names as they are', () => {
    assert.equal(displayName('Équipe “Été” 2026'), 'Équipe “Été” 2026');
  });
});
