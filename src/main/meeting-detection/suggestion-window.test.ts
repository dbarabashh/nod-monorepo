import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  createSuggestionWindowControl,
  type SuggestionWindow,
} from './suggestion-window.ts';

// Electron reports a destroyed window as closed later, not during destroy(),
// so the fake keeps the report until the test delivers it.
function setup() {
  const events: string[] = [];
  const closings: Array<() => void> = [];
  const capturing = new Set<unknown>();
  const pages: unknown[] = [];
  const closers: Array<() => void> = [];
  const control = createSuggestionWindowControl({
    open: () => {
      const number = pages.length + 1;
      let destroyed = false;
      let closed = () => {};
      const page = {
        send: (_channel: string, payload: unknown) =>
          events.push(`send ${number} ${JSON.stringify(payload)}`),
      };
      pages.push(page);
      const window: SuggestionWindow = {
        isDestroyed: () => destroyed,
        destroy: () => {
          destroyed = true;
          events.push(`destroy ${number}`);
          closings.push(() => closed());
        },
        hide: () => events.push(`hide ${number}`),
        showInactive: () => events.push(`show ${number}`),
        on: (_event, listener) => {
          closed = listener;
          closers.push(listener);
        },
        webContents: page,
      };
      events.push(`open ${number}`);
      return window;
    },
    capturing: (page) => capturing.has(page),
    onGone: () => events.push('gone'),
  });
  return {
    control,
    events,
    deliverClosed: () => closings.splice(0).forEach((close) => close()),
    systemCloses: (number: number) => closers[number - 1]?.(),
    capture: (number: number, on: boolean) => {
      const page = pages[number - 1];
      if (on) {
        capturing.add(page);
      } else {
        capturing.delete(page);
      }
      control.captureChanged();
    },
  };
}

const zoom = { appName: 'Zoom', title: 'Zoom meeting' };
const teams = { appName: 'Microsoft Teams', title: 'Microsoft Teams meeting' };

describe('the suggestion window', () => {
  it('opens once and updates an open window in place', () => {
    const { control, events } = setup();
    control.show(zoom);
    control.show(teams);
    assert.deepEqual(control.current(), teams);
    assert.deepEqual(events, [
      'open 1',
      `send 1 ${JSON.stringify(teams)}`,
      'show 1',
    ]);
  });

  it('closes when the suggestion goes', () => {
    const { control, events } = setup();
    control.show(zoom);
    control.hide();
    assert.equal(control.current(), null);
    assert.deepEqual(events, ['open 1', 'destroy 1']);
  });

  it('keeps a new window when the one before reports closing late', () => {
    const { control, events, deliverClosed } = setup();
    control.show(zoom);
    control.hide();
    control.show(teams);
    deliverClosed();
    assert.deepEqual(control.current(), teams);
    control.hide();
    assert.deepEqual(events, ['open 1', 'destroy 1', 'open 2', 'destroy 2']);
  });

  it('hides instead of closing while its page captures the recording', () => {
    const { control, events, capture } = setup();
    control.show(zoom);
    capture(1, true);
    control.hide();
    capture(1, false);
    assert.deepEqual(events, ['open 1', 'hide 1', 'hide 1', 'destroy 1']);
  });

  it('shows a suggestion that came during the capture once it is over', () => {
    const { control, events, capture } = setup();
    control.show(zoom);
    capture(1, true);
    control.hide();
    control.show(teams);
    assert.deepEqual(events, ['open 1', 'hide 1', 'hide 1', 'hide 1']);
    capture(1, false);
    assert.deepEqual(events.slice(4), [
      `send 1 ${JSON.stringify(teams)}`,
      'show 1',
    ]);
  });

  it('stays while it still shows a suggestion after its capture ended', () => {
    const { control, events, capture } = setup();
    control.show(zoom);
    capture(1, true);
    capture(1, false);
    control.hide();
    assert.equal(events.at(-1), 'destroy 1');
    assert.equal(events.includes('gone'), false);
  });

  it('tells detection when the system closes the window', () => {
    const { control, events, systemCloses } = setup();
    control.show(zoom);
    systemCloses(1);
    assert.equal(control.current(), null);
    assert.deepEqual(events, ['open 1', 'gone']);
    control.show(teams);
    assert.equal(events.at(-1), 'open 2');
  });

  it('answers only to its own page', () => {
    const { control } = setup();
    control.show(zoom);
    assert.equal(control.owns({}), false);
    control.hide();
    assert.equal(control.owns(undefined), false);
  });
});
