import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { releaseChangelog, releaseNotes } from './changelog.ts';

const changelog = `# Changelog

Notes for each release.

## Unreleased

- Updates install themselves.
- Settings show the version.

## 1.0.0 — 2026-10-01

- First release.
`;

describe('releaseChangelog', () => {
  it('moves the unreleased changes under the new version', () => {
    assert.equal(
      releaseChangelog(changelog, '1.1.0', '2026-10-27'),
      `# Changelog

Notes for each release.

## Unreleased

## 1.1.0 — 2026-10-27

- Updates install themselves.
- Settings show the version.

## 1.0.0 — 2026-10-01

- First release.
`,
    );
  });

  it('refuses a release with nothing listed', () => {
    const empty = changelog.replace(
      '- Updates install themselves.\n- Settings show the version.\n',
      '',
    );
    assert.throws(
      () => releaseChangelog(empty, '1.1.0', '2026-10-27'),
      /List what changed/,
    );
  });

  it('refuses a version that was already released', () => {
    assert.throws(
      () => releaseChangelog(changelog, '1.0.0', '2026-10-27'),
      /already has a section for 1\.0\.0/,
    );
  });

  it('refuses a changelog without an Unreleased section', () => {
    assert.throws(
      () => releaseChangelog('# Changelog\n', '1.1.0', '2026-10-27'),
      /no "## Unreleased" section/,
    );
  });
});

describe('releaseNotes', () => {
  it('returns only the section of that version', () => {
    assert.equal(releaseNotes(changelog, '1.0.0'), '- First release.');
  });

  it('does not take a longer version for a shorter one', () => {
    assert.throws(
      () => releaseNotes(changelog.replace('1.0.0', '1.0.01'), '1.0.0'),
      /no notes for 1\.0\.0/,
    );
  });

  it('refuses a version that has no notes', () => {
    assert.throws(() => releaseNotes(changelog, '1.1.0'), /no notes/);
  });
});
