---
description: Mobile React Native styling with the shared design tokens, light and dark, and no translucency.
globs: 'apps/mobile/src/**'
alwaysApply: false
---

- Paths here are relative to `apps/mobile`; the desktop app's styling rules are in `styling-desktop.md`.
- Style with `StyleSheet.create` and the tokens in `src/theme/tokens.ts`. Never add a styling library (NativeWind, Tamagui, styled-components, Unistyles); tokens plus `StyleSheet` cover what the app needs.
- Never write a raw color or a magic number in a component. Use a token, or add one to `tokens.ts`. The values mirror `apps/desktop/src/renderer/styles/tokens.css`, so both clients look like one product.
- Components use semantic colors (`colors.surface`, `colors.textMuted`), never the primitive scales (`gray[600]`). Primitives exist only to define semantic colors.
- Theme through `themed()` in `src/theme`: a component's styles are built once per scheme from the semantic colors and picked with `useScheme()`. Never branch on the color scheme inside a component.
- Never use translucency: no alpha in colors, no `opacity` below 1 on surfaces or text, no `BlurView`, no `expo-glass-effect` or liquid glass. Express states and elevation with opaque tokens and borders. The only exception is `transparent` for a control with no background of its own (a ghost button).
- Name primitives after their desktop counterpart (`Button`, `Card`, `ListRow`) with the same variants and sizes (`variant="primary"`, `size="sm"`), so a screen reads the same on both clients.
- Keep touch targets at least 44 pt tall and wide (`control.minHit`). When the visible control is smaller, make the `Pressable` the 44 pt area and put the face inside; `hitSlop` is clipped by the parent's bounds.
- Give every control `accessibilityRole`, a label when it shows no text, and `accessibilityState` for `disabled`, `selected`, `checked` and `busy`. Hide decorative icons from accessibility.
- Show pressed states with an opaque background change in `Pressable`'s `style` callback, never with opacity or `TouchableOpacity`.
- Respect Dynamic Type and font scaling: never set `allowFontScaling={false}` on text the user reads. Cap it with `maxFontSizeMultiplier` only where layout would break.
- Respect safe areas with `react-native-safe-area-context` and never hardcode status bar or home indicator heights.
- Use `Platform.select` in tokens for platform differences (font family, hairline width), never in components.
- Never set inline `style` objects for static values. Inline styles are only for values computed at runtime.
