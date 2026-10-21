export const phraseLength = 24;

export function countWords(text: string): number {
  return text.toLowerCase().match(/[a-z]+/g)?.length ?? 0;
}
