export type TranscriptMatch = { lineId: string; start: number; end: number };

export function findInTranscript(
  lines: readonly { id: string; text: string }[],
  query: string,
): TranscriptMatch[] {
  const words = query.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const pattern = new RegExp(words.map(escapeRegExp).join('\\s+'), 'giu');
  const matches: TranscriptMatch[] = [];
  for (const line of lines) {
    for (const found of line.text.matchAll(pattern)) {
      matches.push({
        lineId: line.id,
        start: found.index,
        end: found.index + found[0].length,
      });
    }
  }
  return matches;
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/gu, '\\$&');
}
