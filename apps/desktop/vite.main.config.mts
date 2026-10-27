import path from 'node:path';
import { defineConfig } from 'vite';
import { requirePackageDir } from './scripts/package-dir.ts';

export default defineConfig({
  define: {
    __DEFAULT_RELAY_URL__: JSON.stringify(process.env.NOD_RELAY_URL ?? ''),
    __UPDATE_URL__: JSON.stringify(process.env.NOD_UPDATE_URL ?? ''),
    __UPDATE_PUBLIC_KEY__: JSON.stringify(
      process.env.NOD_UPDATE_PUBLIC_KEY ?? '',
    ),
  },
  resolve: {
    alias: [
      {
        // Automerge's Node build reads its WASM from a path next to itself,
        // which bundling breaks; this build carries the WASM inline.
        find: /^@automerge\/automerge$/,
        replacement: path.join(
          requirePackageDir(
            '@automerge/automerge',
            path.join(
              requirePackageDir('@nod/core', import.meta.url),
              'package.json',
            ),
          ),
          'dist/mjs/entrypoints/fullfat_base64.js',
        ),
      },
    ],
  },
  build: {
    rollupOptions: {
      // Native addons load their prebuilt binaries at runtime and cannot be
      // bundled.
      external: ['@fugood/whisper.node', '@fugood/llama.node'],
    },
  },
});
