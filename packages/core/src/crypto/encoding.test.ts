import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { fromBase64Url, toBase64Url } from './encoding.ts';

describe('base64url', () => {
  it('reads back lengths that need no, one or two padding characters', () => {
    assert.deepEqual([...fromBase64Url('AQID')], [1, 2, 3]);
    assert.deepEqual([...fromBase64Url('AQIDBA')], [1, 2, 3, 4]);
    assert.deepEqual([...fromBase64Url('AQIDBAU')], [1, 2, 3, 4, 5]);
    assert.deepEqual([...fromBase64Url('')], []);
    assert.deepEqual([...fromBase64Url('_-8')], [255, 239]);
  });

  it('writes without padding and with the url alphabet', () => {
    assert.equal(toBase64Url(Uint8Array.of(1, 2, 3, 4)), 'AQIDBA');
    assert.equal(toBase64Url(Uint8Array.of(255, 239)), '_-8');
  });

  it('refuses a length no encoding produces', () => {
    assert.throws(() => fromBase64Url('AQIDB'));
  });
});
