const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => escapes[char] ?? char);
}

// Pages main draws run with JavaScript off and load nothing, so they can't
// take the renderer's stylesheet or its font: these mirror the semantic
// tokens in renderer/styles/tokens.css and change together with them, and
// the text is set in the system font.
export const pageTokens = `:root {
  color-scheme: light dark;
  --surface: light-dark(oklch(100% 0 0), oklch(20.5% 0.008 260));
  --field: light-dark(oklch(96.5% 0.003 260), oklch(23.5% 0.009 260));
  --field-hover: light-dark(oklch(92.5% 0.004 260), oklch(27.5% 0.01 260));
  --text: light-dark(oklch(20.5% 0.008 260), oklch(98.5% 0.002 260));
  --muted: light-dark(oklch(44.5% 0.012 260), oklch(71% 0.01 260));
  --border: light-dark(oklch(92.5% 0.004 260), oklch(27.5% 0.01 260));
  --accent: oklch(54.5% 0.2 258);
  --accent-hover: oklch(48.5% 0.2 260);
  --on-accent: oklch(100% 0 0);
  --focus-ring: light-dark(oklch(54.5% 0.2 258), oklch(70% 0.14 255));
  --font-sans: system-ui, -apple-system, 'Segoe UI Variable Text', 'Segoe UI', Cantarell, Ubuntu, 'Noto Sans', sans-serif;
  --font-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace;
}
* { box-sizing: border-box; margin: 0; }
html, body { height: 100%; }
body {
  background: var(--surface);
  color: var(--text);
  font: 14px/20px var(--font-sans);
  letter-spacing: -0.0075rem;
  user-select: none;
  cursor: default;
}`;

// The surface colour as a window background, so nothing flashes before the
// page paints. Keep in step with --surface above.
export function surfaceColor(dark: boolean): string {
  return dark ? '#16181c' : '#ffffff';
}
