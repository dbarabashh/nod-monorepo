---
name: add-feature
description: Add a new product feature or extend an existing one across the app's layers — core domain logic, a native module if needed, the feature slice and its route. Use when a change adds or moves structure (a new screen, domain, native capability or sub-flow). A small fix inside existing files doesn't need this skill.
---

# Add or extend a feature

The layers and their rules are documented in `AGENTS.md` and next to the code
(`src/components/ui/AGENTS.md`). Read them before touching a layer.

Dependencies point one way:
`app → features → components/ui, theme, lib → core`. `core` imports nothing
from React Native, Expo or Node, and the linter enforces it.

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
cat src/features/<feature>/index.ts
```

- Extend the existing pattern instead of starting a parallel one. If you must
  change the pattern, change it everywhere in the feature.
- New domain rules or data go in the matching `src/core/<domain>/`, not in a
  hook and not in a view.
- Before changing logic, find the tests that cover it and follow "When logic
  changes" in the `write-tests` skill.
- Don't widen a barrel unless something outside genuinely imports the new export.
- A schema or stored-format change is a contract shared with the desktop app.
  Check `src/core` and `docs/decisions` in the separate `nod-desktop`
  repository before changing it.

## New feature

Build it from the inside out, so each layer is done before the next one calls
it. Skip a layer only if the feature genuinely doesn't need it.

1. **Core.** Create `src/core/<domain>/` with an `index.ts` barrel, its types,
   and the logic as plain functions. Anything platform-specific (storage, keys,
   audio, the clock) is an interface here and an implementation outside core.
   If the desktop app already has this domain, port it unchanged. Add unit
   tests next to it (`write-tests` skill).
2. **Native.** If the feature needs a platform capability no Expo module
   provides, add a local Expo module in `modules/<name>/` with a typed JS API,
   and a config plugin for any `Info.plist`, entitlement or manifest change.
   Follow `.agents/rules/expo.md`.
3. **Feature.** Create `src/features/<feature>/` with the entry view and
   `index.ts`. Add `components/`, `hooks/`, `lib/` (pure, unit-tested helpers)
   and `types.ts` as needed. Handle the loading, error and empty states.
4. **Route.** Add a thin screen in `src/app/` that renders the feature's entry
   view through its barrel. Navigation options live in the route or its
   `_layout.tsx`, not in the feature.

## Before finishing

- Check `.agents/rules/local-first.md`: where the data is stored, whether it is
  encrypted, whether it works offline, and whether anything leaves the device.
- Check it on iOS and Android: platform behavior gated on `Platform.OS`,
  permissions asked at the moment of use, safe areas, the Android back button.
- Run:

  ```sh
  pnpm typecheck && pnpm lint && pnpm test
  pnpm ios   # and pnpm android
  ```

  Exercise the feature in the running app, including its empty and error states.
