# Issue #196 Reopened: Supervised Handoff Implementation Plan

<!-- awm-qa-complete: 2026-09-24 -->
<!-- awm-docs-complete: 2026-09-24 -->
<!-- awm-retro-complete: 2026-09-24 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recovered unattended v2 cycle reaches S1 only after a durable dispatch acknowledgement, does not reinterpret RED edits as pre-dispatch sensor failure, and reports its true exit state.

**Architecture:** Keep admission authoritative at generation launch/resume, while a launched generation owns its already-admitted work until a new launch is required. Bind a v2 implementer dispatch record to an applied routing reservation before the controller may start a native child. Return the loop's terminal reason to the CLI instead of assuming every return means COMPLETE.

**Tech Stack:** TypeScript, Commander, Jest, journal schema 2, native secure-fs artifact.

**Modo de ejecución:** interactivo

## Requirements

- **ISSUE-196-R1:** The generation prompt must distinguish mutating `awm job` verbs that require `--generation` from read-only `reconcile` and related verbs that reject it.
- **ISSUE-196-R2:** For a compact v2 implementer, the supervisor must acknowledge a durable dispatch record linked to the applied, matching routing reservation before the controller starts a native child; rejected or conflicting requests cannot create that record. A read-only CLI request-ack query must expose pending/applied/rejected by exact request ID so the controller can wait without parsing state files. The native observation follows launch and remains independently mandatory.
- **ISSUE-196-R3:** A sensor failure caused by ordinary RED work in an already-admitted generation must not become a new pre-dispatch admission BLOCKED state. First launch, changed binding/runtime, and a new generation remain fail-closed.
- **ISSUE-196-R4:** Ctrl-C or SIGTERM must never print COMPLETE unless the journal is actually COMPLETE; an integral CLI test must cover recovery, reservation, dispatch acknowledgement, native observation, and continuation without duplicated S1.

<!-- AWM:COMPACT-SLICES:START v1 -->
{"schema":"compact-slices/v1","planId":"issue-196-reopened-supervised-handoff","requirements":["ISSUE-196-R1","ISSUE-196-R2","ISSUE-196-R3","ISSUE-196-R4"],"sources":[{"id":"SRC-PROMPT","path":"cli/src/commands/watch/generations.ts","locator":"function promptForGeneration","fact":"The current prompt incorrectly requires --generation on every awm job command."},{"id":"SRC-DISPATCH","path":"cli/src/commands/watch/apply.ts","locator":"if (p.entity === 'dispatch')","fact":"The current dispatch registration checks only task existence and accepts no routing-attempt binding."},{"id":"SRC-ADMISSION","path":"cli/src/commands/watch/supervisor.ts","locator":"async tick()","fact":"Every tick repeats full admission before controller and request processing, including ticks during RED edits."},{"id":"SRC-EXIT","path":"cli/src/commands/watch/index.ts","locator":"await runSupervisorLoop(repo, branch, cfg)","fact":"The CLI prints COMPLETE unconditionally after a normally resolved loop promise."}],"commands":[{"id":"CMD-REGRESSION","program":"npm","args":["--prefix","cli","test","--","--runInBand","--silent","tests/commands/watch/reopened-196.test.ts"],"covers":["ISSUE-196-R1","ISSUE-196-R2","ISSUE-196-R3","ISSUE-196-R4"]},{"id":"CMD-WATCH","program":"npm","args":["--prefix","cli","test","--","--runInBand","--silent","tests/commands/watch/supervisor-loop.test.ts","tests/commands/watch/generations.test.ts"],"covers":["ISSUE-196-R1","ISSUE-196-R3","ISSUE-196-R4"]},{"id":"CMD-TYPECHECK","program":"npm","args":["--prefix","cli","run","typecheck"],"covers":["ISSUE-196-R1","ISSUE-196-R2","ISSUE-196-R3","ISSUE-196-R4"]}],"slices":[{"id":"S1","title":"Durable routed dispatch and compatible prompt","requirements":["ISSUE-196-R1","ISSUE-196-R2"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SRC-PROMPT","SRC-DISPATCH"],"redCommands":["CMD-REGRESSION"],"greenCommands":["CMD-REGRESSION","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["public-contract","root-configuration"]},{"id":"S2","title":"Admission cadence and truthful loop exit","requirements":["ISSUE-196-R3","ISSUE-196-R4"],"dependsOn":["S1"],"sectionAnchor":"slice-s2","sources":["SRC-ADMISSION","SRC-EXIT"],"redCommands":["CMD-REGRESSION"],"greenCommands":["CMD-REGRESSION","CMD-WATCH","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["security","public-contract"]}],"closureCommands":["CMD-REGRESSION","CMD-WATCH","CMD-TYPECHECK"]}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Durable routed dispatch and compatible prompt

#### Surfaces

Own ISSUE-196-R1 and ISSUE-196-R2 together because the controller's instructions and the CLI's dispatch-ack contract must agree. Change `cli/src/commands/watch/generations.ts`, `cli/src/commands/watch/apply.ts`, `cli/src/commands/job/index.ts` (read-only ack query), the bounded `DispatchRecord` validator in `cli/src/core/journal/types.ts`, and regression tests. The v1 path remains unchanged.

#### Implementation

- [x] Add failing tests: the real CLI accepts `awm job reconcile` without a token, rejects `reconcile --generation`, and the launched controller prompt explicitly describes both classes. An exact request-ID ack query shows pending before supervisor application and applied with `resultRef` afterward, without mutation. For compact v2, register a task and routing reservation, then show that a dispatch lacking an applied, slice-matching `routingAttemptId` is rejected and records no dispatch.
- [x] Run CMD-REGRESSION; failures must be behavioral, not missing native artifact or test setup.
- [x] Narrow the prompt to generation-fenced mutating verbs and name the read-only ack query. For v2 implementer dispatch, require a nonempty `routingAttemptId` referring to a `reserved` attempt whose envelope role is `implementer`, whose slice ID equals the task ID, and whose plan identity equals the bound plan. Persist that ID on the dispatch record, reject conflicts on replay, and keep historical records readable. The ack query reads a validated journal and emits bounded status only; absence is pending only when the exact request is still queued, otherwise unknown.
- [x] Run CMD-REGRESSION and CMD-TYPECHECK. Verify applied ack exists before the test's simulated native launch, then observe natively afterward; no child may be started by the test before ack.

#### Edge cases

Unknown task, unknown attempt, wrong slice, wrong plan, un-applied reservation, changed dispatch ID, and duplicate request with changed attempt all reject without side effects. Replaying the exact request is idempotent. Unknown/corrupt request ID never reports applied. No source/prompt body or native identity is persisted in the dispatch record or ack output.

#### Evidence

SRC-PROMPT and SRC-DISPATCH establish the defective boundary. CMD-REGRESSION supplies RED/GREEN behavior, CMD-TYPECHECK checks the durable shape, and independent specification/quality review checks that the journal ack really precedes native launch. Keep the CLI-derived plan identity current.

#### Fallback

If native provider APIs cannot observe a child without starting it, preserve this ordering: durable dispatch ack first, native launch second, native observation third. Never claim the observation itself precedes launch. Amend and revalidate this plan if an enforceable provider-specific hold phase becomes required.

<a id="slice-s2"></a>
### Slice S2: Admission cadence and truthful loop exit

#### Surfaces

Own ISSUE-196-R3 and ISSUE-196-R4 at the supervisor lifecycle boundary. Change `cli/src/commands/watch/supervisor.ts`, `cli/src/commands/watch/index.ts`, and the integrated regression tests. One loop outcome, rather than a stdout guess, is the interface between loop and CLI.

#### Implementation

- [x] Add failing tests: an admitted launched generation survives a sensor `fail` during RED without new dispatch or BLOCKED custody; a new generation with sensor `fail` remains blocked before launch; Ctrl-C after an IN_PROGRESS or BLOCKED journal prints neither COMPLETE nor a green gate; a genuinely complete loop does.
- [x] Run CMD-REGRESSION and record the expected assertion failures.
- [x] At each tick validate immutable plan binding and asserted machine identity. Use full admission before a generation's initial launch or a new generation; a launched generation's own work continues under its recorded admitted launch without reclassifying its edits as pre-dispatch sensor evidence. Keep the original retry/custody path for first or new dispatch. Return an explicit loop terminal reason and print COMPLETE only for an observed COMPLETE journal.
- [x] Run CMD-REGRESSION, CMD-WATCH, and CMD-TYPECHECK; then exercise the compiled CLI over a disposable repository with actual requests and no duplicate S1 dispatch.

#### Edge cases

Restart with a launched generation, a generation begun but never launched, changed plan digest, runtime mismatch, persistent pre-launch sensor failure, stale currentness, interrupted shutdown with unresolved ownership, and a frozen track all preserve fail-closed behavior and truthful output.

#### Evidence

SRC-ADMISSION and SRC-EXIT identify the broken ordering and stdout assumption. CMD-REGRESSION, CMD-WATCH, and CMD-TYPECHECK prove the changed boundary; final sensors and independent reviews remain required before claiming the issue fixed.

#### Fallback

If a launched generation cannot be proven admitted or owned, stop in custody and retain its original reason; do not infer PASS from a later sensor run. Any change to when new work may dispatch requires a reviewed plan amendment and renewed admission.

## Traceability

| Requirement | Slice | Specific evidence |
| --- | --- | --- |
| ISSUE-196-R1 | S1 | controller prompt and real `job reconcile` CLI assertions |
| ISSUE-196-R2 | S1 | pending/applied/rejected CLI ack assertions and applied reservation → dispatch-ack → native launch/observation test, plus negative cases |
| ISSUE-196-R3 | S2 | launched RED vs first/new launch supervisor tests |
| ISSUE-196-R4 | S2 | Ctrl-C journal-status/CLI output test and full workflow continuation test |
