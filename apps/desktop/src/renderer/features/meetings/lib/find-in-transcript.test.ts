import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { findInTranscript } from './find-in-transcript.ts';

const lines = [
  { id: 'a', text: 'Let us ship the release on Friday.' },
  { id: 'b', text: 'Friday works. The RELEASE notes are ready.' },
  { id: 'c', text: 'Цей реліз   буде великим, реліз!' },
];

describe('findInTranscript', () => {
  it('finds nothing for an empty or blank query', () => {
    assert.deepEqual(findInTranscript(lines, ''), []);
    assert.deepEqual(findInTranscript(lines, '  \t '), []);
  });

  it('finds every occurrence case-insensitively, in line order', () => {
    assert.deepEqual(findInTranscript(lines, 'friday'), [
      { lineId: 'a', start: 27, end: 33 },
      { lineId: 'b', start: 0, end: 6 },
    ]);
    assert.deepEqual(findInTranscript(lines, 'Release'), [
      { lineId: 'a', start: 16, end: 23 },
      { lineId: 'b', start: 18, end: 25 },
    ]);
  });

  it('matches several words across any run of whitespace', () => {
    assert.deepEqual(findInTranscript(lines, ' реліз буде '), [
      { lineId: 'c', start: 4, end: 16 },
    ]);
  });

  it('matches Cyrillic case-insensitively', () => {
    assert.deepEqual(findInTranscript(lines, 'РЕЛІЗ'), [
      { lineId: 'c', start: 4, end: 9 },
      { lineId: 'c', start: 26, end: 31 },
    ]);
  });

  it('treats regular expression characters literally', () => {
    assert.deepEqual(findInTranscript(lines, 'Friday.'), [
      { lineId: 'a', start: 27, end: 34 },
    ]);
    assert.deepEqual(findInTranscript(lines, '.*'), []);
  });
});
