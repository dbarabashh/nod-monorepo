import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'native', 'macos', 'mic-monitor.c');
const micMonitorBinary = path.join(root, 'build', 'native', 'nod-mic-monitor');

async function modified(file: string): Promise<number> {
  return (await stat(file).catch(() => null))?.mtimeMs ?? 0;
}

// One universal binary, so an Intel and an Apple silicon build ship the same
// file, and macOS 12 is the oldest system Electron still supports.
async function buildMicMonitor(): Promise<void> {
  const inputs = Math.max(
    await modified(source),
    await modified(import.meta.filename),
  );
  if ((await modified(micMonitorBinary)) >= inputs) {
    return;
  }
  await mkdir(path.dirname(micMonitorBinary), { recursive: true });
  await run('clang', [
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-arch',
    'arm64',
    '-arch',
    'x86_64',
    '-mmacosx-version-min=12.0',
    '-framework',
    'CoreAudio',
    '-framework',
    'CoreFoundation',
    source,
    '-o',
    micMonitorBinary,
  ]);
}

await buildMicMonitor();
