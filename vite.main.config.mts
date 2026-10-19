import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      // Native addons load their prebuilt binaries at runtime and cannot be
      // bundled.
      external: ['@fugood/whisper.node', '@fugood/llama.node'],
    },
  },
});
