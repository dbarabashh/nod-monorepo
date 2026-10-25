export type ComponentSource = 'npm' | 'crate' | 'pod' | 'android' | 'bundled';

export type Component = {
  name: string;
  version: string;
  license: string;
  source: ComponentSource;
  // Each license and notice file found with the component, empty when it
  // ships none and only names a license in its metadata.
  texts: string[];
};

export type NoticeEntry = {
  name: string;
  version: string;
  license: string;
  source: ComponentSource;
  copyright: string[];
  text: string | null;
};

export type Notices = {
  entries: NoticeEntry[];
  texts: Record<string, string>;
};

const copyrightLine = /^\s*(?:copyright\b|\(c\)|©)/i;
const placeholder = /\[yyyy\]|\{yyyy\}|<year>|\[name of copyright owner\]/i;

function bodyKey(body: string): string {
  return body.replace(/\s+/g, ' ').trim().toLowerCase();
}

// A file's copyright lines are the ones in its heading, before the license
// text begins. A line further down that starts with "copyright" is part of
// the license ("copyright notice and this permission notice…") and stays.
function splitHeading(text: string): { copyright: string[]; body: string } {
  const lines = text.split('\n');
  const copyright: string[] = [];
  const taken = new Set<number>();
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (copyrightLine.test(trimmed)) {
      taken.add(index);
      if (!placeholder.test(trimmed)) copyright.push(trimmed);
      continue;
    }
    const heading = trimmed.split(/\s+/).length <= 6 && !/[.:;]$/.test(trimmed);
    if (!heading) break;
    // A holder's name wrapped onto the line after "Copyright (c) 2011:".
    const previous = lines[index - 1]?.trim() ?? '';
    const last = copyright.length - 1;
    if (taken.has(index - 1) && copyrightLine.test(previous) && last >= 0) {
      copyright[last] = `${copyright[last]} ${trimmed}`;
      taken.add(index);
    }
  }
  const body = lines
    .filter((_, index) => !taken.has(index))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { copyright: [...new Set(copyright)], body };
}

// Hundreds of packages carry the same license with only their copyright
// lines changed, so each body is stored once and entries keep their own
// copyright lines. Each file is read on its own, since a crate's
// LICENSE-MIT has its holder in a heading of its own, and bodies are matched
// word for word, so no package is shown another's holder.
export function buildNotices(components: Component[]): Notices {
  const texts: Record<string, string> = {};
  const ids = new Map<string, string>();
  const entries = [...components]
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    )
    .map((component): NoticeEntry => {
      const parts = component.texts.map(splitHeading);
      const copyright = [...new Set(parts.flatMap((part) => part.copyright))];
      const body = parts
        .map((part) => part.body)
        .filter((part) => part !== '')
        .join('\n\n');
      let text: string | null = null;
      if (body !== '') {
        const key = bodyKey(body);
        text = ids.get(key) ?? `t${ids.size + 1}`;
        if (!ids.has(key)) {
          ids.set(key, text);
          texts[text] = body;
        }
      }
      return { ...component, copyright, text };
    });
  return { entries, texts };
}

const sourceLabel: Record<ComponentSource, string> = {
  npm: 'npm package',
  crate: 'Rust crate',
  pod: 'iOS library',
  android: 'Android library',
  bundled: 'bundled library',
};

export function renderNotices(notices: Notices, title: string): string {
  const rule = '-'.repeat(72);
  const blocks = notices.entries.map((entry) => {
    const head = `${entry.name} ${entry.version} (${sourceLabel[entry.source]}) - ${entry.license}`;
    const copyright = entry.copyright.join('\n');
    const body =
      entry.text === null
        ? `No license file ships with this component; its metadata names ${entry.license}.`
        : (notices.texts[entry.text] ?? '');
    return [head, copyright, body].filter((part) => part !== '').join('\n\n');
  });
  return [title, ...blocks].join(`\n\n${rule}\n\n`) + '\n';
}
