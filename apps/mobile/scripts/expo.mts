import { spawn } from 'node:child_process';

const child = spawn('expo', process.argv.slice(2), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
});

for (const signal of ['SIGINT', 'SIGTERM'] satisfies NodeJS.Signals[]) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === null ? 1 : 128);
});
