import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseMarkdown, toMarkdown } from './markdown.ts';
import {
  blocksFromDom,
  blocksToDom,
  editableText,
  type DomNode,
} from './markdown-dom.ts';

function el(nodeName: string, ...childNodes: DomNode[]): DomNode {
  return {
    nodeName,
    nodeType: 1,
    textContent: childNodes.map((child) => child.textContent ?? '').join(''),
    childNodes,
  };
}

function text(value: string): DomNode {
  return { nodeName: '#text', nodeType: 3, textContent: value, childNodes: [] };
}

const edited = (...blocks: DomNode[]) =>
  toMarkdown(blocksFromDom(el('DIV', ...blocks)));

describe('blocksFromDom', () => {
  it('turns an edited summary back into the same kind of Markdown', () => {
    assert.equal(
      edited(
        el('P', text('Met '), el('B', text('John Smith')), text(' today.')),
        el('H4', text('Key points')),
        el(
          'UL',
          el('LI', text('Ship '), el('I', text('Friday'))),
          el('LI', text('Hire')),
        ),
        el('OL', el('LI', text('First')), el('LI', text('Second'))),
      ),
      'Met **John Smith** today.\n\n## Key points\n\n- Ship *Friday*\n- Hire\n\n1. First\n2. Second',
    );
  });

  it('keeps a line break typed inside a paragraph as two paragraphs', () => {
    assert.equal(
      edited(el('P', text('One'), el('BR'), text('Two'))),
      'One\n\nTwo',
    );
  });

  it('drops empty blocks the editor leaves behind and reads spaces it inserts', () => {
    assert.equal(
      edited(
        el('P', el('BR')),
        el('DIV', text('Hello\u00a0there')),
        el('UL', el('LI', el('BR'))),
        el('H4'),
      ),
      'Hello there',
    );
  });

  it('keeps spaces outside bold marks, so they still read as bold', () => {
    assert.equal(
      edited(el('P', text('A'), el('STRONG', text(' bold ')), text('word'))),
      'A **bold** word',
    );
  });

  it('round-trips what the summary model writes', () => {
    const markdown =
      'The team met.\n\n## Action items\n\n- Fix the payment page\n- Write the email';
    assert.deepEqual(
      parseMarkdown(toMarkdown(parseMarkdown(markdown))),
      parseMarkdown(markdown),
    );
  });

  it('reads back exactly what the editor was given', () => {
    const markdown =
      'Met **John** and *Ann*.\n\n## Action items\n\n- Ship\n- Hire\n\n1. One\n2. Two';
    const nodes = blocksToDom(parseMarkdown(markdown), {
      element: (tag, children) => el(tag.toUpperCase(), ...children),
      text,
    });
    assert.equal(toMarkdown(blocksFromDom(el('DIV', ...nodes))), markdown);
  });

  it('reads typed spaces in an editable line as plain spaces', () => {
    assert.equal(editableText(text(' Ask\u00a0John\u00a0')), 'Ask John');
  });
});
