import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import decodeQR from 'qr/decode.js';
import { pairingPage } from './pairing-page.ts';

const code =
  'nod-pair:v1:AAgQGCAoMDhASFBYYGhweICIkJigqLC4wMjQ2ODo8Pg:https://relay.example.com/';

// Rasterizes the page's SVG the way a camera would see it: black modules on
// white, a few pixels each. The library draws each dark module as its own
// unit square, which the first assertion checks so nothing is skipped.
function scanSvg(svg: string) {
  const side = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
  const path = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
  const squares = path.split('Z').filter((part) => part !== '');
  for (const square of squares) {
    assert.match(square, /^[Mm]-?\d+ -?\d+h1v1(H\d+|h-1)$/);
  }
  const dark = new Set<string>();
  let x = 0;
  let y = 0;
  for (const square of squares) {
    const [, command, a, b] = /^([Mm])(-?\d+) (-?\d+)/.exec(square) ?? [];
    x = command === 'M' ? Number(a) : x + Number(a);
    y = command === 'M' ? Number(b) : y + Number(b);
    dark.add(`${x},${y}`);
  }
  const scale = 4;
  const size = side * scale;
  const data = new Uint8Array(size * size * 4).fill(255);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (
        dark.has(`${Math.floor(column / scale)},${Math.floor(row / scale)}`)
      ) {
        const at = (row * size + column) * 4;
        data.fill(0, at, at + 3);
      }
    }
  }
  return decodeQR({ width: size, height: size, data });
}

describe('pairing page', () => {
  it('draws a QR code that scans back to the pairing code', () => {
    const html = pairingPage(
      {
        code,
        vaultCode: '1234-ABCD-5678-EF90',
        relayHost: 'relay.example.com',
      },
      'darwin',
    );
    const svg = /<svg[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';
    assert.equal(scanSvg(svg), code);
  });

  it('shows the vault code and host as text, never as markup', () => {
    const html = pairingPage(
      {
        code,
        vaultCode: '1234-ABCD-5678-EF90',
        relayHost: '<img src=x>.example.com',
      },
      'linux',
    );
    assert.match(html, /shared screen show it/);
    assert.match(html, /1234-ABCD-5678-EF90/);
    assert.match(html, /&lt;img src=x&gt;\.example\.com/);
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /default-src 'none'/);
  });
});
