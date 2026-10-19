import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { AudioSourceAccess } from '../../../../shared/ipc.ts';
import { describeSource } from './source-state.ts';

function access(overrides: Partial<AudioSourceAccess>): AudioSourceAccess {
  return {
    status: 'granted',
    canRequest: false,
    canOpenSettings: true,
    ...overrides,
  };
}

describe('describeSource', () => {
  it('offers the prompt while the user has not decided yet', () => {
    assert.deepEqual(
      describeSource(
        'microphone',
        access({ status: 'not-determined', canRequest: true }),
        null,
      ),
      {
        message: 'Not allowed yet',
        attention: false,
        canRequest: true,
        canOpenSettings: false,
      },
    );
  });

  it('points to system settings once access is denied', () => {
    assert.deepEqual(
      describeSource('microphone', access({ status: 'denied' }), null),
      {
        message: 'Blocked in system settings',
        attention: true,
        canRequest: false,
        canOpenSettings: true,
      },
    );
  });

  it('treats a blocked test as denied, even when the status looked unknown', () => {
    assert.deepEqual(
      describeSource('system-audio', access({ status: 'unknown' }), 'blocked'),
      {
        message: 'Blocked. Allow it in system settings, then test again.',
        attention: true,
        canRequest: false,
        canOpenSettings: true,
      },
    );
  });

  it('does not send anyone to settings that do not exist', () => {
    assert.deepEqual(
      describeSource(
        'system-audio',
        access({ status: 'not-required', canOpenSettings: false }),
        'blocked',
      ),
      {
        message: 'Blocked by the system.',
        attention: true,
        canRequest: false,
        canOpenSettings: false,
      },
    );
  });

  it('keeps settings out of the way while access works', () => {
    assert.deepEqual(describeSource('microphone', access({}), null), {
      message: 'Allowed',
      attention: false,
      canRequest: false,
      canOpenSettings: false,
    });
  });

  it('confirms a source once a test captured it', () => {
    assert.deepEqual(
      describeSource('system-audio', access({ status: 'unknown' }), 'working'),
      {
        message: 'Working',
        attention: false,
        canRequest: false,
        canOpenSettings: false,
      },
    );
  });

  it('tells an unsupported system apart from a blocked one', () => {
    assert.deepEqual(
      describeSource(
        'system-audio',
        access({ status: 'not-required', canOpenSettings: false }),
        'unsupported',
      ),
      {
        message: "This system can't share its audio with the app yet.",
        attention: true,
        canRequest: false,
        canOpenSettings: false,
      },
    );
  });

  it('explains when macOS will ask about system audio', () => {
    assert.equal(
      describeSource('system-audio', access({ status: 'unknown' }), null)
        .message,
      'The system asks the first time you test it',
    );
  });
});
