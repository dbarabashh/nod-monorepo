// wasm-bindgen hands strings to Rust as UTF-8, which turns a lone surrogate
// into U+FFFD. JSON would carry it as an escape Rust rejects, so every string
// from the user gets the same replacement here; its UTF-16 length is unchanged.
export function wellFormed(text: string): string {
  let out = '';
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
    } else if (code < 0xdc00 || code > 0xdfff) {
      continue;
    }
    out += `${text.slice(start, i)}�`;
    start = i + 1;
  }
  return start === 0 ? text : out + text.slice(start);
}
