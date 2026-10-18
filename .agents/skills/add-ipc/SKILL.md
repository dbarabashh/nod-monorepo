---
name: add-ipc
description: Add a typed channel between the Electron main process and the renderer through the preload bridge, either a request/response call (invoke/handle) or a main → renderer event. Use when the renderer needs something only main can do (filesystem, OS APIs, native modules, app state) or main needs to push updates to the UI.
---

# Add an IPC channel

Read `.agents/rules/electron.md` first. This skill is the checklist on top of
it. Every channel touches four places, and skipping one leaves either a type
hole or a security hole.

## 1. Define the contract once

Put the channel name and its payload/result types in `src/shared/ipc.ts`, which
main, preload and renderer all import. Create it the first time a channel is
added:

```ts
export const IpcChannel = {
  getAppVersion: 'app:get-version',
} as const;

export type AppApi = {
  getAppVersion: () => Promise<string>;
};
```

- Name channels `<domain>:<verb>-<noun>` (`meetings:list`, `settings:update`).
- One channel per operation. Never add a generic `invoke(channel, ...args)`.
- Type-only exports should be imported with `import type`.

## 2. Handle it in main

Add the handler to `src/main/ipc/<domain>.ts` inside a `register<Domain>Ipc()`
function, and call that function from `src/main/index.ts`:

```ts
ipcMain.handle(IpcChannel.getAppVersion, (event) => {
  assertTrustedSender(event);
  return app.getVersion();
});
```

- Validate every argument as `unknown` before using it. The renderer is
  untrusted, so a type annotation on the parameter is not validation.
- Check `event.senderFrame` belongs to the app (the Vite dev server URL in dev,
  the `file://` renderer in production). Put this check in one helper and reuse it.
- Return only what the renderer needs to show. Keys, tokens and raw encrypted
  blobs stay in main.
- Return plain serializable data. Never return class instances, functions, or
  Electron objects, because structured clone drops or rejects them.
- Throw `Error`s with a message the UI can show. Electron passes only the
  message to the renderer.

## 3. Expose it in preload (`src/preload/index.ts`)

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type AppApi } from '../shared/ipc';

const api: AppApi = {
  getAppVersion: () => ipcRenderer.invoke(IpcChannel.getAppVersion),
};

contextBridge.exposeInMainWorld('api', api);
```

- Expose exactly one object (`window.api`) and add functions to it. Never expose
  `ipcRenderer` itself.
- For main → renderer events, expose a subscribe function that returns an
  unsubscribe, and strip the `IpcRendererEvent` before calling the callback:

  ```ts
  onMeetingUpdated: (callback) => {
    const listener = (_event: IpcRendererEvent, meeting: Meeting) => callback(meeting);
    ipcRenderer.on(IpcChannel.meetingUpdated, listener);
    return () => ipcRenderer.removeListener(IpcChannel.meetingUpdated, listener);
  },
  ```

## 4. Type it in the renderer

Declare the bridge once in `src/declarations.d.ts`:

```ts
import type { AppApi } from './shared/ipc';

declare global {
  interface Window {
    api: AppApi;
  }
}
```

Views never call `window.api` directly. The feature's `api.ts` wraps the call
(see `src/renderer/AGENTS.md`), and the renderer never imports `electron`.

## 5. Verify

```sh
pnpm typecheck && pnpm lint
pnpm start
```

Call the new function from the renderer in dev and confirm it works. Then
confirm a bad payload is rejected in main: call it from the DevTools console with
a wrong-shaped argument.
