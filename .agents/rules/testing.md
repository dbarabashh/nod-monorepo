---
description: Tests must be able to fail, and every logic change must be checked against the tests that cover it.
alwaysApply: true
---

- Every change to logic starts by finding the tests that cover it (`grep -rl "<module or function>" src --include='*.test.ts'`). Decide for each one whether it still describes the intended behavior. Leaving a stale test passing is as bad as having none.
- When a test fails after a change, decide which side is wrong before touching anything. If the behavior changed on purpose, update the expectation and say why in the handoff. If it didn't, fix the code. Never edit an assertion only to make it pass.
- Never weaken a test to get green: no loosened assertions, no deleted cases, no added `skip` or `todo`, no lowered precision, unless the user agrees.
- Prove every new or changed test can fail. Break the code it covers (flip a condition, change a returned value), see the test go red for the right reason, then restore the code.
- Assert exact, hand-written expected values. Never compute the expected value with the code under test or a copy of its logic.
- Never mock the unit under test, and never assert only that a mock was called when the real output can be checked.
- Await every promise and use `assert.rejects` for async errors. A test that ends before its assertions run passes silently.
- Test by risk, not coverage: write a test when breakage would be silent, late or expensive (user data, sync, crypto, stored formats, real decisions). Skip glue, pass-through code, what the type checker guarantees, and other people's code. The criteria are in the `write-tests` skill.
- Bug fixes and data-format changes always ship with tests in the same change. A bug fix gets a test that fails without the fix.
- Run `pnpm test` and read the summary: the test count must match what you expect. Zero tests also exits green.
- Follow the `write-tests` skill for how to write and place tests.
