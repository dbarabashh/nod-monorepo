import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseInline, parseMarkdown } from './markdown.ts';

const plain = (text: string) => ({ text, bold: false, italic: false });

describe('parseMarkdown', () => {
  it('reads the bold-line headings and bullet lists a model writes', () => {
    assert.deepEqual(
      parseMarkdown(
        '**Summary**  \nThe team agreed.\nIt ships Friday.\n\n**Key points:**\n- First\n- Second',
      ),
      [
        { type: 'heading', text: 'Summary' },
        {
          type: 'paragraph',
          inlines: [plain('The team agreed. It ships Friday.')],
        },
        { type: 'heading', text: 'Key points' },
        {
          type: 'list',
          ordered: false,
          items: [[plain('First')], [plain('Second')]],
        },
      ],
    );
  });

  it('accepts # headings and keeps numbered lists apart from bullets', () => {
    assert.deepEqual(
      parseMarkdown('## Action items\n1. Write it\n2) Send it\n* Note'),
      [
        { type: 'heading', text: 'Action items' },
        {
          type: 'list',
          ordered: true,
          items: [[plain('Write it')], [plain('Send it')]],
        },
        { type: 'list', ordered: false, items: [[plain('Note')]] },
      ],
    );
  });

  it('returns nothing for empty text', () => {
    assert.deepEqual(parseMarkdown('\n  \n'), []);
  });
});

describe('parseInline', () => {
  it('turns emphasis marks into styles and never shows the asterisks', () => {
    assert.deepEqual(parseInline('**Mark**: update the *onboarding* screens'), [
      { text: 'Mark', bold: true, italic: false },
      plain(': update the '),
      { text: 'onboarding', bold: false, italic: true },
      plain(' screens'),
    ]);
  });

  it('keeps underscores in names and stars in arithmetic as text', () => {
    assert.deepEqual(parseInline('Rename user_id_map and check 2 * 3 * 4'), [
      plain('Rename user_id_map and check 2 * 3 * 4'),
    ]);
    assert.deepEqual(parseInline('a _real_ word'), [
      plain('a '),
      { text: 'real', bold: false, italic: true },
      plain(' word'),
    ]);
  });

  it('leaves text without marks alone', () => {
    assert.deepEqual(parseInline('5 * 3 = 15'), [plain('5 * 3 = 15')]);
  });
});
