import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: [
      {
        // Automerge's Node build reads its WASM from a path next to itself,
        // which bundling breaks; this build carries the WASM inline.
        find: /^@automerge\/automerge$/,
        replacement: fileURLToPath(
          new URL(
            './node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js',
            import.meta.url,
          ),
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
