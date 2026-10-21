import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as Automerge from '@automerge/automerge';
import { createBackend } from '../backend.ts';
import { loadWasmCore } from './wasm-core.ts';
import { scenarioFixtures } from './scenario-fixtures.ts';
import {
  compareWithFixtures,
  fingerprintScenarios,
  runScenario,
  runScenarios,
} from './scenarios.ts';

const alice = 'aa'.repeat(16);

const wasmResults = runScenarios();
const wasmHandleMethods = new Set(
  Object.getOwnPropertyNames(
    Object.getPrototypeOf(Automerge.getBackend(Automerge.init())),
  ).filter((name) => name !== 'constructor' && !name.startsWith('__')),
);
const wasmSaved = Automerge.save(
  Automerge.from(
    { text: 'from wasm', n: 0, list: [new Date(5)] },
    { actor: alice },
  ),
);

describe('the scenario fixtures', () => {
  it('still describe what the wasm backend writes', () => {
    assert.deepEqual(fingerprintScenarios(wasmResults), scenarioFixtures);
  });
});

describe('the native Automerge backend', () => {
  Automerge.use(createBackend(loadWasmCore()));

  for (const name of Object.keys(scenarioFixtures)) {
    it(`matches the wasm backend: ${name}`, () => {
      assert.deepEqual(runScenario(name), wasmResults[name]);
    });
  }

  it('passes the check the phone runs against the fixtures', () => {
    const results = compareWithFixtures(runScenarios(), scenarioFixtures);
    assert.deepEqual(
      results.filter((result) => !result.ok),
      [],
    );
    assert.equal(results.length, Object.keys(scenarioFixtures).length);
  });

  it('reads what the wasm backend saved and saves it back identically', () => {
    const doc = Automerge.load(wasmSaved);
    assert.deepEqual(Automerge.toJS(doc), {
      text: 'from wasm',
      n: 0,
      list: [new Date(5)],
    });
    assert.deepEqual([...Automerge.save(doc)], [...wasmSaved]);
  });

  it('has every method of the wasm document handle', () => {
    const native = Automerge.getBackend(Automerge.init());
    const missing = [...wasmHandleMethods].filter(
      (name) => typeof Reflect.get(native, name) !== 'function',
    );
    assert.deepEqual(missing, []);
  });

  it('refuses what it does not implement instead of guessing', () => {
    assert.throws(
      () => Automerge.decodeChange(new Uint8Array([1])),
      /not supported by the native Automerge backend/,
    );
  });

  it('reports a corrupt document as an error', () => {
    assert.throws(() => Automerge.load(new Uint8Array([1, 2, 3])));
  });
});
