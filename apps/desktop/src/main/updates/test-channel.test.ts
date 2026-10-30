import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { pickTestRelease } from './test-channel.ts';

describe('pickTestRelease', () => {
  const release = (tag_name: string, draft = false) => ({ tag_name, draft });

  it('takes the newest desktop release, test or not', () => {
    assert.equal(
      pickTestRelease([
        release('desktop-v1.2.0'),
        release('desktop-test-v1.3.0'),
        release('relay-v9.0.0'),
        release('desktop-v1.10.0', true),
      ]),
      'desktop-test-v1.3.0',
    );
  });

  it('prefers the release over the test release of the same version', () => {
    assert.equal(
      pickTestRelease([
        release('desktop-test-v1.3.0'),
        release('desktop-v1.3.0'),
      ]),
      'desktop-v1.3.0',
    );
    assert.equal(
      pickTestRelease([
        release('desktop-v1.3.0'),
        release('desktop-test-v1.3.0'),
      ]),
      'desktop-v1.3.0',
    );
  });

  it('ignores anything it can’t read', () => {
    assert.equal(pickTestRelease({}), null);
    assert.equal(
      pickTestRelease([
        null,
        { tag_name: 'desktop-v1.4.0' },
        release('desktop-v1.4.0-beta.1'),
        release('desktop-vx'),
      ]),
      null,
    );
  });
});
