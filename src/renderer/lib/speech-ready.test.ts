import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { ModelInfo } from '../../shared/ipc.ts';
import { firstSpeechDownload, speechReadiness } from './speech-ready.ts';

function model(
  id: string,
  kind: ModelInfo['kind'],
  status: ModelInfo['status'],
  extra: Partial<ModelInfo> = {},
): ModelInfo {
  return {
    id,
    kind,
    name: id,
    description: '',
    languages: '',
    license: '',
    recommended: false,
    sizeBytes: 100,
    downloadedBytes: 0,
    status,
    error: null,
    ...extra,
  };
}

const parakeet = (
  status: ModelInfo['status'],
  extra: Partial<ModelInfo> = {},
) => model('parakeet', 'speech', status, { recommended: true, ...extra });

describe('speechReadiness', () => {
  it('is ready once any speech model is downloaded', () => {
    assert.equal(
      speechReadiness([
        parakeet('downloading'),
        model('small', 'speech', 'downloaded'),
      ]),
      'ready',
    );
  });

  it('is downloading while a speech model is on its way', () => {
    assert.equal(speechReadiness([parakeet('downloading')]), 'downloading');
  });

  it('ignores a downloaded summary model', () => {
    assert.equal(
      speechReadiness([
        parakeet('paused'),
        model('qwen', 'summary', 'downloaded'),
      ]),
      'missing',
    );
  });
});

describe('firstSpeechDownload', () => {
  it('picks the recommended speech model when nothing was started', () => {
    assert.equal(
      firstSpeechDownload([
        model('small', 'speech', 'available'),
        parakeet('available'),
        model('qwen', 'summary', 'available', { recommended: true }),
      ]),
      'parakeet',
    );
  });

  it('picks the speech model even when a summary model is recommended first or busy', () => {
    assert.equal(
      firstSpeechDownload([
        model('qwen', 'summary', 'downloading', { recommended: true }),
        parakeet('available'),
      ]),
      'parakeet',
    );
  });

  it('starts nothing when no speech model is recommended', () => {
    assert.equal(
      firstSpeechDownload([model('small', 'speech', 'available')]),
      null,
    );
  });

  it('leaves a paused, partly downloaded or failed download alone', () => {
    assert.equal(firstSpeechDownload([parakeet('paused')]), null);
    assert.equal(
      firstSpeechDownload([parakeet('available', { downloadedBytes: 10 })]),
      null,
    );
    assert.equal(
      firstSpeechDownload([parakeet('available', { error: 'network' })]),
      null,
    );
  });

  it('starts nothing when a speech model is already there or on its way', () => {
    assert.equal(
      firstSpeechDownload([
        parakeet('available'),
        model('small', 'speech', 'downloaded'),
      ]),
      null,
    );
    assert.equal(firstSpeechDownload([parakeet('downloading')]), null);
  });
});
