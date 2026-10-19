---
name: add-ipc
description: Add a typed channel between the Electron main process and the renderer through the preload bridge, either a request/response call (invoke/handle) or a main → renderer event. Use when the renderer needs something only main can do (filesystem, OS APIs, native modules, app state) or main needs to push updates to the UI.
---

# Add an IPC channel

Read `.agents/rules/electron.md` first. This skill is the checklist on top of
it. Every channel touches four places, and skipping one leaves either a type
hole or a security hole. Read how the existing channels do each step and
follow that shape; the snippets below show the pattern, not the current code.

## 1. Define the contract once

Put the channel name and its payload and result types in `src/shared/ipc.ts`,
which main, preload and renderer all import, and add the function to the API
type the preload exposes.

- Name channels `<domain>:<verb>-<noun>`.
- One channel per operation. Never add a generic `invoke(channel, ...args)`.
- Declare types explicitly instead of asserting them (`.agents/rules/typescript.md`).

## 2. Handle it in main

Group handlers per domain in `src/main/ipc/<domain>.ts` behind one register
function, and call it from the main entry.

- Validate every argument as `unknown` before using it. The renderer is
  untrusted, so a type annotation on the parameter is not validation.
- Check `event.senderFrame` belongs to the app (the Vite dev server URL in dev,
  the `file://` renderer in production). Keep this check in one shared helper.
- Return only what the renderer needs to show. Keys, tokens and raw encrypted
  blobs stay in main.
- Return plain serializable data. Never return class instances, functions, or
  Electron objects, because structured clone drops or rejects them.
- Throw `Error`s with a message the UI can show. Electron passes only the
  message to the renderer.

## 3. Expose it in preload (`src/preload/index.ts`)

- Add the function to the one object exposed as `window.api`, typed with the
  API type from `src/shared/ipc.ts`. Never expose `ipcRenderer` itself.
- Request/response: `(...args) => ipcRenderer.invoke(<channel>, ...args)`.
- Main → renderer events: expose a subscribe function that returns an
  unsubscribe, and strip the `IpcRendererEvent` before calling the callback:

  ```ts
  on<Event>: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: <Payload>) => callback(payload);
    ipcRenderer.on(<channel>, listener);
    return () => ipcRenderer.removeListener(<channel>, listener);
  },
  ```

## 4. Use it in the renderer

`window.api` is typed once in `src/declarations.d.ts` from the shared API type,
so a new function needs no extra declaration. Views never call `window.api`
directly: the feature's `api.ts` wraps the call (see `src/renderer/AGENTS.md`),
and the renderer never imports `electron`.

## 5. Verify

```sh
pnpm typecheck && pnpm lint
pnpm start
```

Call the new function from the renderer in dev and confirm it works. Then
confirm a bad payload is rejected in main: call it from the DevTools console with
a wrong-shaped argument.
