# Main process (`src/main`)

Electron's privileged process: app lifecycle, windows, menus, OS integration
(audio capture, keychain, notifications) and the `ipcMain` handlers the renderer
calls. It is the only process that touches the filesystem, native modules and
secrets.

## Layout

```
src/main/
  index.ts          app lifecycle and window creation only; wires everything else
  ipc/<domain>.ts   ipcMain handlers for one domain, registered from index.ts
  security/         navigation, window-open, permission and IPC sender guards,
                    encryption at rest (aead, data key)
  models/           speech model downloads: resume, checksum, storage
  meetings/         recorder, session, and the encrypted file-per-meeting store
  sync/             device sync: engine, transports, settings
  windows/          the app's windows, and the dialog main draws itself with no
                    script; sync/pairing-page.ts draws the pairing code the same way
  sharing/          notes shared with other people and teams: the core sharing
                    session over this computer's files and relays, and its dialogs
  updates/          checks the release feed and installs updates through
                    Electron's autoUpdater (docs/decisions/0004-desktop-updates.md)
  <domain>/         OS-facing code for one domain (audio/, storage/, keychain/)
```

Create `ipc/` and domain folders when the first one is needed. Don't create
empty folders.

## Rules

- Keep `index.ts` thin. It creates windows and calls `register<Domain>Ipc()`
  functions. Domain logic never lives there.
- A handler validates its input, calls `@nod/core` or a domain module, and
  returns plain data. It holds no business logic of its own.
- Platform adapters live here. When `@nod/core` needs storage, crypto, the
  filesystem or time, define the interface in core and implement it here.
- Keep long or blocking work (transcription, encryption, sync, large queries)
  off the main thread with async APIs, a `utilityProcess` or a worker. A busy
  main process freezes every window.
- Import contracts from `src/shared`, never from `src/renderer` or `src/preload`.
- Follow `.agents/rules/electron.md` and `.agents/rules/local-first.md`.
