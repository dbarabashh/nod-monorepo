import type { Question } from '../sync/dialog-gate.ts';
import { escapeHtml, pageTokens } from './page-style.ts';

export const dialogScheme = 'nod-dialog';
export const dialogWidth = 440;
const padding = 24;
const gap = 16;
const lineHeight = 20;
const charsPerLine = 52;
const titleCharsPerLine = 40;
const minHeight = 180;
export const dialogMaxHeight = 720;

// The page has no script to measure itself, so its height is estimated from
// the blocks it shows, with a little room to spare; when the window can't be
// that tall, what is between the title and the buttons scrolls. Each figure
// mirrors the stylesheet below.
export function dialogHeight(question: Question): number {
  const paragraphs = question.detail.split('\n\n').filter((text) => text);
  const textLines = paragraphs.reduce(
    (lines, text) => lines + Math.ceil(text.length / charsPerLine),
    0,
  );
  const rows = question.words ? Math.ceil(question.words.length / 3) : 0;
  const blocks = [
    Math.ceil(question.message.length / titleCharsPerLine) * 28,
    question.code ? 74 : 0,
    rows ? rows * 24 + (rows - 1) * 4 + 24 : 0,
    textLines * lineHeight + Math.max(0, paragraphs.length - 1) * 12,
    32,
  ].filter((height) => height > 0);
  const height =
    padding * 2 +
    blocks.reduce((total, block) => total + block, 0) +
    (blocks.length - 1) * gap +
    gap;
  return Math.min(dialogMaxHeight, Math.max(minHeight, height));
}

// Which answer a form navigation carries, or null for anything else.
export function answerOf(url: string): boolean | null {
  if (!url.startsWith(`${dialogScheme}://answer/`) || !URL.canParse(url)) {
    return null;
  }
  const choice = new URL(url).searchParams.get('choice');
  return choice === 'confirm' ? true : choice === 'cancel' ? false : null;
}

// A question main draws: the answer comes back as the form's navigation,
// which the window reads and stops, so the page needs no script. Cancel is
// the default button where there is one, drawn as such and taking Return, so
// the safe answer is the easy one, as it was in the system dialog.
export function dialogPage(question: Question): string {
  const paragraphs = question.detail
    .split('\n\n')
    .filter((text) => text)
    .map((text) => `<p>${escapeHtml(text)}</p>`)
    .join('\n');
  const text = paragraphs ? `<div class="text">\n${paragraphs}\n</div>` : '';
  const code = question.code
    ? `<div class="code"><span class="code__label">${escapeHtml(question.code.label)}</span><span class="code__value">${escapeHtml(question.code.value)}</span></div>`
    : '';
  const words = question.words
    ? `<ol class="words">${question.words
        .map((word) => `<li>${escapeHtml(word)}</li>`)
        .join('')}</ol>`
    : '';
  const cancel = question.cancelLabel
    ? `<button name="choice" value="cancel" autofocus>${escapeHtml(question.cancelLabel)}</button>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action ${dialogScheme}:">
<title>${escapeHtml(question.message)}</title>
<style>
${pageTokens}
body {
  display: flex;
  flex-direction: column;
  gap: ${gap}px;
  padding: ${padding}px;
  overflow: hidden;
}
h1 { font-size: 18px; line-height: 28px; font-weight: 600; letter-spacing: -0.0125rem; overflow-wrap: anywhere; }
.content { display: grid; gap: ${gap}px; align-content: start; flex: 1; min-height: 0; overflow-y: auto; }
.text { display: grid; gap: 12px; }
p { color: var(--muted); overflow-wrap: anywhere; }
.code {
  display: grid;
  gap: 4px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--field);
  text-align: center;
}
.code__label { color: var(--muted); font-size: 12px; line-height: 18px; }
.code__value {
  font: 600 20px/28px var(--font-mono);
  letter-spacing: 0.06em;
  overflow-wrap: anywhere;
  user-select: text;
}
.words {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px 16px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--field);
  list-style-position: inside;
  font: 500 14px/24px var(--font-mono);
}
.words li::marker { color: var(--muted); font-weight: 400; }
form {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: auto;
}
button {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--field);
  border-radius: 9999px;
  background: var(--field);
  color: var(--text);
  font: 500 14px/1 var(--font-sans);
  letter-spacing: -0.0075rem;
  white-space: nowrap;
  cursor: default;
}
button:hover { background: var(--field-hover); border-color: var(--field-hover); }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
button[autofocus] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
button[autofocus]:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
@media (forced-colors: active) { button { border-color: ButtonText; } }
</style>
</head>
<body>
<h1>${escapeHtml(question.message)}</h1>
<div class="content">
${code}
${words}
${text}
</div>
<form method="get" action="${dialogScheme}://answer/">
${cancel}
<button name="choice" value="confirm"${question.cancelLabel ? '' : ' autofocus'}>${escapeHtml(question.confirmLabel)}</button>
</form>
</body>
</html>`;
}
