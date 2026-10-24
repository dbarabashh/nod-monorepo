const breaks = /[\p{Cc}\p{Zl}\p{Zp}\s]+/gu;
const hidden = /\p{C}/gu;

// Names come from other people. React escapes markup, but bidi overrides
// and zero-width characters could still reorder a name or hide part of it,
// so a team could pass for something else; they never reach the screen.
export function displayName(name: string): string {
  return name.replace(breaks, ' ').replace(hidden, '').trim();
}
