import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const keyword = ['as', 'const'].join(' ');
const pattern = new RegExp(String.raw`\bas\s+const\b`, 'g');

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'ios', 'android', 'build'].includes(entry.name)) {
        yield* sourceFiles(path);
      }
    } else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      yield path;
    }
  }
}

async function* checkedFiles(): AsyncGenerator<string> {
  for (const root of ['src', 'scripts', 'modules']) {
    if (existsSync(root)) {
      yield* sourceFiles(root);
    }
  }
}

const findings: string[] = [];
for await (const file of checkedFiles()) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    if (pattern.test(line)) {
      findings.push(`${file}:${index + 1}: ${line.trim()}`);
    }
    pattern.lastIndex = 0;
  });
}

if (findings.length > 0) {
  console.error(
    `\`${keyword}\` is a type assertion. Declare the type instead:`,
  );
  console.error(findings.join('\n'));
  process.exit(1);
}
