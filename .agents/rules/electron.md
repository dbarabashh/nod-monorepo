---
description: Electron process boundaries, IPC, window security, and packaging.
globs: 'src/**, forge.config.mts, index.html'
alwaysApply: false
---

- Treat the renderer as untrusted web content. Never enable `nodeIntegration`, and never disable `contextIsolation`, `sandbox` or `webSecurity`. The defaults are the security model.
- The renderer reaches the OS only through `src/preload/index.ts`. Expose narrow, named functions with `contextBridge.exposeInMainWorld`, and never expose `ipcRenderer`, `require`, or a generic `send(channel, ...)` passthrough.
- Use `ipcRenderer.invoke` with `ipcMain.handle` for request/response, and use `webContents.send` for main → renderer events. Avoid `sendSync`, because it blocks the renderer.
- Validate every `ipcMain.handle` argument in main before using it, and check `event.senderFrame` is the app's own origin. A compromised renderer can call any exposed channel with any payload.
- Deny new windows by default with `setWindowOpenHandler(() => ({ action: 'deny' }))`, and block `will-navigate` away from the app origin.
- Open links with `shell.openExternal` only after checking the URL is `https:` (or `mailto:`), never with a raw renderer-supplied string.
- Keep a strict Content-Security-Policy `<meta>` in `index.html`. Loosen it only for a named origin the app actually uses.
- Gate dev-only behavior (DevTools, verbose logging) on `!app.isPackaged`, never on `NODE_ENV`.
- Keep the `FusesPlugin` settings in `forge.config.mts`. Never flip `RunAsNode`, `OnlyLoadAppFromAsar` or `EnableEmbeddedAsarIntegrityValidation` to work around a problem.
- Keep blocking work (file I/O, crypto, child processes) off the main process's synchronous path. Use async APIs or a utility process, because a stalled main process freezes every window.
- Never put API keys or secrets in source, the renderer or the preload. They ship in the asar and anyone can read them. Store user credentials in main with `safeStorage`.
- The app ships on macOS, Windows and Linux. Gate OS-specific behavior on `process.platform`, never assume macOS, and keep each platform's conventions (macOS keeps the app alive when all windows close and re-creates the window on `activate`; Windows and Linux quit).
- Build paths with `node:path` and `app.getPath()`, never hardcoded `/` separators or `~/Library` style locations.
