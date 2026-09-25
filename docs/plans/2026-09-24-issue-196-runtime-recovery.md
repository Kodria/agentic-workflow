# Issue #196: Runtime Recovery After 9.12.3 Smoke Implementation Plan
<!-- awm-qa-complete: 2026-09-25 -->
<!-- awm-docs-complete: 2026-09-25 -->
<!-- awm-retro-complete: 2026-09-25 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume a 9.12.2-origin unattended S1 journal on current AWM without false sensor/runtime custody, forged ACKs, duplicate native implementers, or loss of historical evidence.

**Architecture:** Keep full strict sensor admission at the first launch of each generation, then let controller-side plan admission recognize the existing durable launch intent plus confirmed live process ownership as that generation's admission evidence. A claim alone does not certify sensor reuse. A replacement admission explicitly forces fresh sensors even while the old generation remains active in the journal, and refuses generation-bound reports. Reuse is valid only while the same generation, plan and runtime binding remain current; no new journal schema is needed, so 9.12.2 journals remain readable. Never relax the general read-only sensor guard. Distinguish an inconclusive native runtime query from a proven mismatch; an offline recovery rechecks current facts before clearing custody, including the absence of a linked dispatch that might already have launched a child. Preserve the old unlinked dispatch as history and make a subsequent, acknowledged routed dispatch the first native handoff. Another native child after that handoff is outside this migration and remains blocked without separate ownership proof.

**Tech Stack:** TypeScript, Jest, Commander, journal schema 2, compact-slices/v1 plan for this interactive maintenance branch.

**Modo de ejecución:** interactivo

## Requirements

- **ISSUE-196-R5:** Concurrent supervisor journal/event writes must not turn an already-admitted generation's sensor evidence into a false admission failure; first/new generations and changed plan/runtime remain strictly gated, and sensor-caused mutations must remain non-certifying.
- **ISSUE-196-R6:** An inconclusive local runtime query must be distinguishable from a proven identity mismatch and must not dispatch. A BLOCKED cycle for this exact reason may resume only through an audited offline command after current plan, runtime, receipt, sensors, requests, and process ownership are rechecked.
- **ISSUE-196-R7:** A pre-9.12.3 unlinked dispatch that precedes an applied S1 routing reservation must remain historical. Its applied ACK must match the exact legacy payload to corroborate the old intent, but cannot prove native ownership or authorize a child. A new routed dispatch may be acknowledged exactly once without replaying or forging the old ACK, incrementing the implementer work count twice, or launching a child before the new ACK; unrelated/mismatched legacy records remain fail-closed.

<!-- AWM:COMPACT-SLICES:START v1 -->
{"schema":"compact-slices/v1","planId":"issue-196-runtime-recovery-9123","requirements":["ISSUE-196-R5","ISSUE-196-R6","ISSUE-196-R7"],"sources":[{"id":"SRC-SENSORS","path":"cli/src/commands/sensors/run.ts","locator":"function filesystemSnapshot","fact":"Read-only sensors hash the entire project except .git, including live .awm journal files; a changed snapshot returns not_certified."},{"id":"SRC-ADMIT","path":"cli/src/core/admission/registry-contracts.ts","locator":"const sensors = input.verifySensors","fact":"Controller-side plan admission always reruns read-only sensors even when the supervisor has already admitted an owned generation."},{"id":"SRC-SUPERVISOR","path":"cli/src/commands/watch/supervisor.ts","locator":"async tick()","fact":"A launched generation skips full sensor admission but collapses local scope unverified and runtime mismatch into one permanent custody reason."},{"id":"SRC-RECOVERY","path":"cli/src/commands/watch/admission-recovery.ts","locator":"recoverAdmissionCustody","fact":"The offline recovery verifies plan, sealed receipt, live local scope, strict admission and no live work, but whitelists only currentness/sensor custody reasons."},{"id":"SRC-DISPATCH","path":"cli/src/commands/watch/apply.ts","locator":"if (p.entity === 'dispatch')","fact":"A v2 dispatch requires a linked reservation and applied ACK; a historical unlinked dispatch with the same ID conflicts with a new routed record."},{"id":"SRC-JOURNAL","path":"cli/src/core/journal/types.ts","locator":"if ((x.planBinding as PlanBinding | undefined)?.schema === 'compact-slices/v2')","fact":"The journal accepts historical unlinked dispatches but requires present routing/ACK links for newly linked v2 records."}],"commands":[{"id":"CMD-REGRESSION","program":"npm","args":["--prefix","cli","test","--","--runInBand","--silent","tests/commands/watch/reopened-196.test.ts","tests/commands/watch/admission-recovery.test.ts"],"covers":["ISSUE-196-R5","ISSUE-196-R6","ISSUE-196-R7"]},{"id":"CMD-SENSORS","program":"npm","args":["--prefix","cli","test","--","--runInBand","--silent","tests/commands/sensors/run.test.ts"],"covers":["ISSUE-196-R5"]},{"id":"CMD-TYPECHECK","program":"npm","args":["--prefix","cli","run","typecheck"],"covers":["ISSUE-196-R5","ISSUE-196-R6","ISSUE-196-R7"]}],"slices":[{"id":"S1","title":"Generation-bound admission and runtime diagnosis","requirements":["ISSUE-196-R5","ISSUE-196-R6"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SRC-SENSORS","SRC-ADMIT","SRC-SUPERVISOR","SRC-RECOVERY"],"redCommands":["CMD-REGRESSION","CMD-SENSORS"],"greenCommands":["CMD-REGRESSION","CMD-SENSORS","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["security","public-contract"]},{"id":"S2","title":"Legacy dispatch reconciliation and integrated continuation","requirements":["ISSUE-196-R7"],"dependsOn":["S1"],"sectionAnchor":"slice-s2","sources":["SRC-DISPATCH","SRC-JOURNAL","SRC-RECOVERY"],"redCommands":["CMD-REGRESSION"],"greenCommands":["CMD-REGRESSION","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["security","public-contract"]}],"closureCommands":["CMD-REGRESSION","CMD-SENSORS","CMD-TYPECHECK"]}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Generation-bound admission and runtime diagnosis

#### Surfaces

Own ISSUE-196-R5 and ISSUE-196-R6 at the supervisor/admission custody boundary. Change `cli/src/commands/watch/supervisor.ts`, `cli/src/core/admission/registry-contracts.ts`, `cli/src/commands/watch/admission-recovery.ts`, and focused tests. Existing `controllerJobId`/`launchArgvDigest` plus confirmed process/claim ownership prove an admitted launch; no new field or fabricated certificate is written. This evidence is valid only for that generation, plan digest, provider/runtime identity and launch ownership; it cannot authorize a new generation.

#### Implementation

- [x] Add a RED test where controller-side `plan admit` observes an owned, admitted generation after `.awm` changes and reuses that generation's durable sensor PASS without rerunning read-only sensors; assert a new generation still invokes full admission and blocks on `not-certified`. Cover a v2 routed admission separately. Keep `runSensors({readOnly:true})` returning `not_certified` when its own test sensor writes any project file.
- [x] Run CMD-REGRESSION and CMD-SENSORS and record the expected behavioral failure, not a setup error.
- [x] Recognize only an active generation with durable `controllerJobId`/`launchArgvDigest`, a *live* process/wrapper ref with matching nonce (and launch argv digest for the command process), matching provider/admissionContext and exact validated plan binding. An unresolved claim alone cannot prove live process ownership. Let `admitRegistryPlan` skip only the empirical sensor rerun for that exact case and expose generation-bound evidence; currentness, plan, runtime routing and receipt gates still execute. Replacement admission forces fresh sensors and rejects generation-bound reports before `beginGeneration`. No journal field is added and the general read-only sensor snapshot still catches mutations.
- [x] Add RED tests for `queryLocalEventScope` returning `unverified`: no job/native child starts, the journal records the exact unverified reason, and a proven current-but-different runtime still blocks with a distinct mismatch reason. Add an offline recovery fixture with the historic ambiguous reason and no live jobs; verify current exact receipt/runtime/plan/sensors is required and the old blockedReason remains in `admissionRecoveries`.
- [x] Run CMD-REGRESSION to observe the exact failures. Separate unverified from mismatch before comparing runtime fields; keep both fail-closed for dispatch. Extend only the explicit offline recovery whitelist for this custody family, relying on its existing lock, ownership, plan, receipt and strict-admission checks; do not reset `BLOCKED` in the normal tick.
- [x] Run CMD-REGRESSION, CMD-SENSORS and CMD-TYPECHECK. Confirm the old blocked reason and generation remain intact after recovery and that a subsequent launch still performs a fresh strict admission.

#### Edge cases

No generation-bound reuse if launch is unowned/dead, plan digest changed, provider/runtime differs, or replacement/new generation admission begins. `unverified` cannot be reported as a measured identity change. A real runtime mismatch never dispatches. Recovery rejects a live controller, live or ambiguous job/native attempt, linked dispatch ACK, request problem, changed plan, mismatched receipt/account, failing sensors, or different asserted provider/autonomy. Idempotent recovery cannot append duplicate history.

#### Evidence

SRC-SENSORS, SRC-ADMIT, SRC-SUPERVISOR and SRC-RECOVERY define the existing boundaries. CMD-REGRESSION proves launched versus new-generation behavior and offline custody; CMD-SENSORS proves sensor-caused mutation remains non-certifying; CMD-TYPECHECK proves durable shapes. Independent specification and code-quality review must check that no path bypasses strict first-launch admission. Reconcile current plan identity before completion.

#### Fallback

If a generation cannot prove ownership or the exact admitted identity, keep custody; never derive a pass from a later standalone sensor run. If the proposed evidence cannot be persisted without widening public journal contracts unsafely, amend and revalidate this plan before proceeding.

<a id="slice-s2"></a>
### Slice S2: Legacy dispatch reconciliation and integrated continuation

#### Surfaces

Own ISSUE-196-R7 in `cli/src/commands/watch/apply.ts`, `cli/src/core/journal/types.ts` and an integrated `cli/tests/commands/watch/reopened-196.test.ts` fixture. The fixture starts from a durable 9.12.2-shaped journal: one historical unlinked S1 dispatch, then one applied reservation, no native observation, no live job and S1 in progress.

#### Implementation

- [x] Add RED tests that replay the historical dispatch ID with a linked reserved attempt. The old record and its ACK must remain byte-for-byte historical; the new request produces one distinct linked dispatch plus a real applied ACK before simulated child launch. An exact replay changes neither records nor attempt count; a different task, reservation, live job or observed child rejects.
- [x] Run CMD-REGRESSION and record the expected conflict without hand-editing the fixture journal after test setup.
- [x] Reconcile only the exact legacy case: same task and unlinked dispatch ID, an applied historical ACK with the exact legacy payload digest, reservation ACK already applied, old dispatch's native evidence absent, and no live work (terminal jobs are allowed). Preserve historical ACKs, including idempotent retries, but use them only to corroborate the old intent, never as proof that a child may launch. Append one new linked dispatch with a deterministic bounded ID derived from the new request ID; set its `dispatchRequestId` to that actual request, return its ID as the applied ACK `resultRef`, and preserve the old dispatch and ACK unchanged. Do not increment `task.attempts` for this administrative re-link because the old intent already counted once. An alternate requested ID fails closed; even a failed linked attempt does not prove the native child has stopped, so a second native handoff remains outside this migration.
- [x] Run CMD-REGRESSION and CMD-TYPECHECK. The integrated test shows recovery → valid reserve ACK → new dispatch ACK → simulated native observation → one S1 continuation. It does not claim a paid/live Codex child; the private smoke remains the final acceptance gate.

#### Edge cases

Never infer native observation from old ACK chronology. Require a fresh request ID and matching reservation envelope/plan digest. Reject missing or rejected reservation ACK, multiple legacy dispatches for one task, already-linked dispatch, any live job/claim, and conflicting replay. Preserve original timestamps and ids; no rewritten history or fabricated ACK is allowed.

#### Evidence

SRC-DISPATCH, SRC-JOURNAL and SRC-RECOVERY establish the migration boundary. CMD-REGRESSION proves history preservation and ordering; CMD-TYPECHECK protects the journal shape. Distinct specification and quality verdicts must verify that only one native implementer can be launched. The final owner smoke must use the original private journal and observe real native/ACK evidence before #196 closes.

#### Fallback

If the old journal contains a live/ambiguous child or cannot prove the original dispatch had no native observation, remain BLOCKED and report the exact reason; no automatic mutation or new dispatch. Amend/revalidate this plan if the real private journal shape differs from the public 9.12.2 fixture.

## Traceability

| Requirement | Slice | Specific evidence |
| --- | --- | --- |
| ISSUE-196-R5 | S1 | launched-vs-new generation supervisor test and sensor mutation `not_certified` assertion |
| ISSUE-196-R6 | S1 | unverified-vs-mismatch test, strict offline recovery negative cases and preserved blockedReason |
| ISSUE-196-R7 | S2 | 9.12.2-shaped dispatch replay/ACK ordering and one S1 continuation test |
