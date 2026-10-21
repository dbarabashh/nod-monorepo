import encodeQR from 'qr';
import type { PairingScreen } from './handlers.ts';

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => escapes[char] ?? char);
}

// The page runs with JavaScript off and loads nothing, so it can only show
// what is written here. Its colours mirror the renderer's tokens.css, which
// a page outside the renderer can't load.
export function pairingPage(
  screen: PairingScreen,
  platform: NodeJS.Platform,
): string {
  const qr = encodeQR(screen.code, 'svg', {
    ecc: 'medium',
    border: 4,
    optimize: true,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Pair a phone</title>
<style>
:root {
  color-scheme: light dark;
  --surface: light-dark(oklch(100% 0 0), oklch(20.5% 0.008 260));
  --text: light-dark(oklch(20.5% 0.008 260), oklch(98.5% 0.002 260));
  --muted: light-dark(oklch(44.5% 0.012 260), oklch(71% 0.01 260));
  --border: light-dark(oklch(92.5% 0.004 260), oklch(27.5% 0.01 260));
}
* { box-sizing: border-box; margin: 0; }
html, body { height: 100%; }
body {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 16px;
  padding: 24px;
  background: var(--surface);
  color: var(--text);
  font: 14px/20px system-ui, sans-serif;
  text-align: center;
  user-select: none;
  cursor: default;
}
h1 { font-size: 18px; line-height: 24px; font-weight: 600; }
p { color: var(--muted); max-width: 320px; }
.qr {
  width: 280px;
  height: 280px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.qr svg { display: block; width: 100%; height: 100%; shape-rendering: crispEdges; }
.qr path { fill: #000; }
.code { font: 600 14px/20px ui-monospace, monospace; letter-spacing: 0.04em; color: var(--text); }
</style>
</head>
<body>
<h1>Pair a phone</h1>
<p>Put your phone on the same Wi‑Fi as this computer. In Nod on the phone, choose “Scan pairing code” and point the camera at this code.</p>
<div class="qr" role="img" aria-label="Pairing code">${qr}</div>
<p>Vault code <span class="code">${escapeHtml(screen.vaultCode)}</span><br>Your phone shows the same code once it is paired. It syncs through ${escapeHtml(screen.relayHost)}.</p>
<p>The code works once, only on this network, and only while this window is open. It closes by itself when the phone is paired.${platform === 'linux' ? ' Screenshots and a shared screen show it, so stop sharing first.' : ''}</p>
</body>
</html>`;
}
