/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
declare const __DEFAULT_RELAY_URL__: string;
declare const __UPDATE_URL__: string;
declare const __UPDATE_PUBLIC_KEY__: string;

interface Window {
  api: import('./shared/ipc.ts').AppApi;
}
