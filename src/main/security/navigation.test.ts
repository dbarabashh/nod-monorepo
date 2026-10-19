import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isAppUrl } from './navigation.ts';

describe('isAppUrl', () => {
  const devUrl = 'http://localhost:5173/';
  const fileUrl =
    'file:///Applications/App.app/renderer/main_window/index.html';

  it('allows any page on the dev server origin', () => {
    assert.equal(isAppUrl('http://localhost:5173/index.html#x', devUrl), true);
  });

  it('rejects another origin, port or scheme in dev', () => {
    assert.equal(isAppUrl('https://example.com/', devUrl), false);
    assert.equal(isAppUrl('http://localhost:5174/', devUrl), false);
    assert.equal(isAppUrl('https://localhost:5173/', devUrl), false);
  });

  it('allows only the app page itself when loaded from a file', () => {
    assert.equal(isAppUrl(`${fileUrl}#settings`, fileUrl), true);
    assert.equal(isAppUrl('file:///etc/passwd', fileUrl), false);
    assert.equal(
      isAppUrl(fileUrl.replace('file:///', 'file://share/'), fileUrl),
      false,
    );
    assert.equal(isAppUrl('https://example.com/', fileUrl), false);
  });

  it('rejects anything that is not a URL', () => {
    assert.equal(isAppUrl('not a url', devUrl), false);
    assert.equal(isAppUrl('javascript:alert(1)', fileUrl), false);
  });
});
