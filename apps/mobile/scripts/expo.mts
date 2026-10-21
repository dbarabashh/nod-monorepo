import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Android builds the library from Gradle; CocoaPods only runs on pod install,
// so a run on iOS rebuilds it first when the Rust sources changed.
if (process.argv[2] === 'run:ios') {
  execFileSync(
    process.execPath,
    [require.resolve('@nod/automerge-native/scripts/build-ios')],
    { stdio: 'inherit' },
  );
}

const expoCli = require.resolve('expo/bin/cli');
const child = spawn(process.execPath, [expoCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
});

for (const signal of ['SIGINT', 'SIGTERM'] satisfies NodeJS.Signals[]) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === null ? 1 : 128);
});
