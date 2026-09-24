# Issue 196 Admission Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep transient admission failures bounded and durable, then offer a safe audited offline recovery for admission custody.

**Architecture:** The supervisor records a retry budget in the schema-2 journal and never dispatches during retry. A separate offline command takes the supervisor lock, rechecks the exact bound plan and runtime admission, rejects ambiguous live work, and publishes the resume decision atomically with its audit record. The next supervisor run reconciles the existing durable action and work rather than recreating it.

**Tech Stack:** TypeScript, Commander, Jest, schema-2 AWM journal.

**Modo de ejecución:** interactivo

---

<!-- AWM:COMPACT-SLICES:START v1 -->
{"schema":"compact-slices/v1","planId":"issue-196-admission-recovery","requirements":["ISSUE-196-RETRY","ISSUE-196-RECOVER","ISSUE-196-SAFETY","ISSUE-196-CLI","ISSUE-196-TEST"],"sources":[{"id":"SUPERVISOR","path":"cli/src/commands/watch/supervisor.ts","locator":"async tick()","fact":"Admission precedes request consumption and dispatch; the existing sensor retry counter was in-memory and currentness had no retry."},{"id":"JOURNAL","path":"cli/src/core/journal/types.ts","locator":"JournalState","fact":"Optional schema-2 fields are validated before the journal is used."},{"id":"REQUEST-RECOVERY","path":"cli/src/commands/watch/request-recovery.ts","locator":"recoverRejectedTask","fact":"Offline recovery takes the exclusive lock and stores a custody decision with the state transition."}],"commands":[{"id":"WATCH-TEST","program":"npm","args":["--prefix","cli","test","--","--runTestsByPath","tests/commands/watch/supervisor-loop.test.ts","tests/commands/watch/admission-recovery.test.ts"],"covers":["ISSUE-196-RETRY","ISSUE-196-RECOVER","ISSUE-196-SAFETY","ISSUE-196-CLI","ISSUE-196-TEST"]},{"id":"TYPECHECK","program":"npm","args":["--prefix","cli","run","typecheck"],"covers":["ISSUE-196-RETRY","ISSUE-196-RECOVER","ISSUE-196-SAFETY","ISSUE-196-CLI"]}],"slices":[{"id":"S1","title":"Durable admission retries and audited recovery","requirements":["ISSUE-196-RETRY","ISSUE-196-RECOVER","ISSUE-196-SAFETY","ISSUE-196-CLI","ISSUE-196-TEST"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SUPERVISOR","JOURNAL","REQUEST-RECOVERY"],"redCommands":["WATCH-TEST"],"greenCommands":["WATCH-TEST","TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["custody-and-admission"]}],"closureCommands":["WATCH-TEST","TYPECHECK"]}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Durable admission retries and audited recovery

#### Surfaces

Own ISSUE-196-RETRY, ISSUE-196-RECOVER, ISSUE-196-SAFETY, ISSUE-196-CLI, and ISSUE-196-TEST together because they share the same journal state transition and strict admission invariant. Modify `cli/src/core/journal/types.ts`, `cli/src/commands/watch/supervisor.ts`, `cli/src/commands/watch/index.ts`; add `cli/src/commands/watch/admission-recovery.ts` and targeted tests. No mutation of a user's real journal.

#### Implementation

- [x] Add RED tests with real schema-2 journal: `unverifiable → current`, persistent `unverifiable`, supervisor restart, persistent `not-certified`, and `stale` immediate custody. Assert zero controller/job spawn before `admitted`, zero duplicate generation, durable retry count, and no request consumption.
- [x] Add one optional validated journal field containing retry kind, count, first observation, and next allowed check. Retry only `ADMISSION_CURRENTNESS_BLOCKED` with `currentness=unverifiable` or `ADMISSION_SENSORS_BLOCKED` with `sensors=not-certified`, after independently validating the bound plan; the admission engine evaluates these gates before journal/routing, so only a later full `admitted` report can authorize dispatch. Use a fixed bound and delay. Read this field on every tick; clear it on admission or audited recovery. Keep `stale` immediate.
- [x] Add RED offline recovery tests for currentness and sensors custody, unchanged binding and runtime, invalid identity, active request problem, ambiguous controller/job, idempotent second call, and retained original reason/generation. Assert no dispatch by the recovery command.
- [x] Implement `recoverAdmissionCustody(repoRoot, branch, input)` under exclusive lock. Validate operator reason, generation token, provider/runtime/autonomy, exact admission-custody cause and original binding. Reject live/ambiguous process ownership, active jobs, and request problems. Re-run `admissionForConfig` with asserted identity and require `admitted`, `currentness=current`, `sensors=pass`, `journal=current`, and unattended execution before a single atomic journal write of audit plus `IN_PROGRESS`; preserve original reason in the audit record and existing `nextAction`.
- [x] Wire `awm watch recover-admission` with explicit flags and JSON success/error. The next `awm watch` rechecks admission before any dispatch. Add CLI integration coverage and user-facing command documentation.
- [x] Run WATCH-TEST and TYPECHECK to GREEN, then run adjacent recovery and journal tests, sensors, independent review and QA before PR.

#### Edge cases

No retry on `stale`, invalid plan, stale/missing journal, invalid routing, unrelated diagnostics, or controller-autonomy failure. A restart cannot reset the budget. A recovery with mismatched provider/runtime/autonomy, changed binding, active job or controller, active rejected request, or unrelated BLOCKED cause must leave every journal byte semantically unchanged and dispatch nothing. Repeated identical recovery produces one decision and one transition; different second recovery fails. Legacy journals without recorded runtime identity require an explicit operator assertion, a current local receipt, and a new durable binding; historical identity cannot be inferred.

#### Evidence

Sources SUPERVISOR, JOURNAL, REQUEST-RECOVERY establish the existing gate and offline pattern. WATCH-TEST must fail for the original bug before implementation and pass after it; TYPECHECK must pass. Specification and code-quality reviewers must independently check the issue acceptance cases and safety invariant. Reconcile the current plan identity, test results, sensors and changed files before completion.

#### Fallback

If any identity or process fact is ambiguous, retain BLOCKED and report the exact missing proof. Expand full relevant context for custody or public CLI changes; amend and revalidate the plan if the journal contract needs a different shape. Do not bypass strict admission or hand-edit user state.

<!-- awm-docs-complete: 2026-09-24 -->
