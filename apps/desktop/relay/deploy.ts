import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

// Deploys the folder relay/build.ts writes to whichever Vercel project it is
// linked to on this machine. The link lives in the git-ignored build output,
// so the repository names no project and every fork deploys its own.
const folder = path.join(import.meta.dirname, 'dist', 'vercel');

try {
  await access(path.join(folder, '.vercel', 'project.json'));
} catch {
  console.error(
    `No Vercel project is linked in ${path.relative(process.cwd(), folder)}. Run \`vercel link\` there once and set it up as relay/README.md describes, then deploy again.`,
  );
  process.exit(1);
}

const deploy = spawn('vercel', ['deploy', '--prod'], {
  cwd: folder,
  stdio: 'inherit',
  // The CLI is a .cmd shim on Windows, which only a shell runs.
  shell: process.platform === 'win32',
  env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' },
});
deploy.on('error', (failure) => {
  console.error(
    `The Vercel CLI couldn’t be started (${failure.message}). Install it and log in first.`,
  );
  process.exit(1);
});
deploy.on('exit', (code) => process.exit(code ?? 1));
