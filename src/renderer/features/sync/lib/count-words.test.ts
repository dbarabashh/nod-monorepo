import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { countWords } from './count-words.ts';

describe('counting the words of a recovery phrase', () => {
  it('counts words however they were written down', () => {
    assert.equal(countWords(''), 0);
    assert.equal(countWords('  apple  river '), 2);
    assert.equal(countWords('1. Apple,\n2. river\n3) STONE'), 3);
  });
});
