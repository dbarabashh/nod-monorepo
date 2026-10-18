---
name: add-feature
description: Add a new product feature or extend an existing one across the app's layers — core domain logic, the IPC contract, the main-process handler, and the renderer feature slice. Use when a change adds or moves structure (a new screen, domain, channel, or sub-flow). A small fix inside existing files doesn't need this skill.
---

# Add or extend a feature

The layers and their rules are documented where they live. Read each one before
touching it:

- `src/core/AGENTS.md`: platform-neutral domain logic, data model, sync
- `src/shared/AGENTS.md`: the IPC contract
- `src/main/AGENTS.md`: handlers and OS adapters
- `src/renderer/AGENTS.md`: feature slices in the UI

Dependencies point one way: `renderer → shared ← preload ← main → core`. The
linter blocks the wrong direction for `core` and `renderer`.

## Which case are you in

- **Fixing a bug or tweaking existing code.** Edit in place and follow
  `.agents/rules/`. Come back only if the fix adds a file or moves code between
  layers.
- **Extending an existing feature.** Go to
  [Extending a feature](#extending-a-feature).
- **Creating a new feature.** Work through [New feature](#new-feature) top to
  bottom.

## Extending a feature

Read what is there before adding to it. Its current shape tells you where the
new code goes:

```sh
find src -path '*<feature>*' -type f | sort
cat src/renderer/features/<feature>/index.ts
```

- Extend the existing pattern instead of starting a parallel one. If you must
  change the pattern, change it everywhere in the feature.
- A new operation the UI needs from main is a new channel. Follow the `add-ipc`
  skill, and add the call to the feature's `api.ts`.
- New domain rules or data go in the matching `src/core/<domain>/`, not in the
  handler and not in the view.
- Don't widen a barrel unless something outside genuinely imports the new export.
- A schema or payload change is a contract change. See the contract rules in
  `src/core/AGENTS.md` and `src/shared/AGENTS.md`.

## New feature

Build it from the inside out, so each layer is done before the next one calls
it. Skip a layer only if the feature genuinely doesn't need it (a pure UI
setting may need no core).

1. **Core.** Create `src/core/<domain>/` with an `index.ts` barrel, its types,
   and the logic as plain functions. Anything platform-specific is an interface
   here and an implementation in `src/main`. Add unit tests next to it.
2. **Contract.** Declare the channels and payload types in `src/shared/ipc.ts`
   and extend `AppApi`. Follow `add-ipc` for the details.
3. **Main.** Add `src/main/ipc/<domain>.ts` with handlers that validate input,
   call core and return plain data. Register it from `src/main/index.ts`. Put
   OS adapters in `src/main/<domain>/`.
4. **Preload.** Expose the new functions on `window.api` in
   `src/preload/index.ts`.
5. **Renderer.** Create `src/renderer/features/<feature>/` with the entry view
   and `index.ts`. Add `api.ts` for the `window.api` calls, then `components/`,
   `lib/` and `types.ts` as needed. Handle the loading, error and empty states.
6. **Wire it into the app shell** (navigation or window) through the feature's
   barrel.

## Before finishing

- Check `.agents/rules/local-first.md`: where the data is stored, whether it is
  encrypted, whether it works offline, and whether anything leaves the device.
- Check the code works on macOS, Windows and Linux: paths via `node:path` and
  `app.getPath()`, and OS-specific behavior gated on `process.platform`.
- Run:

  ```sh
  pnpm typecheck && pnpm lint
  pnpm start
  ```

  Exercise the feature in the running app, including its empty and error states.
