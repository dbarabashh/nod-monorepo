import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';
import type { MicUse } from './parse.ts';
import { createMeetingDetection } from './service.ts';

function setup() {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let report: (use: MicUse) => void = () => {};
  let recording = false;
  const monitor = { running: 0 };
  const shown: string[] = [];
  const detection = createMeetingDetection({
    monitor: (onChange) => {
      report = onChange;
      monitor.running += 1;
      return () => {
        monitor.running -= 1;
        report = () => {};
      };
    },
    now: Date.now,
    selfFilter: () => (user) => user.pid === 1,
    recording: () => recording,
    show: (app) => shown.push(`show ${app.name}`),
    hide: () => shown.push('hide'),
  });
  detection.setSettings({ enabled: true, quiet: [] });
  return {
    detection,
    monitor,
    shown,
    report: (use: MicUse) => report(use),
    record: (on: boolean) => {
      recording = on;
      detection.refresh();
    },
  };
}

describe('detecting a meeting', () => {
  it('shows a suggestion once the call app has held the microphone', (t) => {
    t.after(() => mock.timers.reset());
    const { shown, report } = setup();
    report([{ pid: 50, id: 'us.zoom.xos' }]);
    mock.timers.tick(1_999);
    assert.deepEqual(shown, []);
    mock.timers.tick(1);
    assert.deepEqual(shown, ['show Zoom']);
    report(null);
    assert.deepEqual(shown, ['show Zoom', 'hide']);
  });

  it('ignores this app and apps that are not for calls', (t) => {
    t.after(() => mock.timers.reset());
    const { shown, report } = setup();
    report([
      { pid: 1, id: 'com.google.Chrome.helper' },
      { pid: 60, id: 'com.apple.VoiceMemos' },
      { pid: 61, id: '' },
    ]);
    mock.timers.tick(10_000);
    assert.deepEqual(shown, []);
  });

  it('does not show it again after it was dismissed during the same call', (t) => {
    t.after(() => mock.timers.reset());
    const { detection, shown, report } = setup();
    report([{ pid: 50, id: 'us.zoom.xos' }]);
    mock.timers.tick(2_000);
    detection.dismiss();
    report([
      { pid: 50, id: 'us.zoom.xos' },
      { pid: 51, id: 'us.zoom.xos' },
    ]);
    mock.timers.tick(10_000);
    assert.deepEqual(shown, ['show Zoom']);
  });

  it('hides it when recording starts and stays quiet for that call', (t) => {
    t.after(() => mock.timers.reset());
    const { shown, report, record } = setup();
    report([{ pid: 50, id: 'us.zoom.xos' }]);
    mock.timers.tick(2_000);
    record(true);
    assert.deepEqual(shown, ['show Zoom', 'hide']);

    record(false);
    mock.timers.tick(10_000);
    assert.deepEqual(shown, ['show Zoom', 'hide']);
  });

  it('stops watching the microphone while turned off', (t) => {
    t.after(() => mock.timers.reset());
    const { detection, monitor, shown, report } = setup();
    assert.equal(monitor.running, 1);
    report([{ pid: 50, id: 'us.zoom.xos' }]);
    detection.setSettings({ enabled: false, quiet: [] });
    assert.equal(monitor.running, 0);
    mock.timers.tick(10_000);
    assert.deepEqual(shown, []);

    detection.setSettings({ enabled: true, quiet: [] });
    detection.setSettings({ enabled: true, quiet: ['zoom'] });
    assert.equal(monitor.running, 1);
  });
});
