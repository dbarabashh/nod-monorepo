import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  meetingPath,
  noteContext,
  notePath,
  parseMeetingPath,
  parseNotePath,
  parseSharesPath,
  sharesPath,
} from './layout.ts';

describe('sync layout', () => {
  it('reads back the device and meeting from a meeting file path', () => {
    assert.equal(meetingPath('dev-1', 'm-1'), 'devices/dev-1/meetings/m-1.bin');
    assert.deepEqual(parseMeetingPath(meetingPath('dev-1', 'm-1')), {
      deviceId: 'dev-1',
      meetingId: 'm-1',
    });
  });

  it('ignores anything else a transport lists, including paths that climb out', () => {
    for (const path of [
      'devices/dev-1/meetings/../../keys.bin',
      'devices/../meetings/m.bin',
      'devices/dev-1/meetings/m-1.bin.tmp',
      'devices/dev 1/meetings/m-1.bin',
      'vault.json',
    ]) {
      assert.equal(parseMeetingPath(path), null, path);
    }
  });
});

describe('shared vault layout', () => {
  it('names notes and the shares list, and reads only those paths back', () => {
    assert.equal(notePath('d1', 'n1'), 'devices/d1/notes/n1.bin');
    assert.deepEqual(parseNotePath('devices/d1/notes/n1.bin'), {
      deviceId: 'd1',
      noteId: 'n1',
    });
    assert.equal(sharesPath('d1'), 'devices/d1/shares.bin');
    assert.equal(parseSharesPath('devices/d1/shares.bin'), 'd1');
    assert.equal(noteContext('v', 'd1', 'n1'), 'nod:sync:v2:v:d1:n1');
    for (const path of [
      'devices/d1/meetings/n1.bin',
      'devices/d1/notes/n1.txt',
      'devices/d1/notes/closed.json',
      'devices/d1/shares.json',
      'devices/d1/notes/../shares.bin',
      'notes/n1.bin',
    ]) {
      assert.equal(parseNotePath(path), null, path);
      assert.equal(parseSharesPath(path), null, path);
    }
    assert.equal(parseMeetingPath('devices/d1/notes/n1.bin'), null);
  });
});
