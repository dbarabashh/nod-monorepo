import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { randomKey } from './aead.ts';
import {
  keyFromRecoveryPhrase,
  phraseWords,
  recoveryPhrase,
} from './recovery.ts';

describe('recovery phrase', () => {
  it('writes a key as the standard 24 words', () => {
    assert.equal(
      recoveryPhrase(new Uint8Array(32)),
      `${'abandon '.repeat(23)}art`,
    );
  });

  it('gives back the same key from the words, however they were typed', () => {
    const key = randomKey();
    const typed = `  ${recoveryPhrase(key).toUpperCase().split(' ').join('\n  ')}  `;
    assert.deepEqual(keyFromRecoveryPhrase(typed), key);
  });

  it('reads words copied with numbers, commas and line breaks', () => {
    const key = randomKey();
    const words = recoveryPhrase(key).split(' ');
    const copied = words
      .map((word, index) => `${index + 1}. ${word.toUpperCase()},`)
      .join('\n');
    assert.deepEqual(keyFromRecoveryPhrase(copied), key);
    assert.deepEqual(phraseWords(' 1) Apple,\n2.river3 '), ['apple', 'river']);
  });

  it('refuses words that are misspelt, missing or in the wrong order', () => {
    const words = recoveryPhrase(randomKey()).split(' ');
    assert.throws(
      () => keyFromRecoveryPhrase('abandon '.repeat(24).trim()),
      /not right/,
    );
    assert.throws(
      () => keyFromRecoveryPhrase(words.slice(0, 23).join(' ')),
      /not right/,
    );
    assert.throws(
      () =>
        keyFromRecoveryPhrase([...words.slice(0, 23), 'notaword'].join(' ')),
      /not right/,
    );
  });
});
