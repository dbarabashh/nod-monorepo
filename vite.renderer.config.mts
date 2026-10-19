import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function contentSecurityPolicy(isDev: boolean): string {
  const devOnly = (value: string) => (isDev ? ` ${value}` : '');
  return [
    "default-src 'none'",
    `script-src 'self'${devOnly("'unsafe-inline'")}`,
    `style-src 'self'${devOnly("'unsafe-inline'")}`,
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self'${devOnly('ws://localhost:*')}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}

function cspPlugin(isDev: boolean): Plugin {
  return {
    name: 'content-security-policy',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: contentSecurityPolicy(isDev),
        },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ command }) => ({
  root: 'src/renderer',
  plugins: [react(), cspPlugin(command === 'serve')],
  build: {
    outDir: resolve(import.meta.dirname, '.vite/renderer/main_window'),
    emptyOutDir: true,
    cssTarget: 'chrome152',
  },
}));
