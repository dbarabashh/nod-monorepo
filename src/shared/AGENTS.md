# Shared contracts (`src/shared`)

Types and constants that more than one process imports: the IPC contract
(`ipc.ts`: channel names, payload and result types, and the `AppApi` the preload
exposes) and plain domain types the UI shows.

## Rules

- Types and constants only. Nothing that runs side effects, and no `electron`
  or `node:*` imports, because the renderer imports this too.
- Each channel and payload shape is declared once, here. Main, preload and
  renderer import it, and none of them redeclares it.
- Changing a payload shape is a breaking change across processes. Update the
  handler, the preload and every caller in the same change.
