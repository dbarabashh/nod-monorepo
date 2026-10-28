import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { describeUpdate, updateToShow } from './describe.ts';

const time = (at: number) => `t${at}`;
const base = { current: '1.2.0', checkedAt: null };

describe('describeUpdate', () => {
  it('names the running version before the first check', () => {
    assert.equal(
      describeUpdate({ ...base, status: 'idle', error: null }, time),
      'This is Nod 1.2.0.',
    );
  });

  it('says when it last found nothing newer', () => {
    assert.equal(
      describeUpdate(
        { ...base, checkedAt: 5, status: 'idle', error: null },
        time,
      ),
      'Nod 1.2.0 is the latest version. Checked at t5.',
    );
  });

  it('shows a failed check instead of claiming to be up to date', () => {
    assert.equal(
      describeUpdate(
        { ...base, checkedAt: 5, status: 'idle', error: 'Offline.' },
        time,
      ),
      'Offline.',
    );
  });
});

describe('updateToShow', () => {
  it('surfaces only an update the user can act on', () => {
    assert.equal(
      updateToShow({ ...base, status: 'ready', version: '1.3.0' }),
      '1.3.0',
    );
    assert.equal(
      updateToShow({ ...base, status: 'available', version: '1.3.0' }),
      '1.3.0',
    );
    assert.equal(
      updateToShow({ ...base, status: 'downloading', version: '1.3.0' }),
      null,
    );
    assert.equal(updateToShow({ ...base, status: 'checking' }), null);
  });
});
