# Recover rejected journal requests Implementation Plan

<!-- awm-qa-complete: 2026-09-24 -->
<!-- awm-docs-complete: 2026-09-24 -->
<!-- awm-retro-complete: 2026-09-24 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close #194 without erasing rejected-request history or weakening unattended gates.

**Architecture:** The CLI validates task verifier coverage before emitting a request, while the supervisor retains independent validation. A public, exclusive-lock recovery operation applies one pending corrected task request and records its link to one archived rejected task request atomically in the journal. Historical rejection remains visible; only a verified resolution stops it being an active gate problem. An explicit `--resume` on that command records a separate custody decision in the same transaction, only after the corrected request is applied and all request problems are resolved; other blockers retain their own gates.

**Tech Stack:** TypeScript, Commander, Jest, AWM schema-2 journal.

**Modo de ejecución:** interactivo

---

## Requirements

- R194-1: Reject a task lacking required `test` or `sensors` without losing durable evidence; CLI prevalidates where current journal facts are available.
- R194-2: Recover one archived rejected task by applying exactly one pending corrected task with the same `taskId`; persist reason, replacement ID, generation and timestamp before deleting the pending file; retain the original rejection.
- R194-3: An unresolved or corrupt request, wrong task, invalid replacement, live supervisor/controller, generation mismatch, or crash/retry cannot become a green gate. Resume requires a separate explicit `--resume` decision after every problem is resolved.
- R194-4: The public recovery flow and restart behavior are covered by an integration test; unrelated gate reasons remain red.

<!-- AWM:COMPACT-SLICES:START v1 -->
{"schema":"compact-slices/v1","planId":"issue-194-request-recovery","requirements":["R194-1","R194-2","R194-3","R194-4"],"sources":[{"id":"SRC-ISSUE","path":"docs/plans/2026-09-24-issue-194-request-recovery.md","locator":"## Requirements","fact":"The recovery must retain audit history and require a verified replacement."},{"id":"SRC-APPLY","path":"cli/src/commands/watch/apply.ts","locator":"export function consumePendingRequests","fact":"Only supervisor-owned journal writes apply requests before removing queue files."},{"id":"SRC-GATE","path":"cli/src/commands/job/gate.ts","locator":"function evaluateEvidence","fact":"Every active request problem blocks certification."}],"commands":[{"id":"CMD-APPLY","program":"npm","args":["--prefix","cli","test","--","--runTestsByPath","tests/commands/watch/apply.test.ts"],"covers":["R194-1","R194-2","R194-3"]},{"id":"CMD-RECOVERY","program":"npm","args":["--prefix","cli","test","--","--runTestsByPath","tests/commands/watch/request-recovery.test.ts"],"covers":["R194-2","R194-3","R194-4"]},{"id":"CMD-TYPE","program":"npm","args":["--prefix","cli","run","typecheck"],"covers":["R194-1","R194-2","R194-3","R194-4"]}],"slices":[{"id":"S1","title":"Durable request recovery and fail-closed gate","requirements":["R194-2","R194-3","R194-4"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SRC-ISSUE","SRC-APPLY","SRC-GATE"],"redCommands":["CMD-RECOVERY"],"greenCommands":["CMD-RECOVERY","CMD-APPLY","CMD-TYPE"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["full-relevant-context"]},{"id":"S2","title":"Emitter prevalidation","requirements":["R194-1"],"dependsOn":["S1"],"sectionAnchor":"slice-s2","sources":["SRC-ISSUE","SRC-APPLY"],"redCommands":["CMD-APPLY"],"greenCommands":["CMD-APPLY","CMD-TYPE"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["full-relevant-context"]}],"closureCommands":["CMD-RECOVERY","CMD-APPLY","CMD-TYPE"]}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Durable request recovery and fail-closed gate
#### Surfaces
Own R194-2, R194-3 and R194-4 in `cli/src/core/journal/types.ts`, `cli/src/commands/watch/request-recovery.ts`, `cli/src/commands/watch/index.ts`, `cli/src/commands/watch/apply.ts`, `cli/src/commands/job/gate.ts`, `cli/src/commands/watch/init.ts`, `cli/src/commands/watch/supervisor.ts`, and `cli/tests/commands/watch/request-recovery.test.ts`. This is one custody boundary: exclusive writer, verified replacement, durable resolution and all gate readers must agree.
#### Implementation
- [x] RED: create a real temporary Git repo with schema-2 journal, required verifiers `test` and `sensors`, reject task S1 lacking sensors, queue corrected S1, and assert no public recovery path can make it active. Run CMD-RECOVERY and confirm the expected failure.
- [x] Add optional `resolution` to `RequestProblem`: `{replacementRequestId, replacementPayloadDigest, reason, generationToken, at}` plus source request identity; validate each field strictly while retaining legacy unresolved entries. Define `activeRequestProblems` as those without a verified applied replacement; switch gate and recovery/rebind blockers to that single predicate.
- [x] Add `awm watch recover-request --rejected <requestId> --replacement <requestId> --generation <token> --reason <text> [--resume]` as an exclusive-lock operation. Verify same branch and schema-2 journal, absent live controller/process, canonical `.rejected` archive and pending replacement envelopes, same `register-entity/task` and nonempty exact `taskId`, and current generation token. Apply the corrected request to a cloned state via the existing reducer, then add the resolution. Only `--resume` on an otherwise request-blocked cycle with zero remaining unresolved problems records a distinct custody decision and sets `IN_PROGRESS` in that same state publication. Commit journal before deleting the pending replacement; a replay sees `appliedRequests` and is idempotent.
- [x] GREEN: CMD-RECOVERY, CMD-APPLY, CMD-TYPE. Check original archive and rejection event remain; a replacement without `sensors`, wrong task, missing archive, stale generation, or live lock cannot resolve. Crash/retry after journal commit must not duplicate the task or erase history.
#### Edge cases
Corrupt requests cannot be recovered as task corrections. Unknown/ambiguous archives and replacements fail closed. Invalid recovery input never mutates a journal. A resolved problem is historical only; all other unresolved problems and unfinished tasks keep the gate red. `custody-decision` alone never resolves a problem.
#### Evidence
SRC-ISSUE, SRC-APPLY and SRC-GATE establish the required state transitions. CMD-RECOVERY proves red/green end-to-end and invalid cases; CMD-APPLY protects existing transaction semantics; CMD-TYPE checks interfaces. Obtain independent specification and code-quality verdicts against this plan digest.
#### Fallback
Any uncertainty in supervisor fencing or crash consistency requires full relevant-context review and plan amendment; no direct `state.json` edits, deletion of history, or bypass of admission.

<a id="slice-s2"></a>
### Slice S2: Emitter prevalidation
#### Surfaces
Own R194-1 in `cli/src/commands/job/index.ts` and CLI tests. The emitter reads a valid current journal and checks a new task's `verificationPlan` covers each `requiredVerifiers`; the supervisor remains authoritative.
#### Implementation
- [x] RED: add a CLI test that `awm job register --entity task` lacking sensors exits nonzero and creates no request file when journal requires sensors; run CMD-RECOVERY and confirm expected failure.
- [x] Validate the task payload and required verifier coverage before `emitRequest`, using the current journal. Keep supervisor validation unchanged and let an absent/corrupt journal fail closed.
- [x] GREEN: CMD-RECOVERY, CMD-APPLY and CMD-TYPE. Verify a valid corrected task still emits and is applied normally.
#### Edge cases
Unknown verifier kinds and non-array plans must fail before emission; a journal change between emit and consume still gets rejected by the supervisor. Do not mark a rejected request resolved merely because a new request was emitted.
#### Evidence
SRC-ISSUE and SRC-APPLY require layered validation; CMD-APPLY proves no invalid queue entry and that the supervisor retains its check. Obtain independent specification and code-quality verdicts.
#### Fallback
If local journal facts cannot be authenticated, fail before emission and leave the supervisor as authority; do not infer required verifiers from config or disable sensors.

## Traceability

| Requirement | Slice | Verification |
|---|---|---|
| R194-1 | S2 | CMD-APPLY emitter negative and existing supervisor negative |
| R194-2 | S1 | CMD-RECOVERY linked replacement and durable archive |
| R194-3 | S1 | CMD-RECOVERY adversarial and restart cases |
| R194-4 | S1 | CMD-RECOVERY integration and gate continuation |
