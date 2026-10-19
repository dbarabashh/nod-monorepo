import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Meeting } from '../../core/meetings/index.ts';
import { modelCatalog } from '../../core/models/index.ts';
import type { ModelManager } from '../models/manager.ts';
import type { Transcriber } from '../transcription/service.ts';
import { createRecorder } from './recorder.ts';
import { createMeetingSession } from './session.ts';

function setup(captureGraceMs = 0) {
  let time = 1_000;
  let ids = 0;
  const calls: string[] = [];
  let summaryResult = () => Promise.resolve('We agreed.');
  let flushResult = () => Promise.resolve();
  let saved: Meeting[] = [];
  const recorder = createRecorder({
    store: {
      load: async () => saved,
      save: async (meetings) => {
        saved = meetings;
      },
      flush: async () => {},
    },
    now: () => time,
    newId: () => `m${++ids}`,
    every: () => () => {},
    onChange: () => {},
  });
  const transcriber: Transcriber = {
    start: (meetingId, offsetMs) => {
      calls.push(`start ${meetingId} ${offsetMs}`);
    },
    audio: () => {},
    flush: () => {
      calls.push('flush');
      return flushResult();
    },
    summarize: () => {
      calls.push('summarize');
      return summaryResult();
    },
  };
  const models: ModelManager = {
    list: async () => [],
    download: async () => {},
    cancel: () => {},
    remove: async () => {},
    installed: async (kind) => {
      const model = modelCatalog.find((entry) => entry.kind === kind);
      return model ? { model, path: (name) => `/models/${name}` } : null;
    },
  };
  const session = createMeetingSession({
    recorder,
    models,
    transcriber,
    now: () => time,
    captureGraceMs,
  });
  return {
    recorder,
    session,
    calls,
    advance: (ms: number) => {
      time += ms;
    },
    failSummary: () => {
      summaryResult = () => Promise.reject(new Error('out of memory'));
    },
    setFlush: (result: () => Promise<void>) => {
      flushResult = result;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createMeetingSession', () => {
  it('finishing a paused meeting leaves another recording running', async () => {
    const { recorder, session, calls, advance } = setup();
    await recorder.load();
    await session.start('A');
    advance(5_000);
    await session.pause();
    await session.start('B');
    calls.length = 0;

    await session.finish('m1');

    assert.deepEqual(recorder.state(), {
      status: 'recording',
      meetingId: 'm2',
      segmentStartedAt: 6_000,
      previousMs: 0,
    });
    assert.equal(calls.includes('flush'), false);
  });

  it('runs a resume sent during a finish after it, so it is refused', async () => {
    const { recorder, session } = setup();
    await recorder.load();
    await session.start('A');
    const finishing = session.finish('m1');
    const resuming = session.resume('m1');
    await finishing;
    await assert.rejects(resuming, /cannot be resumed/);
    assert.deepEqual(recorder.state(), { status: 'idle' });
  });

  it('starts transcription where the earlier recording left off', async () => {
    const { recorder, session, calls, advance } = setup();
    await recorder.load();
    await session.start('A');
    advance(30_000);
    await session.pause();
    advance(60_000);
    await session.resume('m1');
    assert.deepEqual(calls, ['start m1 0', 'flush', 'start m1 30000']);
  });

  it('writes one summary when finish is clicked twice', async () => {
    const { recorder, session, calls } = setup();
    await recorder.load();
    await session.start('A');
    await recorder.appendLines('m1', [
      { speaker: 'me', startMs: 0, endMs: 1_000, text: 'Ship it.' },
    ]);
    await Promise.all([session.finish('m1'), session.finish('m1')]);
    await settle();
    assert.equal(calls.filter((call) => call === 'summarize').length, 1);
    assert.equal(recorder.transcriptOf('m1')?.summary, 'We agreed.');
  });

  it('marks a failed summary so it can be tried again', async () => {
    const { recorder, session, failSummary } = setup();
    await recorder.load();
    await session.start('A');
    await recorder.appendLines('m1', [
      { speaker: 'me', startMs: 0, endMs: 1_000, text: 'Ship it.' },
    ]);
    failSummary();
    await session.finish('m1');
    await settle();
    assert.equal(recorder.detail('m1').summaryStatus, 'failed');
  });

  it('restarts transcription that crashed, but not forever', async () => {
    const { recorder, session, calls, advance } = setup();
    await recorder.load();
    await session.start('A');
    calls.length = 0;
    for (let crash = 0; crash < 4; crash += 1) {
      advance(1_000);
      session.transcriptionFailed('crashed', true);
      await settle();
    }
    assert.deepEqual(calls, [
      'start m1 1000',
      'start m1 2000',
      'start m1 3000',
    ]);
    assert.match(recorder.detail('m1').problem ?? '', /stopped/);
  });

  it('starts the next meeting while the last one is still being transcribed', async () => {
    const { recorder, session, setFlush } = setup();
    await recorder.load();
    await session.start('A');
    let finishFlush = () => {};
    setFlush(
      () =>
        new Promise<void>((resolve) => {
          finishFlush = resolve;
        }),
    );
    const pausing = session.pause();
    await session.start('B');
    assert.equal(recorder.state().status, 'recording');
    finishFlush();
    await pausing;
  });

  it('finishes a meeting even when its last audio could not be transcribed', async () => {
    const { recorder, session, setFlush } = setup();
    await recorder.load();
    await session.start('A');
    setFlush(() => Promise.reject(new Error('decoder crashed')));
    await session.finish('m1');
    assert.equal(recorder.summaries()[0]?.status, 'finished');
    assert.match(
      recorder.detail('m1').problem ?? '',
      /couldn’t be made: decoder crashed/,
    );
  });

  it('keeps taking audio after a pause until capture says it has stopped', async () => {
    const { recorder, session, calls } = setup(60_000);
    await recorder.load();
    await session.start('A');
    const pausing = session.pause();
    await settle();

    assert.deepEqual(recorder.state(), { status: 'idle' });
    assert.equal(session.acceptsAudio(), true);
    assert.equal(calls.includes('flush'), false);

    session.captureStopped();
    await pausing;
    assert.equal(calls.at(-1), 'flush');
    assert.equal(session.acceptsAudio(), false);
  });

  it('never writes a new summary over one corrected by hand', async () => {
    const { recorder, session, calls } = setup();
    await recorder.load();
    await session.start('A');
    await recorder.appendLines('m1', [
      { speaker: 'me', startMs: 0, endMs: 1_000, text: 'Ship it.' },
    ]);
    await session.finish('m1');
    await settle();
    await recorder.editSummary('m1', 'We agreed with Ann.');
    calls.length = 0;

    await session.summarize('m1');

    assert.equal(calls.includes('summarize'), false);
    assert.equal(recorder.transcriptOf('m1')?.summary, 'We agreed with Ann.');
  });
});
