# Design system (`src/renderer/components/ui`)

The app's UI primitives: plain CSS components styled only from the tokens in
`src/renderer/styles/tokens.css`. They are framework-agnostic class contracts
(`ui-<component>`), so any UI framework renders them with
plain markup. Every feature composes from here. Styling rules live in
`.agents/rules/styling.md`.

## Layout

```
components/ui/
  index.css              imports every component's CSS (the components layer)
  index.ts               barrel: the React components features import
  <component>/
    <component>.css      the class contract: base, parts, variants, sizes, states
    <component>.tsx      a thin React wrapper that renders the contract
```

The React wrapper only maps props to the contract (`variant` → `data-variant`,
a state prop → its `aria-*` attribute) and spreads the rest onto the native element. It
holds no styling of its own and no feature logic.

## The contract of a component

- One root class `ui-<component>`, parts as `ui-<component>__<part>`.
- Variants via `data-variant`, sizes via `data-size`, states via real
  attributes (`disabled`, `aria-invalid`, `aria-pressed`, `aria-expanded`).
- Every interactive component covers: default, hover, active, focus-visible,
  disabled, light and dark, and `forced-colors`.
- Uses semantic tokens only and stays opaque (no alpha, no blur).

## Rules

- Compose before you add. Wrap an existing primitive or use it with a variant
  before creating a new one.
- A component used by one feature is not a primitive. It lives in that
  feature's `components/`. Promote it here when a second feature needs it.
- Changing a primitive's classes, variants or sizes changes every screen. Treat
  them as a contract, and search for usages before renaming anything.
- Never encode feature knowledge here: no feature names, no data fetching.
- Add a new component with the `add-ui-component` skill.
