// SPDX-FileCopyrightText: 2026 Dima Barabash
// SPDX-License-Identifier: AGPL-3.0-only

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { sourceUrlFrom } from './source.ts';

describe('sourceUrlFrom', () => {
  it('takes a web address and leaves an unset one unset', () => {
    assert.equal(
      sourceUrlFrom('https://code.example.org/nod-relay'),
      'https://code.example.org/nod-relay',
    );
    assert.equal(sourceUrlFrom(undefined), undefined);
    assert.equal(sourceUrlFrom(''), undefined);
  });

  it('refuses what is not an http(s) address', () => {
    assert.throws(
      () => sourceUrlFrom('ftp://code.example.org/relay'),
      /must be an http\(s\) address/,
    );
    assert.throws(
      () => sourceUrlFrom('not a url'),
      /must be an http\(s\) address/,
    );
  });
});
