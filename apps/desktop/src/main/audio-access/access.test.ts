import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  audioSettingsUrl,
  describeAudioAccess,
  isAudioSource,
} from './access.ts';

describe('describeAudioAccess', () => {
  it('offers the macOS prompt only before the user has decided', () => {
    assert.deepEqual(
      describeAudioAccess('darwin', 'not-determined').microphone,
      {
        status: 'not-determined',
        canRequest: true,
        canOpenSettings: true,
      },
    );
    assert.deepEqual(describeAudioAccess('darwin', 'denied').microphone, {
      status: 'denied',
      canRequest: false,
      canOpenSettings: true,
    });
  });

  it('sends nobody to settings for a macOS restriction they cannot change', () => {
    assert.deepEqual(describeAudioAccess('darwin', 'restricted').microphone, {
      status: 'restricted',
      canRequest: false,
      canOpenSettings: false,
    });
  });

  it('reports macOS system audio as unknown, since no API can read it', () => {
    assert.deepEqual(describeAudioAccess('darwin', 'granted')['system-audio'], {
      status: 'unknown',
      canRequest: false,
      canOpenSettings: true,
    });
  });

  it('never prompts on Windows, where the privacy switch lives in Settings', () => {
    assert.deepEqual(describeAudioAccess('win32', 'denied'), {
      microphone: {
        status: 'denied',
        canRequest: false,
        canOpenSettings: true,
      },
      'system-audio': {
        status: 'not-required',
        canRequest: false,
        canOpenSettings: false,
      },
    });
  });

  it('needs no OS permission on Linux, whatever the reported status', () => {
    const none = {
      status: 'not-required',
      canRequest: false,
      canOpenSettings: false,
    };
    assert.deepEqual(describeAudioAccess('linux', 'denied'), {
      microphone: none,
      'system-audio': none,
    });
  });
});

describe('audioSettingsUrl', () => {
  it('opens the matching macOS privacy pane', () => {
    assert.equal(
      audioSettingsUrl('darwin', 'microphone'),
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    );
    assert.equal(
      audioSettingsUrl('darwin', 'system-audio'),
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture',
    );
  });

  it('has a Windows page for the microphone only', () => {
    assert.equal(
      audioSettingsUrl('win32', 'microphone'),
      'ms-settings:privacy-microphone',
    );
    assert.equal(audioSettingsUrl('win32', 'system-audio'), null);
  });

  it('has nothing to open on Linux', () => {
    assert.equal(audioSettingsUrl('linux', 'microphone'), null);
  });
});

describe('isAudioSource', () => {
  it('accepts only the two known sources', () => {
    assert.equal(isAudioSource('microphone'), true);
    assert.equal(isAudioSource('system-audio'), true);
    assert.equal(isAudioSource('camera'), false);
    assert.equal(isAudioSource(undefined), false);
    assert.equal(isAudioSource({ toString: () => 'microphone' }), false);
  });
});
