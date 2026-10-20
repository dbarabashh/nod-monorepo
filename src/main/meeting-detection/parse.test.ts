import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseHelperLine, parsePactl, parseRegistry } from './parse.ts';

describe('reading who uses the microphone', () => {
  it('reads the macOS helper lines', () => {
    assert.equal(parseHelperLine('idle'), null);
    assert.deepEqual(
      parseHelperLine('active 812:us.zoom.xos 99:com.google.Chrome.helper'),
      [
        { pid: 812, id: 'us.zoom.xos' },
        { pid: 99, id: 'com.google.Chrome.helper' },
      ],
    );
    assert.deepEqual(parseHelperLine('active 12:'), [{ pid: 12, id: '' }]);
    assert.deepEqual(parseHelperLine('active'), []);
    assert.equal(parseHelperLine('garbage'), undefined);
    assert.equal(parseHelperLine(''), undefined);
  });

  it('reads recording streams from pactl, skipping paused ones', () => {
    const text = `Source Output #41
\tDriver: protocol-native.c
\tCorked: no
\tProperties:
\t\tapplication.name = "ZOOM VoiceEngine"
\t\tapplication.process.id = "4410"
\t\tapplication.process.binary = "zoom"

Source Output #42
\tCorked: yes
\tProperties:
\t\tapplication.name = "Firefox"
\t\tapplication.process.id = "5120"

Source Output #43
\tCorked: no
\tProperties:
\t\tapplication.name = "Google Chrome"
`;
    assert.deepEqual(parsePactl(text), [
      { pid: 4410, id: 'zoom' },
      { pid: null, id: 'Google Chrome' },
    ]);
    assert.equal(parsePactl(''), null);
    assert.equal(parsePactl('Source Output #1\n\tCorked: yes\n'), null);
  });

  it('reads the apps Windows says are using the microphone now', () => {
    const text = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone',
      '    Value    REG_SZ    Allow',
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe',
      '    LastUsedTimeStart    REG_QWORD    0x1db3f2a8c4e0000',
      '    LastUsedTimeStop    REG_QWORD    0x0',
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe',
      '    LastUsedTimeStart    REG_QWORD    0x1db3f2a8c4e0000',
      '    LastUsedTimeStop    REG_QWORD    0x1db3f2b0c4e0000',
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\MSTeams_8wekyb3d8bbwe',
      '    LastUsedTimeStart    REG_QWORD    0x1db3f2a8c4e0000',
      '    LastUsedTimeStop    REG_QWORD    0x0',
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Never#used.exe',
      '    LastUsedTimeStart    REG_QWORD    0x0',
      '    LastUsedTimeStop    REG_QWORD    0x0',
    ].join('\r\n');
    assert.deepEqual(parseRegistry(text), [
      { pid: null, id: 'C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe' },
      { pid: null, id: 'MSTeams_8wekyb3d8bbwe' },
    ]);
    assert.equal(parseRegistry(''), null);
  });
});
