import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatBytes } from './format-bytes.ts';

describe('formatBytes', () => {
  it('uses decimal units, as macOS and download pages do', () => {
    assert.equal(formatBytes(999), '999 B');
    assert.equal(formatBytes(1000), '1 KB');
    assert.equal(formatBytes(374_909_000), '375 MB');
  });

  it('keeps one decimal for small megabyte and gigabyte values', () => {
    assert.equal(formatBytes(6_355_277), '6.4 MB');
    assert.equal(formatBytes(1_036_613_791), '1.0 GB');
  });

  it('stops at gigabytes', () => {
    assert.equal(formatBytes(2_500_000_000_000), '2500 GB');
  });
});
