# Renderer (`src/renderer`)

The UI, built with React and served by Vite from this folder (`index.html` →
`main.tsx` → `app.tsx`). It is
untrusted web content: it has no Node, no Electron and no filesystem. Everything
outside the page goes through `window.api`, which the preload exposes.

## Layout

```
src/renderer/
  index.html, main.tsx    entry: sets data-platform on <html>, mounts React
  app.tsx, app.css        the app shell (sidebar + main area)
  styles/                 tokens, reset, base, utilities and the layer order
  features/<feature>/     one self-contained slice per product area
  components/ui/          the design system: plain CSS primitives (see its AGENTS.md)
  lib/                    helpers used by 2+ features, created when first needed
```

## A feature

```
features/<feature>/
  index.ts           barrel: the ONLY thing other modules import
  <feature>-view.tsx the feature's entry view
  <feature>.css      the feature's styles, wrapped in `@layer app`
  components/    views used only by this feature
  api.ts         calls to window.api for this feature, plus cache/query wiring
  lib/           pure helpers (formatting, mapping), unit-tested
  types.ts       types used only inside the feature
```

Start with the entry view and `index.ts`. Add the other parts only when there is
something to put in them.

## Rules

- Import a feature only through its barrel. Never import one feature from
  another. Promote anything shared to `components/ui` or `lib` first. When one
  feature's view belongs inside another (an audio panel inside onboarding and
  settings), the app shell composes them by passing it in as a prop.
- Read data only through the feature's `api.ts`, never by calling `window.api`
  from a view. Treat data from main like server state: cache it, refetch it, and
  handle loading, error and empty states.
- Never import `electron`, Node built-ins, `src/main` or `src/preload`. The
  linter enforces this. Tests may also import `node:test` and `node:assert`.
  Contracts come from `src/shared`.
- Once `components/` grows past ~7 files with clear seams, group them by domain
  with a `shared/` bucket. It's an internal reshuffle, because the barrel hides it.
- Keep tests next to the code they cover (`*.test.ts`). Pure logic goes in
  `lib/` so it can be tested without a DOM.
- Build UI from `components/ui` (import from `components/ui/index.ts`). Use
  feature CSS only for the feature's own layout, never to restyle a primitive.
- Don't call impure functions (`new Date()`, `Math.random()`) during render.
  Capture them once in state or pass them in, so renders stay stable and the
  logic stays testable.
