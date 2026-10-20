import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { meetingApp, recordingTitle } from './apps.ts';

describe('recognising a meeting app', () => {
  it('knows apps by macOS bundle id, including their helper processes', () => {
    assert.deepEqual(meetingApp('us.zoom.xos'), {
      key: 'zoom',
      name: 'Zoom',
      kind: 'call',
    });
    assert.equal(meetingApp('com.google.Chrome.helper')?.key, 'chrome');
    assert.equal(meetingApp('com.microsoft.teams2')?.key, 'teams');
    assert.equal(meetingApp('com.apple.WebKit.GPU')?.key, 'safari');
    assert.equal(meetingApp('com.apple.avconferenced')?.key, 'facetime');
  });

  it('knows apps by Windows executable path', () => {
    assert.equal(
      meetingApp('C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe')?.key,
      'zoom',
    );
    assert.equal(
      meetingApp('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        ?.key,
      'chrome',
    );
    assert.equal(meetingApp('C:#Program Files#ms-teams.exe')?.key, 'teams');
    assert.equal(meetingApp('MSTeams_8wekyb3d8bbwe')?.key, 'teams');
  });

  it('knows apps by the name Linux audio servers report', () => {
    assert.equal(meetingApp('ZOOM VoiceEngine')?.key, 'zoom');
    assert.equal(meetingApp('/usr/lib/firefox/firefox')?.key, 'firefox');
    assert.equal(meetingApp('WEBRTC VoiceEngine')?.key, 'chrome');
  });

  it('ignores apps people do not hold calls in', () => {
    assert.equal(meetingApp('com.apple.VoiceMemos'), null);
    assert.equal(
      meetingApp('com.apple.SpeechRecognitionCore.speechrecognitiond'),
      null,
    );
    assert.equal(meetingApp('com.google.Chromecast'), null);
    assert.equal(meetingApp('C:#Tools#ZoomIt.exe'), null);
    assert.equal(meetingApp('  '), null);
  });

  it('names the recording after the app, or plainly for a browser', () => {
    assert.equal(
      recordingTitle({ key: 'zoom', name: 'Zoom', kind: 'call' }),
      'Zoom meeting',
    );
    assert.equal(
      recordingTitle({ key: 'chrome', name: 'Chrome', kind: 'browser' }),
      'Meeting',
    );
  });
});
