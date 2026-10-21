import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { builtLibrary, cargoBuild, root, run } from './cargo.ts';
import { sourceStamp } from './source-stamp.ts';

const device = 'aarch64-apple-ios';
const simulators = ['aarch64-apple-ios-sim', 'x86_64-apple-ios'];
const output = path.join(root, 'ios', 'NodAutomergeCore.xcframework');
const stampFile = path.join(output, 'source-stamp');
const headers = path.join(root, 'build', 'ios-headers');
const simulatorLibrary = path.join(
  root,
  'build',
  'ios-simulator',
  'libnod_automerge.a',
);
const library = (target: string) => builtLibrary(target, 'libnod_automerge.a');

const stamp = await sourceStamp(root);
const builtFrom = await readFile(stampFile, 'utf8').catch(() => '');

if (stamp !== builtFrom || process.argv.includes('--force')) {
  await cargoBuild([device, ...simulators], {
    IPHONEOS_DEPLOYMENT_TARGET: '16.4',
  });
  await rm(headers, { recursive: true, force: true });
  await mkdir(headers, { recursive: true });
  await cp(
    path.join(root, 'ios', 'nod_automerge.h'),
    path.join(headers, 'nod_automerge.h'),
  );
  await mkdir(path.dirname(simulatorLibrary), { recursive: true });
  await run('lipo', [
    '-create',
    ...simulators.map(library),
    '-output',
    simulatorLibrary,
  ]);
  await rm(output, { recursive: true, force: true });
  await run('xcodebuild', [
    '-create-xcframework',
    '-library',
    library(device),
    '-headers',
    headers,
    '-library',
    simulatorLibrary,
    '-headers',
    headers,
    '-output',
    output,
  ]);
  await writeFile(stampFile, stamp);
}
