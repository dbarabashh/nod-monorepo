---
name: add-ui-component
description: Add a new design-system primitive or change an existing one in src/renderer/components/ui (button, input, select, dialog…). Use when a feature needs a UI primitive the design system doesn't have, or when a primitive needs a new variant, size or state.
---

# Add or change a UI component

Read `src/renderer/components/ui/AGENTS.md` and `.agents/rules/styling.md`
first. This skill is the checklist on top of them.

## 1. Decide whether it belongs here

- Can an existing primitive do it with a variant or by composition? Then extend
  or compose it instead.
- Is it used by only one feature? Then it goes in that feature's `components/`,
  not here.
- Prefer native HTML before building behavior: `<button>`, `<dialog>`,
  `popover`, `<details>`, `<input>` types. Chromium in Electron gives focus
  handling, keyboard support and accessibility for free.

## 2. Tokens first

List the colors, sizes and spacing the component needs. Use existing semantic
tokens. If something is genuinely missing, add a semantic token to
`styles/tokens.css` (defined from the primitive scales with `light-dark()`),
not a raw value in the component.

## 3. Write the CSS

Create `components/ui/<component>/<component>.css` and import it from
`components/ui/index.css`:

```css
.ui-<component> {
  --_bg: var(<semantic token>);
  --_fg: var(<semantic token>);

  background-color: var(--_bg);
  color: var(--_fg);

  &[data-variant='<variant>'] {
    --_bg: var(<semantic token>);
  }

  @media (forced-colors: active) {
    color: ButtonText;
  }
}
```

- Private variables `--_*` at the root, variants only reassign them.
- Parts as `ui-<component>__<part>`, states via attributes, never state classes.
- No alpha, no `opacity` on surfaces, no blur. Use opaque tokens and borders.

## 4. Write the React wrapper

Add `components/ui/<component>/<component>.tsx` and export it from
`components/ui/index.ts`:

```tsx
type <Component>Props = ComponentProps<'<element>'> & { variant?: <Variant> };

export function <Component>({ variant, className, ...props }: <Component>Props) {
  return (
    <<element> className={<join>('ui-<component>', className)} data-variant={variant} {...props} />
  );
}
```

`<join>` is the class-name helper the existing components use. Look at one of
them in `components/ui/` for the current shape and follow it.

- Take the native element's props (`ComponentProps<'button'>`) and spread the
  rest, so `ref`, `aria-*` and event handlers keep working.
- Map props to the CSS contract only. Use a real attribute for state
  (`disabled`, `aria-current`) instead of a class.
- Give icons and decorative parts `aria-hidden`, and give anything that only
  shows a picture a text alternative.

## 5. Check every state

For an interactive component, check each of these:

- default, hover, active, focus-visible, disabled
- every variant and size
- light and dark theme
- `forced-colors: active`
- `prefers-reduced-motion: reduce` if it animates
- long text, empty content, and right-to-left if text direction matters

## 6. See it

There is no Storybook. Render the component in the running app (`pnpm start`)
in both themes. macOS: System Settings → Appearance. Windows high contrast:
Settings → Accessibility → Contrast themes. Or, from a scratch script, load a
page that links `src/renderer/styles/index.css` in a `BrowserWindow`, switch
`nativeTheme.themeSource` between `light` and `dark`, and capture
`webContents.capturePage()`. Keep such scratch pages out of the repo.

## 7. Before finishing

```sh
pnpm typecheck && pnpm lint && pnpm test
```

If you changed an existing component's classes, variants or sizes, search for
every usage (`grep -rn "ui-<component>" src`) and update them in the same change.
