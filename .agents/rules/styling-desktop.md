---
description: Desktop renderer styling in plain CSS with design tokens, cascade layers and no translucency.
globs: 'apps/desktop/src/renderer/**'
alwaysApply: false
---

- Paths here are relative to `apps/desktop/src/renderer`; the mobile app's styling rules are in `styling-mobile.md`.
- Write plain CSS. Never add a CSS framework, preprocessor or CSS-in-JS library: Chromium in Electron supports nesting, `@layer`, `@scope`, `:has()`, container queries, `light-dark()`, `color-mix()` and `oklch()` natively.
- Use tokens from `styles/tokens.css` for every color, size, space, radius, font and duration. Never write a raw color or a magic number in a component; add or reuse a token instead.
- Components use semantic tokens (`--color-surface`, `--color-text-muted`), never the primitive scales (`--gray-600`). Primitives exist only to define semantic tokens.
- Never use translucency: no alpha in colors (`oklch(… / 0.5)`, `rgba`, `#rrggbbaa`), no `opacity` below 1 on surfaces or text, no `backdrop-filter`, no blur. Express states and elevation with opaque tokens and borders. The only exception is fully `transparent` for a control that has no background of its own (a ghost button).
- Theme with `light-dark()` inside tokens. Never write `@media (prefers-color-scheme)` or a `.dark` class in a component; a component that uses semantic tokens themes itself.
- Put every rule in a cascade layer (`reset, tokens, base, components, app, utilities`, declared in `styles/index.css`). Component styles enter through `components/ui/index.css`, which is imported into the `components` layer. The app shell and feature CSS files wrap their rules in `@layer app { … }`, because a CSS file imported from a component is otherwise unlayered and overrides everything. The renderer entry imports `styles/index.css` before any component, because the first stylesheet to name a layer fixes the layer order.
- Name component classes `ui-<component>` and parts `ui-<component>__<part>`. Express variants and sizes with `data-variant` / `data-size`, and states with real attributes (`:disabled`, `aria-invalid`, `aria-expanded`), never with extra state classes.
- Keep per-component private variables prefixed `--_` (`--_bg`) and set them in variants instead of repeating properties.
- Gate OS-specific styling on `:root[data-platform='darwin' | 'win32' | 'linux']` in `base.css` or the component, never on user-agent sniffing.
- Support `@media (forced-colors: active)` (Windows high contrast) for every interactive component, using system colors (`ButtonText`, `FieldText`, `GrayText`, `Highlight`).
- Show focus with `:focus-visible`, never remove the outline without replacing it, and keep hit targets at least `--control-height-sm` tall. The only exception is a region focused from code (`tabindex="-1"`) so screen readers follow a page change; it isn't a control, so it shows no ring.
- Desktop conventions: `cursor: default` on controls (no pointer hand), app chrome is not text-selectable, user content is (`[data-selectable]`, inputs, editors).
- Don't build on thin weights (below 400) or sub-pixel sizes (`0.5px`). Windows scaling at 125–150% blurs them.
- Never set inline `style` for static values. Inline styles are only for values computed at runtime.
