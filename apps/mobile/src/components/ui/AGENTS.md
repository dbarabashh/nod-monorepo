# Design system (`src/components/ui`)

The app's UI primitives, styled only from the tokens in `src/theme/tokens.ts`.
They mirror the desktop app's design system (`apps/desktop/src/renderer/components/ui`) with the same names, variants, sizes and
states, so a screen reads the same on both clients. Where touch or React
Native needs it they differ, and the difference is deliberate:

- `Text` exists because React Native has no inherited text styles; desktop
  styles text in CSS.
- `Checkbox` is the desktop's meetings select box promoted to a primitive.
- `Input multiline` replaces the desktop textarea, and `Input` has one size:
  the desktop's small field is under the 44 pt touch target.
- `Button size="sm"` keeps the small face but a 44 pt hit area around it.
- The type scale is one step larger than desktop's and `radius.xs` is 4, to
  keep proportions at the larger sizes. Styling rules live in
  `.agents/rules/styling-mobile.md`.

## Layout

```
components/ui/
  index.ts         barrel: the components features import
  <component>.tsx  one primitive: its themed styles and a thin React component
```

A component builds its styles once per scheme with `themed()` and picks them
with `useScheme()`. It takes the props of the React Native core component it
wraps and spreads the rest, so `accessibility*`, `testID` and handlers keep
working.

## The contract of a component

- Variants and sizes are props named as on desktop (`variant="primary"`,
  `size="sm"`); states are real props mapped to `accessibilityState`
  (`disabled`, `selected`, `checked`).
- Every interactive component covers: default, pressed, disabled, light and
  dark, the largest text size, and a screen reader.
- Pressed replaces desktop hover: an opaque background change, never opacity.
- Touch targets are at least `control.minHit` (44 pt). When the visible
  control is smaller, the `Pressable` is the 44 pt hit area and the face sits
  inside it. `hitSlop` doesn't reach past the parent's bounds, so don't rely on
  it.
- Pass a caller's `accessibilityState` through, merged with the component's
  own state.
- Under expo-router's `Link asChild`, give the child a single style object, not
  an array.
- Uses semantic colors only and stays opaque (no alpha, no blur, no glass).

## Rules

- Compose before you add. Use an existing primitive with a variant before
  creating a new one.
- A component used by one feature is not a primitive. It lives in that
  feature's `components/`. Promote it here when a second feature needs it.
- Changing a primitive's props, variants or sizes changes every screen. Search
  for usages before renaming anything.
- Never encode feature knowledge here: no feature names, no data loading.
- Add every primitive to the showcase (`src/features/showcase`), and add a new
  one with the `add-mobile-ui-component` skill.
