# Compact-only R1 CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> to implement this plan slice-by-slice. S1 is the one-time admission bootstrap:
> dispatch it only after compact validation plus strict preflight/sensor gates; S2-S4
> require `awm plan admit` for this exact plan digest.

**Goal:** Make the CLI the fail-closed compact-plan admission authority for Release 1: canonical identity, journal-bound unattended custody, scoped contract currentness, capability truth, migration evidence, and deterministic dispatch forecasting.

**Architecture:** The existing compact validator remains the sole parser. New read-only admission composes validated plan state, currentness, sensor evidence, journal binding, and a capability matrix exhaustive over `AGENT_TARGETS`; it never dispatches or initializes state. Journal schema 2 binds an unattended cycle to the normalized plan digest, while migration evidence remains separate from historical plans.

**Tech Stack:** Node.js 24 verification (published engine >=22), TypeScript, Commander, Jest, SHA-256, existing journal CAS store.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

---

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema":"compact-slices/v1",
  "planId":"issue-126-compact-only-r1-cli",
  "requirements":["RF-1.3","RF-1.4","RF-1.5","RF-1.6","RF-2.1","RF-2.2","RF-2.3","RF-2.5","RF-3.1","RF-3.2","RF-3.3","RF-3.4","RF-3.5","RF-5.1","RF-5.4","RF-5.5","RF-6.1","RNF-T.1","RNF-T.2","RNF-T.3","RNF-T.4","RNF-T.5","RNF-T.6","RNF-T.7"],
  "sources":[
    {"id":"SRC-DESIGN","path":"docs/plans/2026-09-14-compact-only-unattended-execution-design.md","locator":"## Repository decomposition","fact":"R1 CLI owns validation, canonical digest, admission, scoped currentness, journal binding, capability model, forecast, commands, tests, and R0 evidence fixtures."},
    {"id":"SRC-FAILURES","path":"docs/plans/2026-09-14-compact-only-unattended-execution-design.md","locator":"## Failure semantics","fact":"Unmarked, invalid, stale, mismatched, or journal-unbound plans block before dispatch; plan changes invalidate prior evidence."},
    {"id":"SRC-VALIDATE","path":"cli/src/core/plan/validate.ts","locator":"export function validatePlanFile","fact":"Existing compact parser/classifier is read-only and already exposes valid, migration-required, invalid, and unsupported states."},
    {"id":"SRC-PLAN-TYPES","path":"cli/src/core/plan/types.ts","locator":"export type PlanValidationReport","fact":"Public validation types are the boundary extended with canonical plan identity and admission types."},
    {"id":"SRC-JOURNAL","path":"cli/src/core/journal/store.ts","locator":"export function writeJournal","fact":"Existing journal writes use atomic CAS and must retain that safety while adding a schema-2 plan binding."},
    {"id":"SRC-WATCH","path":"cli/src/commands/watch/init.ts","locator":"export function initWatch","fact":"`watch --init` is the public initialization surface to validate and bind an unattended plan without overwriting a journal."},
    {"id":"SRC-TARGETS","path":"cli/src/core/agent-targets.ts","locator":"export function resolveAgentTargets","fact":"The declared provider identity resolution is authoritative and capability data must be exhaustive over its AgentTarget domain."},
    {"id":"SRC-CURRENTNESS","path":"cli/src/core/currentness/check.ts","locator":"export async function checkCurrentness","fact":"Currentness checks already distinguish relevant registry evidence and must be scoped to consumed contracts."},
    {"id":"SRC-TESTS","path":"cli/tests/core/plan/validate.test.ts","locator":"describe('validatePlanFile'","fact":"Core plan tests establish validator regression patterns; new admission, digest, journal, capability, and migration suites must be deterministic fixtures."}
  ],
  "commands":[
    {"id":"CMD-PLAN-UNIT","program":"npm","args":["--prefix","cli","test","--","--runInBand","tests/core/plan","tests/commands/plan/index.test.ts"],"covers":["RF-1.3","RF-1.4","RF-1.5","RF-1.6","RF-2.1","RF-2.3","RNF-T.2","RNF-T.4","RNF-T.5"]},
    {"id":"CMD-ADMIT-UNIT","program":"npm","args":["--prefix","cli","test","--","--runInBand","tests/core/admission","tests/commands/plan/index.test.ts","tests/commands/watch/watch-init.test.ts"],"covers":["RF-2.2","RF-2.5","RF-3.1","RF-3.2","RF-5.1","RF-5.4","RF-5.5","RNF-T.1","RNF-T.3","RNF-T.6","RNF-T.7"]},
    {"id":"CMD-MIGRATION","program":"npm","args":["--prefix","cli","test","--","--runInBand","tests/core/migration"],"covers":["RF-3.3","RF-3.4","RF-3.5","RF-6.1"]},
    {"id":"CMD-TYPECHECK","program":"npm","args":["--prefix","cli","run","typecheck"],"covers":["RF-2.2","RF-2.5","RF-3.1","RNF-T.1","RNF-T.7"]},
    {"id":"CMD-BUILD","program":"npm","args":["--prefix","cli","run","build"],"covers":["RF-1.5","RF-2.1","RF-2.2","RF-3.1"]},
    {"id":"CMD-FULL","program":"npm","args":["--prefix","cli","test","--","--runInBand"],"covers":[]},
    {"id":"CMD-DEPCHECK","program":"npm","args":["--prefix","cli","run","depcheck"],"covers":[]},
    {"id":"CMD-SENSORS","program":"awm","args":["sensors","run"],"covers":[]},
    {"id":"CMD-DIFF","program":"git","args":["diff","--check"],"covers":[]}
  ],
  "slices":[
    {"id":"S1","title":"Canonical compact identity and contract corpus","requirements":["RF-1.3","RF-1.4","RF-1.5","RF-1.6","RF-2.1","RF-2.3","RNF-T.2","RNF-T.4","RNF-T.5"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SRC-DESIGN","SRC-FAILURES","SRC-VALIDATE","SRC-PLAN-TYPES","SRC-TESTS"],"redCommands":["CMD-PLAN-UNIT"],"greenCommands":["CMD-PLAN-UNIT","CMD-TYPECHECK","CMD-BUILD"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["Amend the shared corpus rather than changing a valid v1 interpretation; preserve historical bytes and revalidate after every plan change."]},
    {"id":"S2","title":"Fail-closed admission and scoped currentness","requirements":["RF-2.2","RF-2.5","RF-5.1","RF-5.4","RF-5.5","RNF-T.1","RNF-T.6"],"dependsOn":["S1"],"sectionAnchor":"slice-s2","sources":["SRC-DESIGN","SRC-FAILURES","SRC-CURRENTNESS","SRC-TARGETS"],"redCommands":["CMD-ADMIT-UNIT"],"greenCommands":["CMD-ADMIT-UNIT","CMD-TYPECHECK","CMD-BUILD"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["Expand to currentness and sensor source only; a blocked boundary remains blocked and no dispatch envelope is emitted."]},
    {"id":"S3","title":"Journal schema-2 binding and deterministic recovery","requirements":["RF-3.1","RF-3.2","RNF-T.3","RNF-T.7"],"dependsOn":["S2"],"sectionAnchor":"slice-s3","sources":["SRC-DESIGN","SRC-JOURNAL","SRC-WATCH"],"redCommands":["CMD-ADMIT-UNIT"],"greenCommands":["CMD-ADMIT-UNIT","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["Keep schema-1 readable as historical but block unattended admission until explicit schema-2 binding; never overwrite an existing journal."]},
    {"id":"S4","title":"Evidence-backed historical migration","requirements":["RF-3.3","RF-3.4","RF-3.5","RF-6.1"],"dependsOn":["S3"],"sectionAnchor":"slice-s4","sources":["SRC-DESIGN","SRC-FAILURES","SRC-JOURNAL"],"redCommands":["CMD-MIGRATION"],"greenCommands":["CMD-MIGRATION","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["Return planning-required or blocked with bounded missing-evidence diagnostics; never edit the historical input or infer a completed obligation."]}
  ],
  "closureCommands":["CMD-FULL","CMD-DEPCHECK","CMD-SENSORS","CMD-DIFF"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Canonical compact identity and contract corpus

#### Surfaces

Modify `cli/src/core/plan/validate.ts`, `cli/src/core/plan/types.ts`, and
`cli/src/commands/plan/index.ts`. Create focused digest/corpus fixtures below
`cli/tests/core/plan/` and extend command tests. The canonical digest is SHA-256 over
strict UTF-8 plan bytes after CRLF/CR-to-LF normalization, without Unicode normalization
or excluded sections.

#### Implementation

- [x] Write RED tests proving identical LF/CRLF plans get the same digest; changing any
  mode, source, command, requirement, or slice prose changes it; malformed UTF-8, oversized
  input, duplicate manifest keys, missing/duplicate five `####` sections, unmarked, and
  future-schema fixtures have distinct bounded non-success outcomes.
- [x] Make the validator return the digest only with a valid compact report, preserve the
  bootstrap dotted-ID grammar and five canonical v1 subsection names, and publish one
  versioned valid/adversarial corpus that later registry tests consume without transforms.
- [x] Remove every documented `awm plan analyze` instruction because no public command exists;
  retain traceability as an author self-review, not a fictional CLI dependency.
- [x] Run CMD-PLAN-UNIT RED then GREEN, CMD-TYPECHECK, CMD-BUILD; specification review must
  compare every corpus verdict against this slice and code-quality review must examine byte,
  UTF-8, and path bounds. Commit `feat(plan): add canonical compact identity (#126)`.

#### Edge cases

Digest changes invalidate old evidence even for prose-only edits. Historical files remain
byte-for-byte unchanged. A malformed marker is invalid, a future schema unsupported, and an
unmarked historical plan migration-required; none is silently reclassified as another state.

#### Evidence

Tests assert exact digest equality/inequality and JSON/human exit 2 semantics. Reviews require
the valid corpus to remain accepted by the compiled CLI and every adversarial fixture to make
zero writes.

#### Fallback

If a pre-existing valid v1 fixture fails, add a regression showing its intended accepted form
and correct only the parser defect; do not introduce a v1 translation layer or weaken bounds.

<a id="slice-s2"></a>
### Slice S2: Fail-closed admission and scoped currentness

#### Surfaces

Create `cli/src/core/admission/` for pure report composition and add `plan admit` to
`cli/src/commands/plan/index.ts`. Reuse `currentness/check.ts`, sensor verification, and
`AGENT_TARGETS`; create fixtures under `cli/tests/core/admission/`.

#### Implementation

- [x] Write RED table tests for plan state, provider identity, relevant contract versions,
  sensors, journal, capabilities, and forecast order. Assert first failure stops later work,
  admission performs no writes/dispatches, unrelated private registries do not block only
  when irrelevance is proven, and every one of six targets has explicit capability status.
- [x] Implement `awm plan admit <path> --provider <target> --cwd <root> --require-current
  --verify-sensors --json` as a bounded read-only report. It returns only `admitted` or
  `blocked`, includes digest/mode/diagnostics, and names incompatible CLI/registry contracts.
- [x] Derive a topology forecast from manifest slice count and mandatory implementer,
  per-slice two-reviewer, final-review, Track A/Track B QA, docs, retro, and finish roles;
  label it topology, never price or quota savings.
- [x] Run CMD-ADMIT-UNIT RED then GREEN plus CMD-TYPECHECK/CMD-BUILD, clean reviews, and
  commit `feat(plan): admit only current compact cycles (#126)`.

#### Edge cases

An unverified execution capability cannot satisfy unattended admission. Missing required
currentness or sensor proof blocks. Admission must not initialize journals, call providers,
mutate plans, or emit an envelope on failure.

#### Evidence

Fixtures assert zero dispatches and no filesystem mutation for each blocked boundary, exact
six-provider exhaustiveness, and forecast reconciliation for a valid serial manifest.

#### Fallback

For security/public-contract ambiguity, include the bounded relevant contract source in the
diagnostic and block; never assume compatibility from artifact-rendering support.

<a id="slice-s3"></a>
### Slice S3: Journal schema-2 binding and deterministic recovery

#### Surfaces

Modify `cli/src/core/journal/types.ts`, `store.ts`, `paths.ts`, `fingerprint.ts`, and
`cli/src/commands/watch/init.ts`; extend journal/watch tests and admission fixtures.

#### Implementation

- [ ] Write RED tests for `watch --init --plan <path>`: valid unattended plan creates one
  atomic schema-2 binding `{path,digest,schema,executionMode,boundAt}`; duplicate init,
  corrupt store, schema-1, stale digest, changed Git fingerprint, active job, and stale
  verdict each block deterministically without duplicate work.
- [ ] Validate the plan before initialization, bind canonical digest only for desatendido,
  retain schema-1 readability as historical, preserve CAS/fencing/redaction, and make
  admission require an exact current binding before any dispatch is allowed.
- [ ] Implement a pure reconciliation result for journal, plan, Git, active jobs, tests,
  sensors, and verdict obligations. Identical recovery requests reuse/reconcile obligations,
  never duplicate them.
- [ ] Run CMD-ADMIT-UNIT RED then GREEN and CMD-TYPECHECK; complete both reviews and commit
  `feat(journal): bind unattended cycles to plans (#126)`.

#### Edge cases

Interactive compact plans do not require a journal. A changed plan digest invalidates every
old journal/evidence claim. Persisted records must contain IDs/verdicts only, never prompts,
source bodies, credentials, or model responses.

#### Evidence

Atomicity/crash tests prove no partial binding; recovery tests prove one correct next action
for interruptions in implementation, reviews, fixes, verification, and closure.

#### Fallback

If a journal cannot prove current ownership, return the exact remedy (`init`, migration, or
repair) and block; no automatic overwrite or silent migration is allowed.

<a id="slice-s4"></a>
### Slice S4: Evidence-backed historical migration

#### Surfaces

Create `cli/src/core/migration/` and `cli/tests/core/migration/`; add a read-only plan
migration facts command under `cli/src/commands/plan/`. Preserve original plans and emit only
bounded facts needed by the registry migration protocol.

#### Implementation

- [ ] Write RED fixtures for checked-without-commit, commit-without-tests, tests-without-review,
  fully-evidenced work, conflicting evidence, unsafe ownership, and the #148 checkpoint.
- [ ] Implement read-only fact collection from plan, Git, journal, tests/sensors, verdicts,
  and issue links. The output classifies only supported completion; ambiguity returns
  planning-required or blocked and identifies missing evidence without source mutation.
- [ ] Encode the #148 fixture invariant: Task 1 is antecedent, Task 2 remains pending its
  quality re-review, and Tasks 3–14 unstarted unless newer durable evidence changes that fact.
- [ ] Run CMD-MIGRATION RED then GREEN and CMD-TYPECHECK; clean reviews and commit
  `feat(plan): expose migration evidence (#126)`.

#### Edge cases

Migration writes no continuation plan and never runs historical steps. Paths/diagnostics are
bounded and safe; a source that cannot be read is evidence absence, not success.

#### Evidence

The #148 dry-run fixture selects only Task 2’s quality obligation and hashes the historical
plan before/after. Each ambiguous fixture proves zero dispatches and an explicit status.

#### Fallback

If semantic grouping is required, hand control to `writing-plans` with the facts; do not
invent slice boundaries in the CLI.

## Traceability matrix

| Requirement | Owner | Direct verification |
|---|---|---|
| RF-1.3, RF-1.4, RF-1.5, RF-1.6, RF-2.1, RF-2.3 | S1 | digest/corpus/command fixtures |
| RF-2.2, RF-2.5, RF-5.1, RF-5.4, RF-5.5 | S2 | admission zero-dispatch and forecast fixtures |
| RF-3.1, RF-3.2 | S3 | binding, CAS, crash/recovery fixtures |
| RF-3.3, RF-3.4, RF-3.5, RF-6.1 | S4 | evidence and #148 migration fixtures |
| RNF-T.1 through RNF-T.7 | S1-S4 | exhaustive capabilities, bounds, atomic/redacted state, and idempotence tests |

## Closure gates

After all four slices, run CMD-FULL, CMD-DEPCHECK, CMD-SENSORS, and CMD-DIFF, then the
mandatory final review, Track A/Track B QA, docs, retro, verification, and branch finish.
R1 is not complete until the registry plan passes installed cross-repository acceptance and
the #148 migration dry run uses the released compatible pair.

## Planning amendment record

`plan admit` is introduced by S2, so it cannot admit S1 without a circular dependency.
S1 is therefore a bounded bootstrap over the already-valid compact v1 contract delivered by
the issue-126 bootstrap: validate this exact digest, run strict currentness plus sensors, and
retain every implementer/review/closure gate. Immediately after S2 exists, revalidate this
plan and require its own successful admission before S3 or S4. No unmarked plan, legacy
executor route, or later R1 slice is covered by this exception.
