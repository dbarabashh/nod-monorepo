import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { builtLibrary, cargoBuild, root } from './cargo.ts';

const target = 'wasm32-unknown-unknown';

// The bare wasm target has no system randomness; the host provides it.
await cargoBuild([target], {
  RUSTFLAGS:
    `${process.env.RUSTFLAGS ?? ''} --cfg getrandom_backend="custom"`.trim(),
});
await mkdir(path.join(root, 'build'), { recursive: true });
await copyFile(
  builtLibrary(target, 'nod_automerge.wasm'),
  path.join(root, 'build', 'nod_automerge.wasm'),
);
