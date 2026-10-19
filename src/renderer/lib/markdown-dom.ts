import type { Block, Inline } from './markdown.ts';

export type NodeFactory<N> = {
  element: (tag: string, children: N[]) => N;
  text: (value: string) => N;
};

export type DomNode = {
  nodeName: string;
  nodeType: number;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
};

const textNode = 3;
const elementNode = 1;

type Marks = { bold: boolean; italic: boolean };

function children(node: DomNode): DomNode[] {
  return Array.from(node.childNodes);
}

function plain(text: string | null): string {
  return (text ?? '').replace(/\u00a0/g, ' ');
}

// Editable elements keep typed spaces as no-break spaces.
export function editableText(node: Pick<DomNode, 'textContent'>): string {
  return plain(node.textContent).trim();
}

// Splits at line breaks, so a Shift+Enter inside one block becomes two.
function inlineRuns(node: DomNode): Inline[][] {
  const runs: Inline[][] = [[]];
  const walk = (current: DomNode, marks: Marks) => {
    if (current.nodeType === textNode) {
      const text = plain(current.textContent);
      const run = runs.at(-1);
      const last = run?.at(-1);
      if (last && last.bold === marks.bold && last.italic === marks.italic) {
        last.text += text;
      } else if (text !== '') {
        run?.push({ text, ...marks });
      }
      return;
    }
    if (current.nodeType !== elementNode) {
      return;
    }
    if (current.nodeName === 'BR') {
      runs.push([]);
      return;
    }
    const next = {
      bold:
        marks.bold || current.nodeName === 'B' || current.nodeName === 'STRONG',
      italic:
        marks.italic || current.nodeName === 'I' || current.nodeName === 'EM',
    };
    for (const child of children(current)) {
      walk(child, next);
    }
  };
  walk(node, { bold: false, italic: false });
  return runs
    .map((run) => run.filter((inline) => inline.text !== ''))
    .filter((run) => run.some((inline) => inline.text.trim() !== ''));
}

function listItems(list: DomNode): Inline[][] {
  return children(list).flatMap((child) => {
    if (child.nodeName === 'UL' || child.nodeName === 'OL') {
      return listItems(child);
    }
    return inlineRuns(child);
  });
}

export function blocksFromDom(root: DomNode): Block[] {
  const blocks: Block[] = [];
  for (const node of children(root)) {
    if (/^H[1-6]$/.test(node.nodeName)) {
      const text = plain(node.textContent).trim();
      if (text !== '') {
        blocks.push({ type: 'heading', text });
      }
    } else if (node.nodeName === 'UL' || node.nodeName === 'OL') {
      const items = listItems(node);
      if (items.length > 0) {
        blocks.push({ type: 'list', ordered: node.nodeName === 'OL', items });
      }
    } else {
      for (const inlines of inlineRuns(node)) {
        blocks.push({ type: 'paragraph', inlines });
      }
    }
  }
  return blocks;
}

function inlineNodes<N>(inlines: Inline[], make: NodeFactory<N>): N[] {
  return inlines.map((inline) => {
    const text = make.text(inline.text);
    if (inline.bold) {
      return make.element('strong', [text]);
    }
    return inline.italic ? make.element('em', [text]) : text;
  });
}

export function blocksToDom<N>(blocks: Block[], make: NodeFactory<N>): N[] {
  return blocks.map((block) => {
    switch (block.type) {
      case 'heading':
        return make.element('h4', [make.text(block.text)]);
      case 'paragraph':
        return make.element('p', inlineNodes(block.inlines, make));
      case 'list':
        return make.element(
          block.ordered ? 'ol' : 'ul',
          block.items.map((item) =>
            make.element('li', inlineNodes(item, make)),
          ),
        );
    }
  });
}
