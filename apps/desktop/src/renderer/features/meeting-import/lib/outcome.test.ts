import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { importOutcome } from './outcome.ts';

function outcome(
  added: number,
  present: number,
  failed: number,
  skipped: number,
) {
  return importOutcome({ status: 'imported', added, present, failed, skipped });
}

describe('describing an import', () => {
  it('reports what was added and what was already here', () => {
    assert.equal(
      outcome(2, 1, 0, 0),
      'Imported 2 meetings. 1 meeting was already here.',
    );
  });

  it('never calls a file empty when it had meetings', () => {
    assert.equal(
      outcome(0, 0, 1, 2),
      'No new meetings were imported. 2 meetings in the file couldn’t be read and were left out. 1 meeting couldn’t be saved. Import the file again to try them again.',
    );
    assert.equal(outcome(0, 0, 0, 0), 'The file has no meetings in it.');
  });
});
