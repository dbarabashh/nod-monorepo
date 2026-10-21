import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const keyword = ['as', 'const'].join(' ');
const pattern = new RegExp(String.raw`\bas\s+const\b`, 'g');
const skipped = new Set([
  'node_modules',
  '.vite',
  '.expo',
  '.dev-electron',
  'out',
  'dist',
  'ios',
  'android',
]);

async function* sourceFiles(path: string): AsyncGenerator<string> {
  if (!(await stat(path)).isDirectory()) {
    yield path;
    return;
  }
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      if (!skipped.has(entry.name)) {
        yield* sourceFiles(child);
      }
    } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      yield child;
    }
  }
}

const findings: string[] = [];
for (const root of process.argv.slice(2)) {
  for await (const file of sourceFiles(root)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        findings.push(`${file}:${index + 1}: ${line.trim()}`);
      }
      pattern.lastIndex = 0;
    });
  }
}

if (findings.length > 0) {
  console.error(
    `\`${keyword}\` is a type assertion. Declare the type instead:`,
  );
  console.error(findings.join('\n'));
  process.exit(1);
}
