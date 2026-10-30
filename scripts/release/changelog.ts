const unreleased = '## Unreleased';

type Section = { heading: string; start: number; end: number };

function sections(lines: string[]): Section[] {
  const starts = lines.flatMap((line, index) =>
    line.startsWith('## ') ? [index] : [],
  );
  return starts.map((start, position) => ({
    heading: lines[start] ?? '',
    start,
    end: starts[position + 1] ?? lines.length,
  }));
}

function body(lines: string[], section: Section): string {
  return lines
    .slice(section.start + 1, section.end)
    .join('\n')
    .trim();
}

function isVersionHeading(heading: string, version: string): boolean {
  return heading === `## ${version}` || heading.startsWith(`## ${version} `);
}

// Moves what is listed under Unreleased into a section for the version and
// leaves Unreleased empty for the next one.
export function releaseChangelog(
  text: string,
  version: string,
  date: string,
): string {
  const lines = text.split('\n');
  const all = sections(lines);
  if (all.some((section) => isVersionHeading(section.heading, version))) {
    throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  }
  const pending = all.find((section) => section.heading === unreleased);
  if (!pending) {
    throw new Error(`CHANGELOG.md has no "${unreleased}" section.`);
  }
  const changes = body(lines, pending);
  if (!changes) {
    throw new Error(
      `List what changed under "${unreleased}" in CHANGELOG.md first.`,
    );
  }
  return [
    ...lines.slice(0, pending.start),
    unreleased,
    '',
    `## ${version} — ${date}`,
    '',
    changes,
    '',
    ...lines.slice(pending.end),
  ].join('\n');
}

export function releaseNotes(text: string, version: string): string {
  const lines = text.split('\n');
  const section = sections(lines).find((candidate) =>
    isVersionHeading(candidate.heading, version),
  );
  const notes = section ? body(lines, section) : '';
  if (!notes) {
    throw new Error(`CHANGELOG.md has no notes for ${version}.`);
  }
  return notes;
}
