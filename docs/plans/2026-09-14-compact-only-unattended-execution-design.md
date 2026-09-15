# Compact-only unattended execution and provider routing

**Issue:** #126
**Brief:** `docs/plans/2026-09-14-compact-only-unattended-execution-brief.md`
**Repositories:** `agentic-workflow`, `awm-baseline-registry`

## Requirements

- **RF-1.1** — WHEN `writing-plans` receives complete approved requirements with explicit ownership, THE planning process SHALL produce a supported compact plan and SHALL NOT expose a legacy implementation-plan option.
- **RF-1.2** — IF requirements, ownership, product decisions, architecture decisions, or safe slice boundaries are incomplete, THEN THE planning process SHALL return `planning-required` and SHALL NOT write an executable implementation plan.
- **RF-1.3** — WHEN requirements use canonical IDs such as `RF-1.1`, `RNF-T.1`, or an existing safe hyphenated ID, THE compact contract SHALL preserve and validate the identifier without translation.
- **RF-1.4** — WHEN the compact reference defines required slice sections, THE producer, example, CLI validator, and executors SHALL consume one canonical heading vocabulary and structure.
- **RF-1.5** — WHEN a published skill instructs an agent to run an AWM command, THE installed CLI SHALL expose that command with the documented semantics or THE instruction SHALL be removed.
- **RF-1.6** — WHEN a compact plan changes, THE workflow SHALL revalidate it and SHALL assign a new plan identity before further execution.
- **RF-2.1** — WHEN `awm plan validate` reads an unmarked plan, THE CLI SHALL return `migration-required` with a non-zero exit and SHALL NOT advertise another executable path.
- **RF-2.2** — WHEN any implementation executor starts, THE controller SHALL pass compact admission before its first subagent dispatch.
- **RF-2.3** — IF a plan is invalid or signals an unsupported schema, THEN THE CLI and every executor SHALL block without reinterpreting it as historical input.
- **RF-2.4** — IF a compact slice triggers security, robustness, root-configuration, public-contract, or uncertain cross-cutting risk, THEN THE executor SHALL expand relevant context while retaining the compact state machine and every quality gate.
- **RF-2.5** — WHEN the installed CLI and consumed registry contracts disagree, THE admission preflight SHALL block unattended execution and SHALL name the incompatible components.
- **RF-3.1** — WHEN execution mode is `desatendido`, THE admission gate SHALL require a healthy journal bound to the current plan identity before dispatch.
- **RF-3.2** — WHEN an unattended controller starts or resumes, THE workflow SHALL reconcile journal, plan, Git, active jobs, tests, sensors, and verdicts before selecting work.
- **RF-3.3** — WHEN migrating partially executed work, THE workflow SHALL carry forward only completion supported by current file-derived and durable evidence.
- **RF-3.4** — WHEN issue #148 resumes, THE migration SHALL retain Task 1 as verified antecedent, Task 2 as pending quality re-review, and Tasks 3–14 as unstarted unless newer durable evidence proves otherwise.
- **RF-3.5** — IF migration finds ambiguous ownership, conflicting evidence, or an unsafe boundary, THEN THE workflow SHALL stop with `planning-required` or `blocked` and SHALL NOT infer completion.
- **RF-4.1** — WHEN a compact v2 slice is authored, THE plan SHALL declare exactly one provider-neutral implementer profile and SHALL NOT embed a concrete provider model.
- **RF-4.2** — WHEN dispatching an implementer, THE resolver SHALL map its semantic profile to a currently available provider model and effort using an approved policy.
- **RF-4.3** — WHEN dispatching review, architecture judgment, or QA, THE workflow SHALL select the approved full-capability profile independently of the implementer profile.
- **RF-4.4** — IF a provider lacks model or effort override, THEN THE resolver SHALL use its declared full-capability behavior, record a visible degradation, and suppress routing-savings claims.
- **RF-4.5** — IF a required mapping is missing, malformed, stale, or unavailable, THEN THE resolver SHALL block before dispatch unless the declared full-capability degradation applies.
- **RF-5.1** — WHEN adjacent requirements share behavior, surfaces, dependencies, and verification boundaries, THE planner SHALL group them into the smallest justified cohesive slices.
- **RF-5.2** — WHEN admission succeeds, THE preflight SHALL report planned implementation, review, QA, documentation, retro, and finishing dispatches before execution.
- **RF-5.3** — WHEN a role is dispatched, THE controller SHALL send its stable role contract plus one bounded evidence capsule and SHALL exclude unrelated plans, histories, and source bodies by default.
- **RF-5.4** — WHEN implementation for a slice ends, THE workflow SHALL reconcile independent specification and code-quality verdicts with current files, tests, sensors, requirements, and plan identity before completion.
- **RF-5.5** — WHEN every slice is locally complete, THE workflow SHALL still execute final review, Track A and Track B QA, documentation, retro, sensors, verification, and finishing gates.
- **RF-5.6** — WHEN usage or pricing evidence is incomplete, THE report SHALL distinguish observed, derived, unavailable, and degraded values without converting missing data into zero or savings.
- **RF-6.1** — WHEN a material artifact, decision, checkpoint, measurement, commit, or pull request changes, THE initiative SHALL link durable evidence from issue #126.
- **RF-6.2** — WHEN execution completes or blocks, THE cycle SHALL report planned and actual dispatches by role, retries, full-context fallbacks, provider resolution, and plan identity.
- **RNF-T.1** — THE provider contract SHALL enumerate Antigravity, OpenCode, Claude Code, Codex, Cursor, and Copilot and SHALL represent each execution capability honestly instead of inferring it from artifact support.
- **RNF-T.2** — THE workflow SHALL validate public inputs, bound reads and diagnostics, reject unsafe paths and commands, and fail loudly without partial writes.
- **RNF-T.3** — THE journal, routing evidence, and usage reports SHALL be local, bounded, atomic, and redacted.
- **RNF-T.4** — THE workflow SHALL preserve historical plans byte-for-byte and SHALL write migration output as a separate artifact.
- **RNF-T.5** — THE workflow SHALL expose every fallback, degradation, migration, retry, and invalidation; none may silently select a more expensive or weaker path.
- **RNF-T.6** — THE workflow SHALL retain every existing quality gate and SHALL reject an optimization when quality, robustness, security, or acceptance coverage regresses.
- **RNF-T.7** — THE unattended workflow SHALL be deterministic and idempotent for plan identity, slice, role, command, and verdict across interruption and retry.
- **RNF-T.8** — THE initiative SHALL claim its 50% billed-equivalent reduction target only after comparable cycles pass every quality criterion; incomplete evidence SHALL yield an inconclusive result.

## Context and confirmed defects

The current system contains four independent authorizations for the expensive path:

1. the historical performance brief requires unmarked plans to keep executing;
2. `writing-plans` decides semantically whether compact applies and retains legacy output;
3. `awm plan validate` reports an unmarked plan as `legacy` with exit code zero; and
4. both execution skills retain Task/batch behavior for an unmarked plan.

The failure is reinforced by contract drift. The product brief contract requires dotted
requirement IDs, while the CLI's `ID` regex rejects dots. The compact reference documents
five combined sections whose headings differ from the five subsections required by the
validator. The reference also instructs `awm plan analyze`, but that CLI command does not
exist. Finally, unattended execution does not imply journal-first operation: a missing
journal currently selects the old default silently.

AWM exposes six `AgentTarget` values: Antigravity, OpenCode, Claude Code, Codex, Cursor,
and Copilot. Artifact delivery support is not proof of execution support. The current
journal supervisor has concrete controller adapters only for Codex and Claude Code; R0
must classify every other capability instead of inferring or inventing parity.

## Decisions

- **D1 — Compact-only:** `compact-slices/*` is the only executable plan family. Historical input is readable and migratable, never directly executable.
- **D2 — Mechanical authority:** the CLI is the sole parser, validator, digester, admission authority, capability resolver, and provider-policy resolver. Skills consume these results rather than duplicating them.
- **D3 — Native execution:** AWM returns a validated dispatch envelope; the provider's native mechanism performs the actual agent dispatch. AWM does not become a second agent runtime.
- **D4 — Capability-aware providers:** all six targets are enumerated, but each capability is certified independently. Missing model override may degrade; missing unattended custody or resumption blocks unattended mode.
- **D5 — Staged schemas:** corrected `compact-slices/v1` delivers R1 without invalidating already-valid v1 plans: the validator's existing five subsection names remain canonical and the registry reference is aligned to them. `compact-slices/v2` adds semantic model profiles in R2. A later schema may add safe parallel tracks.
- **D6 — Durable unattended mode:** unattended requires a journal bound to the current canonical plan digest. Interactive mode still requires a compact plan but does not require journal-first operation.
- **D7 — Semantic migration:** the CLI reports the need and supplies verified facts; `writing-plans` makes slice decisions and writes a separate continuation plan. Ambiguity blocks.
- **D8 — Full-quality review:** implementers may use lower-cost profiles after R2; review, architecture judgment, and QA remain full capability.
- **D9 — Owner-approved defaults:** R0 produces a recommended provider matrix; the owner approves it once before R2. Plans remain portable and contain no concrete model names.
- **D10 — Bootstrap plus two coordinated plans:** one current-v1-compatible CLI bootstrap slice first enables dotted requirement IDs and non-success `migration-required`; only then are the main CLI and registry R1 plans authored with canonical brief IDs. Plan sources remain contained within their active repository.

## Considered approaches

### Skill-only hardening

Changing only `awm-baseline-registry` is fast but cannot prevent another consumer, stale
registry, or direct executor from treating an unmarked plan as runnable. It repeats the
same class of failure and is rejected.

### CLI contract core plus native provider adapters — selected

The CLI owns mechanical truth and skills own semantic planning and native invocation.
This creates a testable fail-closed boundary without duplicating provider runtimes. It
requires coordinated changes and releases across two repositories, which are handled by
contract versioning and ordered rollout.

### Full provider runtime inside AWM

Moving all spawning, review orchestration, and provider interaction into the CLI would
maximize telemetry but duplicate Codex, Claude Code, and other native runtimes. It adds
vendor coupling and delays the urgent admission fix, so it is rejected.

## Architecture

### Compact plan contract

`cli/src/core/plan/` remains the only parser for executable plans. Its public report is:

```ts
type PlanValidationReport =
    | { state: 'valid'; schema: 'compact-slices/v1' | 'compact-slices/v2'; planDigest: string; manifest: CompactPlanManifest }
    | { state: 'migration-required'; reason: 'unmarked-plan' }
    | { state: 'invalid'; diagnostics: PlanDiagnostic[] }
    | { state: 'unsupported'; schema: string; diagnostics: PlanDiagnostic[] };
```

Every non-`valid` state exits with code `2`. Validation remains read-only, bounded, local,
and free of provider or model work. `migration-required` replaces only the plan-domain
`legacy` state; unrelated legacy compatibility in sensors, journals, bundles, or context
kernels is untouched.

Requirement IDs use a bounded segmented form: an uppercase alphanumeric segment followed
by zero or more `.` or `-` separated uppercase alphanumeric segments. This accepts
`RF-1.1`, `RNF-T.1`, and `R4-VAL-2`, while rejecting empty segments, control characters,
whitespace, path syntax, and unbounded input.

Each v1 slice retains exactly these already-validated `####` subsections beneath its
canonical `### Slice` heading:

1. `Surfaces`
2. `Implementation`
3. `Edge cases`
4. `Evidence`
5. `Fallback`

These names remain stable so previously valid compact v1 plans do not become invalid under
the same schema identifier. The registry reference is corrected to match them. Its example
becomes a fixture consumed by the compiled validator. There is no `awm plan analyze`
command: the self-review coverage check remains a documented planning step, while the CLI
validates only claims it can prove mechanically.

### Canonical plan identity

The validator decodes strict UTF-8, normalizes CRLF/CR to LF, and computes SHA-256 over
the complete normalized plan text. It performs no Unicode normalization and excludes no
section. This makes cross-platform line endings portable while ensuring a change to mode,
manifest, prose, command, or source produces another identity.

Plan evidence always carries `planDigest`. Evidence for an earlier digest remains
historical and cannot satisfy a current obligation.

### Admission

`awm plan admit <plan-path> --provider <target> --cwd <root> --require-current
--verify-sensors --json` is the single read-only execution gate. Its stable result contains:

```ts
type AdmissionReport = {
    state: 'admitted' | 'blocked';
    planState: PlanValidationReport['state'];
    planDigest?: string;
    executionMode?: 'interactivo' | 'desatendido';
    provider?: AgentTarget;
    journal: 'not-required' | 'current' | 'missing' | 'corrupt' | 'stale';
    currentness: 'current' | 'stale' | 'unverifiable';
    sensors: 'pass' | 'fail' | 'not-certified' | 'not-required';
    capabilityResolution?: ProviderExecutionResolution;
    forecast?: DispatchForecast;
    diagnostics: PlanDiagnostic[];
};
```

Checks run in this order: plan contract, provider identity/enabled state, relevant
currentness, sensor evidence, journal binding, provider capabilities, model policy, and
forecast. Failure in an earlier boundary prevents later mutation or dispatch. Admission
never initializes a journal, rewrites a plan, invokes a model, or performs a dispatch.

Currentness covers the CLI, registry that supplied the consumed planning/execution
contracts, registries referenced by plan sources, and installed artifacts actually used by
the cycle. An enabled but unrelated private registry does not block. If provenance cannot
show that it is unrelated, the result remains fail-closed.

### Journal binding

Journal schema 2 adds a required plan binding for unattended operation:

```ts
type PlanBinding = {
    path: string;
    digest: string;
    schema: 'compact-slices/v1' | 'compact-slices/v2';
    executionMode: 'desatendido';
    boundAt: string;
};
```

`awm watch --init --plan <plan-path>` validates the plan and atomically creates a schema-2
journal with its binding. It refuses to overwrite a journal. A schema-1 journal remains
readable as historical state but cannot admit unattended compact execution until an
explicit migration binds a plan. Journal writes keep the existing CAS, fencing, atomicity,
redaction, and custody rules.

### Migration

An unmarked plan produces `migration-required` and points to the `writing-plans`
migration protocol. The protocol reads the historical plan, Git commits and diff, journal
when present, tests, sensors, verdicts, and issue evidence. It then writes a separate
compact continuation plan containing only remaining obligations; completed behavior is a
source/checkpoint and is revalidated by final branch closure rather than reimplemented.

For #148, Task 1 is a verified antecedent, Task 2 begins at its missing code-quality
re-review, and Tasks 3–14 remain unstarted unless the branch contains newer durable
evidence. The original plan is never overwritten. Conflicting evidence or unsafe grouping
returns `planning-required` or `blocked`.

### Provider capability registry

`AGENT_TARGETS` remains the single provider identity list. A separate execution-capability
table must be exhaustive over that list:

```ts
type CapabilityStatus = 'supported' | 'unsupported' | 'unverified';

type ProviderExecutionCapabilities = {
    artifactDelivery: CapabilityStatus;
    interactiveExecution: CapabilityStatus;
    unattendedController: CapabilityStatus;
    nativeSubagents: CapabilityStatus;
    modelOverride: CapabilityStatus;
    effortOverride: CapabilityStatus;
    observedModelEvidence: CapabilityStatus;
    durableResume: CapabilityStatus;
};

type ProviderExecutionResolution = {
    outcome: 'native' | 'degraded' | 'blocked';
    provider: AgentTarget;
    capabilities: ProviderExecutionCapabilities;
    evidenceVersion: string;
    diagnostics: PlanDiagnostic[];
};
```

R0 emits the full matrix for Antigravity, OpenCode, Claude Code, Codex, Cursor, and
Copilot. Existing artifact renderer support populates only `artifactDelivery`. Existing
Codex/Claude controller adapters are evidence for the controller code path, not automatic
evidence for model override, observed identity, or every runtime version.

Missing model or effort override may resolve as `degraded` to the provider's declared
full-capability default. Missing unattended controller, durable resume, or safe custody
resolves as `blocked` for unattended mode. An `unverified` capability can never satisfy a
gate that requires it.

### Model policy and compact v2

`compact-slices/v2` adds exactly one `implementerProfile` to every slice:
`mechanical`, `integration`, or `judgment`. It does not add concrete model names. A v1 plan
remains compact and resolves all roles to full capability.

The user-level approved policy is the default mapping. An optional project policy may
override it explicitly. Each policy is schema-versioned, bounded, validated, and carries
an approval timestamp and digest. Resolution order is project policy, user policy, then
the provider's declared full-capability degradation when native override is unavailable.
A provider that supports override but lacks a valid mapping blocks the affected dispatch.

R0 produces a recommended matrix; `awm model-policy approve` records the owner's one-time
approval before R2. `awm model-policy status --provider <target> --json` reports the active
mapping and drift without changing it. Updates never overwrite an approved policy.

### Dispatch envelope

The CLI resolves but does not execute this bounded envelope:

```ts
type DispatchEnvelope = {
    provider: AgentTarget;
    providerVersion?: string;
    role: 'implementer' | 'specification-reviewer' | 'code-quality-reviewer' | 'final-reviewer' | 'qa';
    planDigest: string;
    sliceId?: string;
    requestedProfile: 'mechanical' | 'integration' | 'judgment';
    resolvedModel?: string;
    resolvedEffort?: string;
    policyDigest?: string;
    outcome: 'native' | 'degraded';
    unavailableEvidence: string[];
};
```

The controller records the envelope before dispatch, then uses the active provider's
native mechanism. The observed model identity is reconciled afterward when the provider
exposes it. A reported identity mismatch invalidates the affected obligation and blocks
continuation until the mapping is corrected and the obligation is re-dispatched. When the
provider cannot expose actual identity, execution may continue only through its declared
visible degradation and no model-routing saving is certified.

### Lifecycle consumers

Every plan consumer calls admission or reads a journal already bound by admission:

- `writing-plans` creates compact output, self-reviews, validates, initializes unattended
  journal state, and obtains a final admission verdict before offering handoff;
- `development-process` uses admission rather than filename/checkbox heuristics to enter
  execution;
- `executing-plans` accepts only admitted interactive compact plans;
- `subagent-driven-development` accepts admitted compact plans and requires journal-first
  for unattended mode;
- QA, documentation, retro, and finishing read plan path, digest, and mode from the journal
  or admission report rather than scanning `docs/plans/*-plan.md` independently.

The same plan digest crosses every phase. Missing or inconsistent identity blocks the next
transition.

### Forecast and evidence

Admission derives a dispatch topology from slice count and mandatory lifecycle roles. It
reports implementers, per-slice reviewers, final review, Track A, Track B, documentation,
retro, finishing, and any provider-specific controller work separately. Forecast counts
are deterministic topology, not token or price estimates.

Execution records actual dispatches, retries, fallbacks, provider resolution, and plan
identity. Provider usage remains observed, derived, unavailable, or degraded. R1 claims
no percentage saving; R3 evaluates the 50% billed-equivalent target with comparable cycles.

## Failure semantics

| Condition | Outcome |
|---|---|
| Unmarked plan | `migration-required`, exit 2, zero dispatches |
| Invalid or future schema | `blocked`, distinct diagnostic, zero dispatches |
| Contract source stale or mismatched | `blocked` before handoff |
| Unrelated private registry unverifiable | Does not block when irrelevance is proven |
| Relevant currentness unverifiable | `blocked` |
| Unattended journal missing/corrupt/stale | `blocked` with exact remedy |
| Plan changes after admission | Next transition blocks on digest mismatch |
| Provider controller/resume unavailable | Unattended `blocked` |
| Provider model override unavailable | Full-capability `degraded`; no savings claim |
| Provider capability unverified | Cannot satisfy a dependent gate |
| Policy mapping invalid | Affected dispatch `blocked` |
| Observed model differs from resolution | Affected obligation invalid; continuation blocked until corrected and re-dispatched |
| Risk fallback triggers | Relevant context expands; roles and gates unchanged |
| Agent report contradicts files | Files win; obligation remains pending |
| Identical retry/recovery request | Existing durable obligation is reconciled, not duplicated |

## Repository decomposition

### Bootstrap CLI plan — `agentic-workflow`

One compact slice valid under the pre-change CLI owns only two enabling changes: expand
the bounded requirement-ID grammar to accept canonical dotted IDs, and replace the
unmarked-plan `legacy` success report with `migration-required` exit 2. Its temporary
bootstrap requirement IDs use the pre-change safe grammar and map explicitly to RF-1.3
and RF-2.1. This is a one-time self-hosting boundary, not a new permanent ID translation.
After its clean reviews and gates, every subsequent plan uses the canonical brief IDs.

### R1 CLI plan — `agentic-workflow`

Owns validation states and grammar, canonical digest, admission, scoped currentness,
journal schema/binding, provider capability model, forecast, public commands, tests, and
R0 evidence fixtures.

### R1 registry plan — `awm-baseline-registry`

Owns compact-only authoring, corrected reference/example, migration protocol, admission
requirements in every lifecycle consumer, evidence capsule integration, and structural
contract tests. It declares the required CLI version delivered by the first plan.

The two repositories retain independent worktrees, commits, tests, and pull requests.
Issue #126 is their common baton. Neither plan reaches completion until installed
cross-repository acceptance passes.

## Release and rollout

1. Complete the bootstrap compact slice and validate that canonical dotted IDs now pass
   while unmarked plans return `migration-required` with exit 2.
2. Complete R0 evidence and freeze the contract corpus.
3. Author, validate, implement, and review both main R1 plans without publication.
4. Publish the compatible CLI.
5. Publish the baseline registry immediately afterward with its new `minCliVersion`.
6. Update an isolated installation and run real acceptance.
7. Perform the #148 migration dry run.
8. Only then declare R1 available and resume #148.

CLI-first avoids breaking existing installed registries. The short interval before the
registry publication is not considered completion because older skills still expose the
old behavior. Registry-first would fail closed but unnecessarily stop all users whose CLI
does not yet expose admission.

R2 starts only after R0's model matrix is approved. R3 starts after real routed cycles are
available. Compact parallel tracks remain R4 and require a separately approved schema
extension.

## Integration risks

| Integration | Failure point | Mitigation |
|---|---|---|
| CLI ↔ baseline registry | Contract versions publish out of order | `minCliVersion`, shared corpus, scoped currentness, installed acceptance |
| CLI ↔ provider runtime | Flags or native capabilities drift | Versioned capability evidence and real provider acceptance |
| Plan ↔ journal | Evidence belongs to another plan | Canonical digest, schema-2 binding, CAS and atomic writes |
| Journal ↔ Git | HEAD or diff changes during a gate | Current fingerprint before every transition |
| Admission ↔ sensors | Long or inconclusive verification | Durable job; duration never becomes terminal failure |
| Migration ↔ historical work | False completion or duplicate work | Original preservation, file-derived evidence, closure verification |
| Local artifact ↔ GitHub #126 | Remote API unavailable | Commit locally first; link is retryable and never the only state |

## Verification strategy

TDD adds failing tests before production changes. R1 acceptance must cover:

1. unit tests for plan states, ID grammar, stable v1 headings, digest normalization, bounds, and diagnostics;
2. Commander tests for stable human/JSON output and exit codes;
3. one canonical valid/adversarial corpus consumed by CLI and registry contract tests;
4. zero-dispatch negative controls through `development-process`, `executing-plans`, and SDD;
5. journal initialization, schema migration, stale digest, CAS, corruption, and crash recovery;
6. structural exhaustiveness over all six `AGENT_TARGETS`;
7. capability reports that never infer execution from artifact rendering;
8. compact valid, unmarked, malformed, and future-schema E2E cases against the compiled CLI;
9. provider-real acceptance for every capability available in the test environment and explicit `unverified` evidence otherwise;
10. regression validation proving every previously valid compact v1 plan remains valid;
11. #148 migration dry run selecting Task 2 quality re-review without repeating Task 1;
12. complete typecheck, dependency, Jest, sensor, QA, documentation, retro, and finishing gates;
13. installed CLI plus installed baseline-registry acceptance after ordered publication.

## NFR timing

R1 implements fail-closed admission, deterministic/idempotent state, atomic writes,
bounded/redacted evidence, six-provider exhaustiveness, migration preservation, contract
parity, and scoped currentness. R2 adds approved policy durability, provider resolution,
observed-model evidence, and escalation. R3 adds honest cost comparison. R4 adds compact
parallel isolation. Adaptive review or removal of quality roles is out of scope.

## Scope

Included: the one-slice CLI bootstrap; the CLI plan/admission/journal/provider contracts;
the baseline planning and lifecycle skills; all six provider targets; semantic migration;
#148 recovery; dispatch forecasting; model-policy foundations; staged R1–R4 design; and
cross-repository acceptance.

Excluded: removal of legacy compatibility in unrelated domains, automatic semantic
grouping, overwriting historical plans, a new agent runtime, reviewer downgrading,
hard-coded provider prices, direct publication from development, and immediate parallel
compact execution.

## UI Screens

None. This initiative changes CLI and agent-workflow contracts without adding a user
interface.
