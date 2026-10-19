# Preload (`src/preload`)

The only bridge between the untrusted renderer and the main process. It runs
before the page loads, with access to a limited Electron API, and exposes one
object to the page as `window.api` through `contextBridge`.

## Rules

- Expose exactly one object, typed with the API type from `src/shared/ipc.ts`.
  Never redeclare its shape here.
- Expose narrow, named functions. Never expose `ipcRenderer`, `require`, or a
  generic `send(channel, ...)` / `invoke(channel, ...)` passthrough.
- No logic and no validation here: main validates every payload, because a
  compromised renderer can bypass this file. The one exception is a check main
  can't make itself, such as reading `navigator.userActivation` before telling
  main to expect a user-started capture.
- For main → renderer events, expose a subscribe function that returns an
  unsubscribe, and never pass the raw `IpcRendererEvent` to the page.
- Add a channel with the `add-ipc` skill.
