# Renderer (`src/renderer`)

The UI, served by Vite from this folder (`index.html` → `main.ts`). It is
untrusted web content: it has no Node, no Electron and no filesystem. Everything
outside the page goes through `window.api`, which the preload exposes. The UI
framework is not chosen yet. When it is, add its specifics here.

## Layout

```
src/renderer/
  index.html, main.ts     entry: mounts the app
  features/<feature>/     one self-contained slice per product area
  components/ui/          shared UI primitives used by features
  lib/                    framework-agnostic helpers used by 2+ features
```

## A feature

```
features/<feature>/
  index.ts       barrel: the ONLY thing other modules import
  <feature>-view.*   the feature's entry view
  components/    views used only by this feature
  api.ts         calls to window.api for this feature, plus cache/query wiring
  lib/           pure helpers (formatting, mapping), unit-tested
  types.ts       types used only inside the feature
```

Start with the entry view and `index.ts`. Add the other parts only when there is
something to put in them.

## Rules

- Import a feature only through its barrel. Never import one feature from
  another. Promote anything shared to `components/ui` or `lib` first.
- Read data only through the feature's `api.ts`, never by calling `window.api`
  from a view. Treat data from main like server state: cache it, refetch it, and
  handle loading, error and empty states.
- Never import `electron`, Node built-ins, `src/main` or `src/preload`. The
  linter enforces this. Tests may also import `node:test` and `node:assert`.
  Contracts come from `src/shared`.
- Once `components/` grows past ~7 files with clear seams, group them by domain
  with a `shared/` bucket. It's an internal reshuffle, because the barrel hides it.
- Keep tests next to the code they cover (`*.test.ts`).
