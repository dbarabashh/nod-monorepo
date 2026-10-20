import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createCapturePage } from './capture-page.ts';

type Page = { name: string; end: () => void; watched: boolean };

function page(name: string): Page {
  return { name, end: () => {}, watched: false };
}

function setup() {
  let recording = false;
  const events: string[] = [];
  const capture = createCapturePage<Page>({
    watch: (watched, onEnd) => {
      watched.end = onEnd;
      watched.watched = true;
      return () => {
        watched.end = () => {};
        watched.watched = false;
      };
    },
    recording: () => recording,
    pause: () => events.push('pause'),
    onChange: () => events.push('change'),
  });
  return {
    capture,
    events,
    record: (on: boolean) => {
      recording = on;
    },
  };
}

describe('the page capturing a recording', () => {
  it('pauses the recording when the capturing page goes', () => {
    const { capture, events, record } = setup();
    const card = page('card');
    capture.claim(card);
    record(true);
    card.end();
    assert.deepEqual(events, ['change', 'pause', 'change']);
    assert.equal(capture.is(card), false);
    assert.equal(card.watched, false);
  });

  it('lets nobody else claim while a recording runs', () => {
    const { capture, record } = setup();
    const card = page('card');
    const main = page('main');
    capture.claim(card);
    record(true);
    assert.throws(() => capture.claim(main), /already being recorded/);
    assert.equal(capture.is(card), true);
    assert.equal(card.watched, true);
  });

  it('follows a later recording to the page that started it', () => {
    const { capture, events } = setup();
    const card = page('card');
    const main = page('main');
    capture.claim(card);
    capture.claim(main);
    card.end();
    assert.deepEqual(events, ['change', 'change']);
    assert.equal(capture.is(main), true);
    assert.equal(card.watched, false);
  });

  it('gives the capture back when a start failed', () => {
    const { capture } = setup();
    const card = page('card');
    const main = page('main');
    capture.claim(card);
    const undo = capture.claim(main);
    undo();
    assert.equal(capture.is(card), true);
    assert.equal(card.watched, true);
  });

  it('keeps a later claim when an earlier start fails', () => {
    const { capture } = setup();
    const card = page('card');
    const main = page('main');
    const undo = capture.claim(card);
    capture.claim(main);
    undo();
    assert.equal(capture.is(main), true);
  });

  it('lets go once the capture is over', () => {
    const { capture, events } = setup();
    const card = page('card');
    capture.claim(card);
    capture.release();
    assert.equal(capture.is(card), false);
    card.end();
    assert.deepEqual(events, ['change', 'change']);
  });

  it('pauses nothing when the page goes after the recording stopped', () => {
    const { capture, events } = setup();
    const card = page('card');
    capture.claim(card);
    card.end();
    assert.deepEqual(events, ['change', 'change']);
  });
});
