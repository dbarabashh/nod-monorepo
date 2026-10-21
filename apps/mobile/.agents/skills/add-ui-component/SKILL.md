---
name: add-ui-component
description: Add a new design-system primitive or change an existing one in src/components/ui (button, field, checkbox, sheet…). Use when a feature needs a UI primitive the design system doesn't have, or when a primitive needs a new variant, size or state.
---

# Add or change a UI component

Read `src/components/ui/AGENTS.md` and `.agents/rules/styling.md` first. This
skill is the checklist on top of them.

## 1. Decide whether it belongs here

- Can an existing primitive do it with a variant or by composition? Then extend
  or compose it instead.
- Is it used by only one feature? Then it goes in that feature's `components/`,
  not here.
- Does the desktop app have it (`src/renderer/components/ui` in the separate
  `nod-desktop` repository)? Then
  port its contract: the same name, variants, sizes and states, translated from
  CSS to `StyleSheet`. Mobile differs only where touch needs it (target size,
  pressed instead of hover).
- Prefer React Native core (`Pressable`, `TextInput`, `Switch`, `Modal`) before
  building behavior. They give focus, accessibility and platform feel for free.

## 2. Tokens first

List the colors, sizes and spacing the component needs. Use existing semantic
tokens from `src/theme/tokens.ts`. If something is genuinely missing, add a
semantic color to both `light` and `dark` (defined from the primitive scales),
or a size to the matching scale. Never write a raw value in the component.

## 3. Write the component

Create `src/components/ui/<component>.tsx` and export it from
`src/components/ui/index.ts`:

```tsx
import { Pressable, type PressableProps } from 'react-native';
import { themed, useScheme } from '../../theme/index.ts';

type <Component>Props = PressableProps & { variant?: <Variant> };

const sheets = themed((colors) => ({
  root: { backgroundColor: colors.field },
  pressed: { backgroundColor: colors.fieldPressed },
  primary: { backgroundColor: colors.accent },
}));

export function <Component>({ variant = 'default', style, ...props }: <Component>Props) {
  const styles = sheets[useScheme()];
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.root, variant === 'primary' && styles.primary, pressed && styles.pressed, style]}
      {...props}
    />
  );
}
```

- Take the core component's props and spread the rest, so `ref`,
  `accessibility*`, `testID` and handlers keep working. Let a caller's `style`
  come last.
- Variants and sizes are props with the desktop's names. Keep each as a style
  entry and compose the array; don't build style objects during render.
- Set `accessibilityRole`, `accessibilityState` (`disabled`, `selected`,
  `checked`, `busy`) and a label for anything that shows no text. Hide
  decorative icons (`accessible={false}`, `importantForAccessibility="no"`).
- Make the `Pressable` at least 44 pt (`control.minHit`) and put a smaller
  visible face inside it. `hitSlop` is clipped by the parent's bounds.

## 4. Check every state

For an interactive component, check each of these:

- default, pressed, disabled, busy if it has one
- every variant and size
- light and dark theme
- the largest accessibility text size (iOS Larger Text, Android font size)
- VoiceOver and TalkBack read a sensible role, name and state
- long text, empty content, and right-to-left if text direction matters
- reduced motion if it animates (`AccessibilityInfo.isReduceMotionEnabled`)

## 5. See it

There is no Storybook. Add the component to the showcase
(`src/features/showcase`, route `/components`) and look at it on an iOS simulator and an Android
emulator in both themes (`pnpm ios`, `pnpm android`; switch appearance in the
simulator's settings). Screenshots: `xcrun simctl io booted screenshot <file>`
and `adb exec-out screencap -p > <file>`. Keep screenshots out of the repo.

## 6. Before finishing

```sh
pnpm typecheck && pnpm lint && pnpm test
```

If you changed an existing component's props, variants or sizes, search for
every usage (`grep -rn "<Component" src`) and update them in the same change.
