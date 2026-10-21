import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { modelCatalog } from '@nod/core/models';
import type { ModelManager } from '../models/manager.ts';
import type { Transcriber } from '../transcription/service.ts';
import { createRecorder } from './recorder.ts';
import { createMeetingSession } from './session.ts';

function setup(captureGraceMs = 0) {
  let time = 1_000;
  let ids = 0;
  const calls: string[] = [];
  let summaryResult = () =>
    Promise.resolve({ summary: 'We agreed.', title: 'Shipping plan' });
  let flushResult = () => Promise.resolve();
  let speechInstalled = true;
  let speechDownloading = false;
  let startFailure: Error | null = null;
  const recorder = createRecorder({
    store: {
      load: async () => [],
      save: async () => {},
      remove: async () => {},
      isDeleted: () => false,
      importMeeting: async () => {},
    },
    now: () => time,
    newId: () => `m${++ids}`,
    every: () => () => {},
    onChange: () => {},
  });
  const transcriber: Transcriber = {
    start: (meetingId, offsetMs) => {
      if (startFailure) {
        throw startFailure;
      }
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
    list: async () =>
      speechDownloading
        ? [
            {
              id: 'parakeet-tdt-0.6b-v3',
              kind: 'speech',
              name: 'Parakeet',
              description: '',
              languages: '',
              license: '',
              recommended: true,
              sizeBytes: 100,
              downloadedBytes: 40,
              status: 'downloading',
              error: null,
            },
          ]
        : [],
    download: async () => {},
    cancel: () => {},
    remove: async () => {},
    installed: async (kind) => {
      if (kind === 'speech' && !speechInstalled) {
        return null;
      }
      const model = modelCatalog.find((entry) => entry.kind === kind);
      return model ? { model, path: (name) => `/models/${name}` } : null;
    },
  };
  let captureFinished = 0;
  const session = createMeetingSession({
    recorder,
    models,
    transcriber,
    now: () => time,
    captureGraceMs,
    onCaptureFinished: () => {
      captureFinished += 1;
    },
  });
  return {
    recorder,
    session,
    calls,
    captureFinished: () => captureFinished,
    advance: (ms: number) => {
      time += ms;
    },
    failSummary: () => {
      summaryResult = () => Promise.reject(new Error('out of memory'));
    },
    setFlush: (result: () => Promise<void>) => {
      flushResult = result;
    },
    removeSpeech: () => {
      speechInstalled = false;
    },
    failStart: (error: Error) => {
      startFailure = error;
    },
    downloadSpeech: () => {
      speechInstalled = false;
      speechDownloading = true;
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
      { id: 'me-0', speaker: 'me', startMs: 0, endMs: 1_000, text: 'Ship it.' },
    ]);
    await Promise.all([session.finish('m1'), session.finish('m1')]);
    await settle();
    assert.equal(calls.filter((call) => call === 'summarize').length, 1);
    assert.equal(recorder.transcriptOf('m1')?.summary, 'We agreed.');
  });

  it('names a finished meeting along with its summary', async () => {
    const { recorder, session } = setup();
    await recorder.load();
    await session.start('Meeting on Oct 19, 2026, 2:19 PM');
    await recorder.appendLines('m1', [
      { id: 'l1', speaker: 'me', startMs: 0, endMs: 1_000, text: 'Ship it.' },
    ]);
    await session.finish('m1');
    await settle();
    assert.equal(recorder.summaries()[0]?.title, 'Shipping plan');
  });

  it('marks a failed summary so it can be tried again', async () => {
    const { recorder, session, failSummary } = setup();
    await recorder.load();
    await session.start('A');
    await recorder.appendLines('m1', [
      { id: 'me-0', speaker: 'me', startMs: 0, endMs: 1_000, text: 'Ship it.' },
    ]);
    failSummary();
    await session.finish('m1');
    await settle();
    assert.equal(recorder.detail('m1').summaryStatus, 'failed');
  });

  it('refuses to record without a speech model, since the audio would be lost', async () => {
    const { recorder, session, calls, removeSpeech } = setup();
    await recorder.load();
    await session.start('A');
    await session.pause();
    removeSpeech();
    calls.length = 0;
    await assert.rejects(session.start('B'), /needs a speech model/);
    await assert.rejects(session.resume('m1'), /needs a speech model/);
    assert.deepEqual(calls, []);
    assert.deepEqual(
      recorder.summaries().map((meeting) => [meeting.title, meeting.status]),
      [['A', 'paused']],
    );
    assert.equal(recorder.state().status, 'idle');
  });

  it('pauses and refuses a start whose transcription can’t begin', async () => {
    const { recorder, session, calls, failStart } = setup();
    await recorder.load();
    failStart(new Error('model file is damaged'));
    await assert.rejects(
      session.start('A'),
      /couldn’t start: model file is damaged/,
    );
    assert.deepEqual(calls, ['flush']);
    assert.equal(recorder.state().status, 'idle');
    assert.equal(
      recorder.detail('m1').problem,
      'Recording paused because transcription couldn’t start: model file is damaged',
    );
  });

  it('tells a recording started during the speech model download to wait for it', async () => {
    const { recorder, session, downloadSpeech } = setup();
    await recorder.load();
    downloadSpeech();
    await assert.rejects(session.start('A'), /still downloading/);
    assert.deepEqual(recorder.summaries(), []);
  });

  it('pauses when the speech model is gone by the time transcription restarts', async () => {
    const { recorder, session, calls, removeSpeech } = setup();
    await recorder.load();
    await session.start('A');
    removeSpeech();
    calls.length = 0;
    session.transcriptionFailed('m1', 'crashed', 'crashed', true);
    await settle();
    await settle();
    assert.deepEqual(calls, ['flush']);
    assert.equal(recorder.state().status, 'idle');
    assert.equal(
      recorder.detail('m1').problem,
      'Recording paused: transcription needs a speech model. Download one in Settings → Transcription, then resume.',
    );
  });

  it('keeps recording when only part of the transcript was lost', async () => {
    const { recorder, session, calls } = setup();
    await recorder.load();
    await session.start('A');
    calls.length = 0;
    session.transcriptionFailed('m1', 'part-lost', 'out of memory', true);
    await settle();
    assert.deepEqual(calls, []);
    assert.equal(recorder.state().status, 'recording');
    assert.equal(
      recorder.detail('m1').problem,
      'Part of the transcript couldn’t be made: out of memory',
    );
  });

  it('restarts transcription that crashed, then pauses the recording', async () => {
    const { recorder, session, calls, advance } = setup();
    await recorder.load();
    await session.start('A');
    calls.length = 0;
    for (let crash = 0; crash < 4; crash += 1) {
      advance(1_000);
      session.transcriptionFailed('m1', 'crashed', 'crashed', true);
      await settle();
    }
    await settle();
    assert.deepEqual(calls, [
      'start m1 1000',
      'start m1 2000',
      'start m1 3000',
      'flush',
    ]);
    assert.equal(recorder.state().status, 'idle');
    assert.equal(
      recorder.detail('m1').problem,
      'Recording paused because transcription stopped: crashed',
    );
  });

  it('pauses at once when the speech model can’t be loaded, without retrying', async () => {
    const { recorder, session, calls } = setup();
    await recorder.load();
    await session.start('A');
    calls.length = 0;
    session.transcriptionFailed(
      'm1',
      'unloadable',
      'The model is damaged.',
      true,
    );
    await settle();
    await settle();
    assert.deepEqual(calls, ['flush']);
    assert.equal(recorder.state().status, 'idle');
    assert.equal(
      recorder.detail('m1').problem,
      'Recording paused because transcription stopped: The model is damaged.',
    );
  });

  it('only notes trouble from a paused meeting’s last seconds', async () => {
    const { recorder, session, calls } = setup();
    await recorder.load();
    await session.start('A');
    await session.pause();
    await session.start('B');
    calls.length = 0;
    session.transcriptionFailed('m1', 'crashed', 'crashed', false);
    session.transcriptionFailed(
      'm1',
      'unloadable',
      'The model is damaged.',
      false,
    );
    await settle();
    await settle();
    assert.deepEqual(calls, []);
    const state = recorder.state();
    assert.equal(state.status === 'recording' && state.meetingId, 'm2');
    assert.equal(
      recorder.detail('m1').problem,
      'Part of the transcript couldn’t be made: The model is damaged.',
    );
    assert.equal(recorder.detail('m2').problem, null);
  });

  it('doesn’t pause the recording for trouble from an earlier segment', async () => {
    const { recorder, session, calls } = setup();
    await recorder.load();
    await session.start('A');
    calls.length = 0;
    session.transcriptionFailed('m1', 'crashed', 'crashed', false);
    session.transcriptionFailed(
      'm1',
      'unloadable',
      'The model is damaged.',
      false,
    );
    await settle();
    await settle();
    assert.deepEqual(calls, []);
    assert.equal(recorder.state().status, 'recording');
    assert.equal(
      recorder.detail('m1').problem,
      'Part of the transcript couldn’t be made: The model is damaged.',
    );
  });

  it('notes the lost tail instead of restarting once its meeting has been paused', async () => {
    const { recorder, session, calls } = setup();
    await recorder.load();
    await session.start('A');
    const paused = session.pause();
    session.transcriptionFailed('m1', 'crashed', 'crashed', true);
    await paused;
    await settle();
    assert.deepEqual(calls, ['start m1 0', 'flush']);
    assert.equal(recorder.state().status, 'idle');
    assert.equal(
      recorder.detail('m1').problem,
      'Part of the transcript couldn’t be made: crashed',
    );
  });

  it('notes the lost tail when transcription stops while a pause is under way', async () => {
    const { recorder, session, calls } = setup();
    await recorder.load();
    await session.start('A');
    await session.pause();
    calls.length = 0;
    session.transcriptionFailed(
      'm1',
      'crashed',
      'Transcription stopped unexpectedly',
      true,
    );
    await settle();
    assert.deepEqual(calls, []);
    assert.equal(
      recorder.detail('m1').problem,
      'Part of the transcript couldn’t be made: Transcription stopped unexpectedly',
    );
  });

  it('doesn’t restart transcription that a resume already started again', async () => {
    const { recorder, session, calls, advance } = setup();
    await recorder.load();
    await session.start('A');
    advance(1_000);
    const paused = session.pause();
    const resumed = session.resume('m1');
    session.transcriptionFailed('m1', 'crashed', 'crashed', true);
    await paused;
    await resumed;
    await settle();
    assert.deepEqual(calls, ['start m1 0', 'flush', 'start m1 1000']);
    assert.equal(recorder.detail('m1').problem, null);
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
    const { recorder, session, calls, captureFinished } = setup(60_000);
    await recorder.load();
    await session.start('A');
    const pausing = session.pause();
    await settle();

    assert.deepEqual(recorder.state(), { status: 'idle' });
    assert.equal(session.acceptsAudio(), true);
    assert.equal(calls.includes('flush'), false);
    assert.equal(captureFinished(), 0);

    session.captureStopped();
    await pausing;
    assert.equal(calls.at(-1), 'flush');
    assert.equal(captureFinished(), 1);
    assert.equal(session.acceptsAudio(), false);
  });

  it('never writes a new summary over one corrected by hand', async () => {
    const { recorder, session, calls } = setup();
    await recorder.load();
    await session.start('A');
    await recorder.appendLines('m1', [
      { id: 'me-0', speaker: 'me', startMs: 0, endMs: 1_000, text: 'Ship it.' },
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
