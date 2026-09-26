---
name: hard-bug
description: Raises effort to xhigh for one bug that resisted a first fix, such as flaky or order-dependent tests, state corruption, persistence or migration failures, lock races, or audit-chain hash mismatches. Reproduce first, prove the new test fails on the unfixed code, then fix.
argument-hint: <symptom, failing test, or issue>
effort: xhigh
---

Fix this bug: $ARGUMENTS

Work in this order. The steps are what extra effort is for, so don't skip ahead:

1. **Reproduce before editing.** Run the failing test or build the smallest reproducer, and keep its exact failing output. If it won't reproduce, stop and report what you tried.
2. **Name the root cause.** Trace the bad value back to where it first goes wrong and state the cause in one sentence before you change code.
3. **Write the regression test first.** Run it against the unfixed code and confirm it fails for that cause, not by accident. For stateful code (store, persistence, audit chain, case engine), prefer a randomized or multi-step sequence checked against a simple reference model over one hand-picked case.
4. **Fix minimally.** Confirm the new test passes, and that it still fails against a partial or naive fix, so it pins the whole bug rather than one symptom.
5. **Run the full gate** with the `gate-runner` subagent.

Report the root cause, the reproducer, the test that pins it, the fix, and the gate result.
