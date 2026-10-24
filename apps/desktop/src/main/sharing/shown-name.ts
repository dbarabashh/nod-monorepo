const maxShownNameLength = 60;

// Names come from other people and a dialog splits its detail on blank
// lines, so a name must not be able to forge a paragraph of the dialog the
// user relies on, nor reorder or hide part of it with bidi controls and
// zero-width characters; the renderer's displayName treats a name the same.
export function shownName(name: string): string {
  const flat = name
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ')
    .replace(/\p{C}/gu, '')
    .trim();
  return flat.length > maxShownNameLength
    ? `${flat.slice(0, maxShownNameLength)}…`
    : flat;
}
