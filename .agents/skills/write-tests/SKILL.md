---
name: write-tests
description: Write, update or review unit tests with node:test, and keep them free of false positives. Use when adding tests, when changing logic that existing tests cover, when a test fails after a change, or when asked whether code is tested.
---

# Write tests

Tests run on Node's built-in runner with no test framework: `node:test` for
structure and `node:assert` for checks. Node strips TypeScript types itself, so
there is no build step. `.agents/rules/testing.md` holds the non-negotiables.
This skill is the workflow.

The goal is not green. A test exists to fail when the behavior it describes
breaks. A test that can't fail is worse than no test, because it reports safety
that isn't there.

## What is worth testing

Test by risk, not by coverage. Before writing a test, ask: **if this broke,
would we notice quickly and cheaply without a test?** If yes, the test costs
more than it saves. If no, write it.

Worth a test:

- **Breakage that is silent or late.** Wrong output that looks plausible: a
  merge that drops an edit, a migration that loses a field, an encryption
  round-trip that corrupts bytes. Nobody notices until data is gone.
- **Breakage that is expensive.** Anything touching user data, sync, crypto,
  stored formats, or what leaves the device.
- **Real decisions.** Branching, parsing, validation, edge cases, ordering,
  conflict rules. The places where a reasonable change can be subtly wrong.
- **Contracts.** Stored data formats and sync messages that older versions on
  other devices still read, and IPC input validation at the trust boundary.
- **Bugs that happened.** A fixed bug gets a test that fails without the fix,
  because a bug that happened once tends to come back.

Not worth a test:

- **Glue and pass-through.** Code that only wires calls together, with no
  decisions of its own: the main entry, a handler that only forwards, a
  barrel file.
- **What the type checker already guarantees.** Shapes, required fields, and
  which function accepts what.
- **Other people's code.** Electron, Node, the UI framework, a library. Test
  how we use it only when our usage carries a decision.
- **Breakage that is loud and immediate.** The window doesn't open, the app
  crashes on start, a screen is visibly broken. Running the app catches these.
- **Implementation details.** Private helpers, call order, internal state. Test
  through the public behavior so a refactor doesn't break green tests.
- **Code that is about to change.** A spike or a prototype. Add tests when the
  shape settles.

When unsure, prefer one strong test of the behavior that matters over several
weak ones. A small set of tests that can really fail beats a large set that
can't.

### By package

This usually works out as:

- **`packages/core`**: most of the tests, because silent, expensive breakage
  lives here and both apps depend on it. Use known test vectors for crypto and
  serialization, so every client provably reads the same data.
- **`apps/desktop/src/main`**: IPC input validation and handlers that make
  decisions. Pass Electron, the filesystem and the clock in as parameters and
  use small fakes. Not the wiring, and never import the main entry in a test.
- **`apps/desktop/src/renderer`** and **`apps/mobile/src`**: pure helpers in
  `features/<feature>/lib/` and `lib/` that transform or decide something. No
  DOM, component, screen or native-module tests: Node can't load the DOM,
  `react-native` or Expo modules. Keep decisions in a pure function next to
  them, and check the rest by running the app.

If code that is worth testing is hard to test because it reaches for a global
(`Date.now()`, `Math.random()`, `app`, `fs`), fix the code by injecting the
dependency. Don't work around it in the test.

## Writing a test

Place `foo.test.ts` next to `foo.ts`. Every relative import, in tests and in
source, carries the `.ts` extension (`./merge.ts`, not `./merge`),
because Node resolves files exactly and doesn't guess extensions. The linter
enforces this (`import/extensions`). Use `import type` for types:

```ts
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mergeNotes, type Note } from './merge.ts';

describe('mergeNotes', () => {
  it('keeps edits from both devices when they touch different notes', () => {
    const local: Note[] = [{ id: 'a', text: 'local edit', rev: 2 }];
    const remote: Note[] = [{ id: 'b', text: 'remote edit', rev: 1 }];

    assert.deepEqual(mergeNotes(local, remote), [
      { id: 'a', text: 'local edit', rev: 2 },
      { id: 'b', text: 'remote edit', rev: 1 },
    ]);
  });
});
```

- Use `assert` from `node:assert` in strict mode (`strict as assert`). It
  compares with `Object.is` and checks prototypes.
- Name each test as the behavior it guarantees, not the function it calls.
- Each test sets up its own data. No shared mutable state between tests.
- Test the edges, not just the happy path: empty input, one item, duplicates,
  boundaries, invalid input (`assert.throws` / `assert.rejects` with the
  expected error message or class).
- For time, use `mock.timers` from `node:test` or an injected clock. Never
  sleep.
- Never use `.only` in committed code.

## False positives: the checklist

Go through this for every test you write or change:

1. **Can it fail?** Break the code under test (flip a condition, return early,
   off-by-one) and run `pnpm test`. The test must go red, and for the reason you
   expect. Restore the code. If it stays green, the test checks nothing.
2. **Is the expected value independent?** It is written by hand from the spec or
   a known vector, never produced by calling the code under test or by
   re-implementing its logic in the test.
3. **Does every assertion run?** Every promise is awaited. No assertions inside
   callbacks that may never fire; use `t.plan(n)` if a callback must run. No
   `try { ... } catch {}` around the code under test.
4. **Is it testing the real thing?** The unit under test isn't mocked. Fakes
   replace only its dependencies, and the test checks real output, not only
   that a fake was called.
5. **Is the assertion specific?** `deepEqual` on the whole result beats
   `ok(result.length > 0)`. A loose check passes on wrong output.
6. **Did the count change?** `pnpm test` prints `tests N`. Check N went up by
   the number of tests you added. A test file the glob doesn't match never runs,
   and zero tests still exits green.

## When logic changes

1. Before editing, find the tests that cover the code:

   ```sh
   grep -rln "<function or module name>" apps packages --include='*.test.ts'
   ```

2. Read them and note which expectations the change should affect.
3. Make the change and run `pnpm test`.
4. For each failing test, decide which side is wrong:
   - **The behavior changed on purpose.** Update the expectation to the new
     behavior and mention it in the handoff ("updated X because Y now does Z").
   - **It didn't.** The test caught a regression. Fix the code, not the test.
5. For each test that still passes, ask whether it should have failed. If it
   covers the changed logic but stayed green, it is too loose. Tighten it, then
   prove it can fail (checklist item 1).
6. Add tests for new branches the change introduced.

Never delete or skip a failing test to finish a task. If a test looks wrong and
you aren't sure, ask.

## Run

```sh
pnpm test                                     # every package, from the root
pnpm --filter @nod/core test                  # one package
node --test <path>.test.ts                    # one file
node --test --test-name-pattern="keeps edits" "src/**/*.test.ts"
pnpm typecheck                                # tests aren't type-checked by the runner
```

Node runs the type-stripped code without type-checking it, so always run
`pnpm typecheck` too.

## Limits

- Tests run on system Node, not inside Electron or on Hermes. Native modules
  built for Electron won't load: test core against an in-memory fake of the
  storage interface, and test the real adapter separately under Electron's Node
  (`ELECTRON_RUN_AS_NODE=1 pnpm exec electron --test <file>` from `apps/desktop`). A test
  must not import `react-native`, `expo-*` or anything that does, directly or
  through a barrel.
- Code that uses Vite features (`import.meta.env`, CSS imports, `?raw`, the
  Forge `MAIN_WINDOW_VITE_*` globals) can't be imported in a test. Keep testable
  logic in modules without them.
- No `enum`, `namespace`, decorators or constructor parameter properties.
  `erasableSyntaxOnly` in each `tsconfig.json` enforces this.
