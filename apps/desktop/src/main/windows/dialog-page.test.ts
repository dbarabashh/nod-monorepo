import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  answerOf,
  dialogHeight,
  dialogMaxHeight,
  dialogPage,
} from './dialog-page.ts';

const question = {
  message: 'Share notes with <this> person?',
  detail: 'Check the code.\n\nNothing is shared until you choose.',
  code: { label: 'Their identity code', value: 'BD71-CD5B-E9B4-9813' },
  confirmLabel: 'Share with them',
  cancelLabel: 'Cancel & stop',
};

describe('dialog page', () => {
  it('shows the question, the code and the buttons as text, never as markup', () => {
    const html = dialogPage(question);
    assert.match(html, /<h1>Share notes with &lt;this&gt; person\?<\/h1>/);
    assert.match(
      html,
      /<p>Check the code\.<\/p>\n<p>Nothing is shared until you choose\.<\/p>/,
    );
    assert.match(html, /BD71-CD5B-E9B4-9813/);
    assert.match(html, /Their identity code/);
    assert.match(html, /value="cancel" autofocus>Cancel &amp; stop</);
    assert.match(html, /value="confirm">Share with them</);
    assert.match(html, /button\[autofocus\] \{ background: var\(--accent\)/);
    assert.doesNotMatch(html, /<script/);
    assert.match(
      html,
      /default-src 'none'; style-src 'unsafe-inline'; form-action nod-dialog:/,
    );
    assert.match(html, /action="nod-dialog:\/\/answer\/"/);
  });

  it('lists the words of a phrase in order, and lets Confirm take focus when there is no Cancel', () => {
    const html = dialogPage({
      message: 'Your recovery phrase',
      detail: 'Write it down.',
      words: ['abandon', 'ability', 'able'],
      confirmLabel: 'Done',
      cancelLabel: null,
    });
    assert.match(
      html,
      /<ol class="words"><li>abandon<\/li><li>ability<\/li><li>able<\/li><\/ol>/,
    );
    assert.doesNotMatch(html, /value="cancel"/);
    assert.match(html, /value="confirm" autofocus>Done</);
  });

  it('gives a phrase room for its words and a short question little', () => {
    const short = dialogHeight({
      message: 'Stop syncing?',
      detail: 'The copies stay.',
      confirmLabel: 'Stop',
      cancelLabel: 'Cancel',
    });
    const phrase = dialogHeight({
      message: 'Your recovery phrase',
      detail: 'Write it down.',
      code: { label: 'Vault code', value: '1234-ABCD-5678-EF90' },
      words: new Array<string>(24).fill('abandon'),
      confirmLabel: 'Done',
      cancelLabel: null,
    });
    // Padding 48, title 28, one line 20, buttons 32, two gaps of 16 and one
    // to spare: 176, below the least a dialog gets.
    assert.equal(short, 180);
    // Padding 48, title 28, code 74, eight rows of words 220 in padding 24,
    // one line 20, buttons 32, four gaps of 16 and one to spare.
    assert.equal(phrase, 526);
    const long = dialogHeight({
      message: 'Switch this device to another recovery phrase?',
      detail: new Array<string>(6).fill('x'.repeat(150)).join('\n\n'),
      code: { label: 'Vault code', value: '1234-ABCD-5678-EF90' },
      words: new Array<string>(24).fill('abandon'),
      confirmLabel: 'Switch',
      cancelLabel: 'Cancel',
    });
    assert.equal(long, dialogMaxHeight);
  });
});

describe('dialog answer', () => {
  it('reads the choice from the form’s own address and nothing else', () => {
    assert.equal(answerOf('nod-dialog://answer/?choice=confirm'), true);
    assert.equal(answerOf('nod-dialog://answer/?choice=cancel'), false);
    assert.equal(answerOf('nod-dialog://answer/?choice=other'), null);
    assert.equal(answerOf('nod-dialog://answer/'), null);
    assert.equal(answerOf('nod-dialog://page/?choice=confirm'), null);
    assert.equal(answerOf('https://relay.example.com/?choice=confirm'), null);
    assert.equal(answerOf('nod-dialog://answer/%'), null);
  });
});
