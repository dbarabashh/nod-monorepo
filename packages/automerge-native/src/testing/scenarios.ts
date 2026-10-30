import * as Automerge from '@automerge/automerge';

const alice = 'aa'.repeat(16);
const bob = 'bb'.repeat(16);

export type Outcome = {
  bytes: number[];
  heads: string[];
  json: unknown;
  extra: unknown;
};

function outcome(doc: Automerge.Doc<unknown>, extra: unknown = null): Outcome {
  return {
    bytes: [...Automerge.save(doc)],
    heads: Automerge.getHeads(doc),
    json: Automerge.toJS(doc),
    extra,
  };
}

// Each scenario runs once on the wasm backend Automerge ships with and once on
// the native backend; the two must agree byte for byte.
export const scenarios: Record<string, () => Outcome> = {
  'initial values of every kind': () => {
    const doc = Automerge.from(
      {
        zero: 0,
        one: 1,
        negative: -3,
        fraction: 1.5,
        big: 2n ** 60n,
        huge: 2n ** 63n,
        maxSafe: Number.MAX_SAFE_INTEGER,
        when: new Date(1_700_000_000_123),
        bytes: new Uint8Array([0, 1, 254, 255]),
        none: null,
        yes: true,
        name: new Automerge.ImmutableString('fixed name'),
        count: new Automerge.Counter(5),
        text: 'héllo 👋 world',
        list: [1, 'two', { three: [3] }, [], {}],
        nested: { deeper: { deepest: 'x' } },
        '10': 'numeric key',
        '2': 'another',
      },
      { actor: alice },
    );
    return outcome(doc);
  },
  'edits in a change': () => {
    let doc = Automerge.from(
      {
        title: 'draft',
        items: [{ n: 1 }, { n: 2 }],
        counter: new Automerge.Counter(1),
      },
      { actor: alice },
    );
    doc = Automerge.change(doc, { time: 1_000, message: 'edit' }, (d) => {
      Automerge.updateText(d, ['title'], 'final draft ✓');
      d.items.push({ n: 3 });
      d.items.splice(0, 1);
      d.counter.increment(4);
      Reflect.set(d, 'added', { list: ['a', 'b'], flag: false });
      Reflect.deleteProperty(d, 'title');
    });
    return outcome(doc);
  },
  'fixed author and time': () => {
    const doc = Automerge.change(
      Automerge.init<Record<string, unknown>>({ actor: alice }),
      { time: 0 },
      (d) => {
        Object.assign(d, {
          schema: 1,
          id: 'meeting-1',
          title: new Automerge.ImmutableString('Weekly'),
          segments: [{ startedAt: 10, endedAt: null }],
          lines: {
            a: { speaker: 'me', startMs: 0, endMs: 1200, text: 'hello' },
          },
          summary: '',
          deletedAt: null,
        });
      },
    );
    return outcome(Automerge.clone(doc, { actor: bob }));
  },
  'concurrent edits and conflicts': () => {
    const base = Automerge.from(
      { title: 'base', text: 'shared text' },
      { actor: alice },
    );
    let left = Automerge.clone(base, { actor: alice });
    let right = Automerge.clone(base, { actor: bob });
    left = Automerge.change(left, { time: 5 }, (d) => {
      d.title = 'left';
      Automerge.splice(d, ['text'], 0, 0, 'left ');
    });
    right = Automerge.change(right, { time: 6 }, (d) => {
      d.title = 'right';
      Automerge.splice(d, ['text'], 11, 0, ' right');
    });
    const merged = Automerge.merge(left, right);
    return outcome(merged, Automerge.getConflicts(merged, 'title'));
  },
  'load, view and changes': () => {
    let doc = Automerge.from({ a: 1 }, { actor: alice });
    const before = Automerge.getHeads(doc);
    doc = Automerge.change(doc, { time: 9 }, (d) => {
      d.a = 2;
    });
    const loaded = Automerge.load<{ a: number }>(Automerge.save(doc), {
      actor: bob,
    });
    const view = Automerge.view(loaded, before);
    const changes = Automerge.getChanges(Automerge.init(), loaded).map((c) => [
      ...c,
    ]);
    return outcome(loaded, { view: Automerge.toJS(view), changes });
  },
  'patches reported to a callback': () => {
    const patches: unknown[] = [];
    let doc = Automerge.from(
      { list: [1, 2, 3], text: 'abc', name: 'n' },
      { actor: alice },
    );
    doc = Automerge.change(
      doc,
      { time: 1, patchCallback: (p) => patches.push(...p) },
      (d) => {
        d.list.splice(1, 2, 9);
        Automerge.splice(d, ['text'], 1, 1, 'XY');
        d.name = 'm';
        Reflect.set(d, 'obj', { k: [true] });
      },
    );
    return outcome(doc, patches);
  },
  'negative zero': () => {
    let doc = Automerge.from(
      { z: -0, list: [-0, 0], nested: { at: -0 } },
      { actor: alice },
    );
    doc = Automerge.change(doc, { time: 5 }, (d) => {
      Object.assign(d, { lines: { a: { startMs: -0, endMs: 0 } } });
      d.z = -0;
    });
    return outcome(doc, Object.is(doc.z, -0));
  },
  'broken surrogates in text, names and keys': () => {
    let doc = Automerge.from(
      {
        text: 'cut \ud83d mid emoji',
        name: new Automerge.ImmutableString('end \udc00'),
        ['key \ud800']: 'value',
        pair: 'kept 😀',
      },
      { actor: alice },
    );
    doc = Automerge.change(doc, { time: 2 }, (d) => {
      Automerge.updateText(d, ['text'], 'cut \ud83d mid emoji, edited \udfff');
    });
    return outcome(doc);
  },
  'a long meeting': () => {
    const lines: Record<
      string,
      { speaker: string; startMs: number; endMs: number; text: string }
    > = {};
    for (let i = 0; i < 1500; i += 1) {
      lines[`line-${String(i).padStart(5, '0')}`] = {
        speaker: i % 3 === 0 ? 'me' : 'others',
        startMs: i * 4000,
        endMs: i * 4000 + 3500,
        text: `Line ${i}: we talked about item ${i % 17} and agreed on step ${i % 5}.`,
      };
    }
    let doc = Automerge.from(
      { title: 'Long meeting', lines, summary: '' },
      { actor: alice },
    );
    doc = Automerge.change(doc, { time: 3 }, (d) => {
      Automerge.updateText(
        d,
        ['summary'],
        'A summary written after the meeting.',
      );
      Automerge.updateText(
        d,
        ['lines', 'line-00042', 'text'],
        'Corrected line 42.',
      );
    });
    return outcome(doc, Automerge.save(doc).length > 65536);
  },
  'frozen documents': () => {
    let doc = Automerge.from(
      { inner: { list: [1] } },
      { actor: alice, freeze: true },
    );
    const frozen = {
      root: Object.isFrozen(doc),
      inner: Object.isFrozen(doc.inner),
      list: Object.isFrozen(doc.inner.list),
    };
    // After a change only the data is compared: wasm patches the previous
    // objects and leaves the changed ones unfrozen, this backend rebuilds them.
    doc = Automerge.change(doc, { time: 4 }, (d) => {
      d.inner.list.push(2);
    });
    return outcome(doc, frozen);
  },
  'assignments to list positions': () => {
    let doc = Automerge.from<{ letters: unknown[]; items: { n: number }[] }>(
      { letters: ['a', 'b', 'c'], items: [{ n: 1 }, { n: 2 }] },
      { actor: alice },
    );
    doc = Automerge.change(doc, { time: 5 }, (d) => {
      d.letters[1] = 'z';
      d.letters[2] = { now: 'an object' };
      d.items[0] = { n: 10 };
      d.items[1].n = 20;
    });
    return outcome(doc);
  },
  'numbers the raw API casts to indexes': () => {
    const handle = Automerge.getBackend(
      Automerge.clone(
        Automerge.from({ list: [1, 2, 3, 4, 5] }, { actor: alice }),
        { actor: bob },
      ),
    );
    const list = String(handle.get('_root', 'list'));
    handle.put(list, 0.5, 'half');
    handle.insert(list, 1.5, 'inserted');
    handle.splice(list, 2, 1.5, []);
    handle.splice(list, 0, Number.NaN, ['nan']);
    handle.insert(list, -1, 'negative');
    const reads = [
      handle.get(list, 0.5),
      handle.get(list, -1),
      Reflect.apply(handle.get, handle, ['_root', null]),
      Reflect.apply(handle.getAll, handle, ['_root', null]),
    ];
    handle.commit('raw', 6);
    return {
      bytes: [...handle.save()],
      heads: handle.getHeads(),
      json: handle.materialize('/'),
      extra: reads,
    };
  },
  'extreme counts and times': () => {
    let doc = Automerge.from(
      { a: 'hello', b: 'hello', c: 'hello', list: [1, 2, 3, 4, 5] },
      { actor: alice },
    );
    doc = Automerge.change(doc, { time: Infinity }, (d) => {
      Automerge.splice(d, ['a'], 1, Infinity);
      Automerge.splice(d, ['b'], 1, 5e9);
      Reflect.apply(Automerge.splice, undefined, [d, ['c'], 1, undefined, 'X']);
    });
    doc = Reflect.apply(Automerge.emptyChange, undefined, [
      doc,
      { time: new Date(5000) },
    ]);
    const handle = Automerge.getBackend(Automerge.clone(doc, { actor: bob }));
    const list = String(handle.get('_root', 'list'));
    handle.spliceFromHydrate(list, 0, 5e9, []);
    Reflect.apply(handle.commit, handle, [null, new Date(7000)]);
    return {
      bytes: [...Automerge.save(doc), ...handle.save()],
      heads: [...Automerge.getHeads(doc), ...handle.getHeads()],
      json: [Automerge.toJS(doc), handle.materialize('/')],
      extra: [handle.get(list, Infinity), handle.getAll(list, 5e9)],
    };
  },
  'reads inside a change': () => {
    let doc = Automerge.from({ n: 1 }, { actor: alice });
    let missing: unknown = null;
    doc = Automerge.change(doc, { message: 'kept', time: 3 }, (d) => {
      d.n = 5;
      missing = Automerge.getMissingDeps(d, []);
    });
    return outcome(doc, missing);
  },
  // A text edit saved from an editor that opened an older version: core
  // applies it where the editor saw the text, and Automerge merges it with
  // what arrived since.
  'a text edit made at older heads': () => {
    let doc = Automerge.from({ summary: 'one\ntwo\nthree' }, { actor: alice });
    const seen = Automerge.getHeads(doc);
    doc = Automerge.change(doc, { time: 1 }, (d) => {
      Automerge.updateText(d, ['summary'], 'one\nmiddle\ntwo\nthree');
    });
    const copy = Automerge.clone(doc, { actor: Automerge.getActorId(doc) });
    const edited = Automerge.changeAt(copy, seen, { time: 2 }, (d) => {
      Automerge.updateText(d, ['summary'], 'one\ntwo\nthree\nend');
    });
    return outcome(edited.newDoc, {
      newHeads: edited.newHeads,
      seen: Automerge.toJS(Automerge.view(edited.newDoc, seen)),
    });
  },
};

// FNV-1a over the JSON, so a fixture can hold a long meeting in a few bytes.
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

// Plain JSON for values JSON can't hold, so outcomes can be stored as a fixture
// and compared on a phone, where only the native backend exists.
export function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { $bigint: value.toString() };
  }
  if (value instanceof Date) {
    return { $date: value.getTime() };
  }
  if (value instanceof Uint8Array) {
    return { $bytes: [...value] };
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = normalize(Reflect.get(value, key));
    }
    if (Reflect.get(value, Symbol.for('_am_datatype_')) !== undefined) {
      out.$datatype = Reflect.get(value, Symbol.for('_am_datatype_'));
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { $number: String(value) };
  }
  return value;
}

// Automerge stamps changes that set no time with the clock, so the clock is
// fixed while a scenario runs; otherwise outcomes from different moments differ.
export function runScenario(name: string): unknown {
  const run = scenarios[name];
  if (!run) {
    throw new Error(`no scenario named ${name}`);
  }
  const clock = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    return normalize(run());
  } finally {
    Date.now = clock;
  }
}

export function runScenarios(): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  for (const name of Object.keys(scenarios)) {
    results[name] = runScenario(name);
  }
  return results;
}

export function fingerprintScenarios(
  results: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, result] of Object.entries(results)) {
    out[name] = fingerprint(result);
  }
  return out;
}

export function compareWithFixtures(
  results: Record<string, unknown>,
  fixtures: Record<string, string>,
): { name: string; ok: boolean }[] {
  const fingerprints = fingerprintScenarios(results);
  return Object.keys(fixtures).map((name) => ({
    name,
    ok: fingerprints[name] === fixtures[name],
  }));
}
