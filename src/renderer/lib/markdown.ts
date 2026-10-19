export type Inline = {
  text: string;
  bold: boolean;
  italic: boolean;
};

export type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] };

const listItem = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/;
const heading = /^\s*#{1,6}\s+(.*)$/;
const wholeLineBold = /^\s*\*\*(.+?)\*\*:?\s*$/;

export function parseInline(text: string): Inline[] {
  const inlines: Inline[] = [];
  const pattern =
    /\*\*(.+?)\*\*|\*(?=\S)(.+?)(?<=\S)\*|(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) {
      inlines.push({
        text: text.slice(last, match.index),
        bold: false,
        italic: false,
      });
    }
    const bold = match[1];
    inlines.push(
      bold === undefined
        ? { text: match[2] ?? match[3] ?? '', bold: false, italic: true }
        : { text: bold, bold: true, italic: false },
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    inlines.push({ text: text.slice(last), bold: false, italic: false });
  }
  return inlines;
}

function stripMarks(text: string): string {
  return parseInline(text)
    .map((inline) => inline.text)
    .join('')
    .replace(/:\s*$/, '')
    .trim();
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({
        type: 'paragraph',
        inlines: parseInline(paragraph.join(' ')),
      });
      paragraph = [];
    }
  };

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    const headingMatch = heading.exec(line) ?? wholeLineBold.exec(line);
    const itemMatch = listItem.exec(line);

    if (trimmed === '') {
      closeParagraph();
    } else if (headingMatch) {
      closeParagraph();
      blocks.push({ type: 'heading', text: stripMarks(headingMatch[1] ?? '') });
    } else if (itemMatch) {
      closeParagraph();
      const ordered = itemMatch[2] !== undefined;
      const item = parseInline(itemMatch[3] ?? '');
      const last = blocks.at(-1);
      if (last?.type === 'list' && last.ordered === ordered) {
        last.items.push(item);
      } else {
        blocks.push({ type: 'list', ordered, items: [item] });
      }
    } else {
      paragraph.push(trimmed);
    }
  }
  closeParagraph();
  return blocks;
}

function inlineMarkdown(inline: Inline): string {
  if (!inline.bold && !inline.italic) {
    return inline.text;
  }
  const [, before = '', core = '', after = ''] =
    /^(\s*)([\s\S]*?)(\s*)$/.exec(inline.text) ?? [];
  if (core === '') {
    return inline.text;
  }
  const mark = inline.bold ? '**' : '*';
  return `${before}${mark}${core}${mark}${after}`;
}

function inlinesMarkdown(inlines: Inline[]): string {
  return inlines.map(inlineMarkdown).join('').trim();
}

export function toMarkdown(blocks: Block[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
          return `## ${block.text}`;
        case 'paragraph':
          return inlinesMarkdown(block.inlines);
        case 'list':
          return block.items
            .map(
              (item, index) =>
                `${block.ordered ? `${index + 1}.` : '-'} ${inlinesMarkdown(item)}`,
            )
            .join('\n');
      }
    })
    .join('\n\n');
}
