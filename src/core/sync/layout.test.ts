import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  meetingPath,
  pairingPath,
  parseMeetingPath,
  parsePairingPath,
} from './layout.ts';

describe('sync layout', () => {
  it('reads back the device and meeting from a meeting file path', () => {
    assert.equal(meetingPath('dev-1', 'm-1'), 'devices/dev-1/meetings/m-1.bin');
    assert.deepEqual(parseMeetingPath(meetingPath('dev-1', 'm-1')), {
      deviceId: 'dev-1',
      meetingId: 'm-1',
    });
    assert.deepEqual(parsePairingPath(pairingPath('r1', 'offer')), {
      requestId: 'r1',
      step: 'offer',
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
    assert.equal(parsePairingPath('pairing/r1/steal.json'), null);
    assert.equal(parsePairingPath('pairing/../grant.json'), null);
  });
});
