import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  isAllowedDisplayMediaRequest,
  isAllowedPermissionCheck,
  isAllowedPermissionRequest,
} from './permissions.ts';

const appUrl = 'http://localhost:5173/';

describe('isAllowedPermissionRequest', () => {
  const audio = {
    permission: 'media',
    requestingUrl: 'http://localhost:5173/index.html',
    isMainFrame: true,
    mediaTypes: ['audio'],
  };

  it('allows audio-only media for the app page', () => {
    assert.equal(
      isAllowedPermissionRequest(audio, appUrl, () => false),
      true,
    );
  });

  it('refuses video, even together with audio', () => {
    assert.equal(
      isAllowedPermissionRequest(
        { ...audio, mediaTypes: ['audio', 'video'] },
        appUrl,
        () => false,
      ),
      false,
    );
    assert.equal(
      isAllowedPermissionRequest(
        { ...audio, mediaTypes: ['video'] },
        appUrl,
        () => false,
      ),
      false,
    );
  });

  it('spends the screen-capture gate only on requests that pass every other check', () => {
    let calls = 0;
    const pass = () => {
      calls += 1;
      return true;
    };
    isAllowedPermissionRequest(
      { ...audio, mediaTypes: [], requestingUrl: 'https://example.com/' },
      appUrl,
      pass,
    );
    isAllowedPermissionRequest(
      { ...audio, mediaTypes: [], isMainFrame: false },
      appUrl,
      pass,
    );
    isAllowedPermissionRequest(audio, appUrl, pass);
    assert.equal(calls, 0);
  });

  it('allows screen capture, which names no media type, only when the app expects it', () => {
    const screen = { ...audio, mediaTypes: [] };
    assert.equal(
      isAllowedPermissionRequest(screen, appUrl, () => true),
      true,
    );
    assert.equal(
      isAllowedPermissionRequest(screen, appUrl, () => false),
      false,
    );
  });

  it('never lets an expected screen capture widen an audio or video request', () => {
    assert.equal(
      isAllowedPermissionRequest(
        { ...audio, mediaTypes: ['video'] },
        appUrl,
        () => true,
      ),
      false,
    );
    assert.equal(
      isAllowedPermissionRequest(
        { ...audio, mediaTypes: [], requestingUrl: 'https://example.com/' },
        appUrl,
        () => true,
      ),
      false,
    );
  });

  it('refuses other origins and subframes', () => {
    assert.equal(
      isAllowedPermissionRequest(
        { ...audio, requestingUrl: 'https://example.com/' },
        appUrl,
        () => false,
      ),
      false,
    );
    assert.equal(
      isAllowedPermissionRequest(
        { ...audio, isMainFrame: false },
        appUrl,
        () => false,
      ),
      false,
    );
  });

  it('refuses every other permission', () => {
    for (const permission of [
      'notifications',
      'geolocation',
      'display-capture',
      'clipboard-read',
    ]) {
      assert.equal(
        isAllowedPermissionRequest(
          { ...audio, permission },
          appUrl,
          () => false,
        ),
        false,
      );
    }
  });
});

describe('isAllowedPermissionCheck', () => {
  const check = {
    permission: 'media',
    requestingUrl: 'http://localhost:5173/',
    isMainFrame: true,
    mediaType: 'audio',
  };

  it('answers yes only for audio from the app page', () => {
    assert.equal(isAllowedPermissionCheck(check, appUrl), true);
    assert.equal(
      isAllowedPermissionCheck({ ...check, isMainFrame: false }, appUrl),
      false,
    );
    assert.equal(
      isAllowedPermissionCheck({ ...check, mediaType: 'video' }, appUrl),
      false,
    );
    assert.equal(
      isAllowedPermissionCheck({ ...check, mediaType: undefined }, appUrl),
      false,
    );
    assert.equal(
      isAllowedPermissionCheck(
        { ...check, requestingUrl: 'https://example.com/' },
        appUrl,
      ),
      false,
    );
    assert.equal(
      isAllowedPermissionCheck(
        { ...check, permission: 'notifications' },
        appUrl,
      ),
      false,
    );
  });
});

describe('isAllowedDisplayMediaRequest', () => {
  const request = {
    audioRequested: true,
    userGesture: true,
    isMainFrame: true,
    frameUrl: 'http://localhost:5173/',
  };

  it('allows system audio for the app page after a user action', () => {
    assert.equal(isAllowedDisplayMediaRequest(request, appUrl), true);
  });

  it('refuses a capture without audio, without a click, or from elsewhere', () => {
    assert.equal(
      isAllowedDisplayMediaRequest(
        { ...request, audioRequested: false },
        appUrl,
      ),
      false,
    );
    assert.equal(
      isAllowedDisplayMediaRequest({ ...request, userGesture: false }, appUrl),
      false,
    );
    assert.equal(
      isAllowedDisplayMediaRequest({ ...request, frameUrl: undefined }, appUrl),
      false,
    );
    assert.equal(
      isAllowedDisplayMediaRequest({ ...request, isMainFrame: false }, appUrl),
      false,
    );
    assert.equal(
      isAllowedDisplayMediaRequest(
        { ...request, frameUrl: 'https://example.com/' },
        appUrl,
      ),
      false,
    );
  });
});
