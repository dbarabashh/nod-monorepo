import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { publishedLogFile } from './published-log.ts';

describe('published log file', () => {
  it('names a file the filesystem takes for any scope, and another for another scope', () => {
    const scope = 'vault-a:device-1:https://relay.example.com/';
    assert.equal(
      publishedLogFile(scope),
      'd956012e10abccd20527e473f6b682bd.json',
    );
    assert.equal(
      publishedLogFile(`shares:${scope}`),
      'f742e81866f3cc040c61d095bab2a419.json',
    );
  });
});
