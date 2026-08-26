# R4 Compact Plans and Cohesive Slices — Design

**Status:** Approved

**Source brief:** [`Performance y tokens`](https://github.com/Kodria/agentic-workflow/blob/c81aab088d1fdf1a679c353d3557545e9b50125e/docs/plans/2026-08-25-performance-tokens-brief.md)

**Trace:** [agentic-workflow#126](https://github.com/Kodria/agentic-workflow/issues/126)

**Prior release:** AWM CLI `9.3.0`, baseline registry `v3.9.2`, and a valid
Context Kernel v1 in `agentic-workflow`. R3 reduced fixed project context from
67,481 to 13,166 bytes while conserving 124/124 legacy context blocks. Provider
tokens, cache and billed cost remain unobservable, so that result is structural
evidence rather than a billed-cost claim.

## Purpose

R4 reduces repeated planning and task-cycle payload without removing any role or
quality gate. It introduces a durable `compact-slices/v1` plan contract: the planner
writes complete, literal implementation instructions once, groups work into explicit
behavioral slices, and gives each implementer and reviewer only the complete slice and
its evidence capsule.

Compact means non-duplicative, not underspecified. A low-context executor must be able
to implement a slice without making architecture, product, interface, or behavioral
decisions. Exact signatures, algorithms, edge cases, commands and code are included
whenever they are new, delicate, or cannot be recovered unambiguously from a stable
authoritative source.

R4 also closes the delivery gap exposed during R1–R3: a development workflow must not
silently proceed as current when its CLI or any configured registry is stale, pinned
behind the current stable release, or impossible to verify. A new explicit strict
preflight mode performs that gate without mutating the machine.

R4 itself is the first fresh real cycle in the R4 evaluation corpus and simultaneously
captures R3 T4. It does not hardcode initiative release names, sample counts, or savings
targets into the permanent CLI or registry contracts.

## Owner Decisions

### D-R4-1 — One vertical capability, two coordinated deliveries

R4 is one product capability delivered through two repositories:

- the CLI owns deterministic parsing, validation, strict currentness checks and
  machine-readable reports;
- the baseline registry owns how plans are written, handed off, executed, reviewed and
  measured.

The CLI is published first. The registry then records the observed published CLI
version as `minCliVersion`; no future version is guessed.

### D-R4-2 — Explicit slices, never semantic auto-grouping

The planner declares cohesive slices and their requirement ownership. The CLI validates
the declaration but never infers whether tasks are semantically related. Grouping by a
model, heuristic, embedding, file proximity, or automatic rewrite is outside R4.

Each implementation requirement has one owning slice. Cross-cutting verification may
be referenced by several slices, but ownership is never ambiguous. If execution
discovers a missing requirement or an invalid boundary, the slice stops and the plan
is amended and revalidated before work resumes.

### D-R4-3 — Robust plans for literal execution

The design artifact records product and architecture decisions; it is not the payload
given directly to subagents. `writing-plans` converts the approved design into the
executable implementation plan. That plan remains deliberately robust because it is
written with the strongest available planning model for execution by agents that may
have less reasoning capacity and less context.

References replace copied text only when they are stable, accessible at execution time,
precise enough to determine the required behavior, and bounded to the relevant source.
Otherwise the plan carries the exact instruction or code. A reference is not a license
for the executor to rediscover the design.

### D-R4-4 — Review topology follows slices, quality topology is unchanged

For `N` microtasks the existing lower-bound topology is approximately `3N + 5` normal
dispatches: implementation, specification review and code-quality review per task, plus
final quality and closure roles. R4 changes the repeated unit from microtask to cohesive
slice, yielding approximately `3S + 5`, where `S < N` for a plan with genuine cohesive
work.

Each slice still receives test-first implementation, independent specification review
and independent code-quality review. Final Track A, every applicable Track B lens,
sensors, complete branch verification, documentation, retro and completion remain.
Savings obtained by deleting a role or gate are invalid.

### D-R4-5 — Currentness is distinct from compatibility

`minCliVersion` answers whether installed CLI behavior is compatible with installed
registry content. It does not prove either component is current. R4 keeps that gate and
adds an independent explicit gate:

```text
awm preflight --require-current
```

Strict currentness performs synchronous authoritative remote checks, bypasses the
existing passive 24-hour CLI notification cache, and is blocking. Plain
`awm preflight` remains local and offline-compatible.

The strict gate is read-only. It never installs a package, changes a registry checkout,
removes a pin, edits configuration, or rewrites project context. Its remedies name the
separate commands that perform those mutations with operator consent.

### D-R4-6 — Honest guarantee boundary

No code release can update a cached machine or container if neither that release nor an
external bootstrap ever executes. R4 therefore guarantees the following bounded
property: once an R4-aware development flow reaches entry preflight, stale or
unverifiable CLI/registry state is visible; before unattended handoff, the same state
is blocking.

Container and ephemeral-environment documentation supplies a bootstrap that resolves
the published CLI `@latest` channel before invoking strict preflight. This closes the
normal cached-image path but does not claim control over hosts that never run the
bootstrap, have no network, or deliberately suppress execution.

### D-R4-7 — Real evidence, no measurement-only model work

The corpus combines historical evidence with three fresh stratified real development
cycles:

1. building R4 captures R3 T4 and the first R4 sample;
2. the first normal development after installed R4 captures R4 T4;
3. a later normal development covers a different scope/risk class.

R4 may publish after structural and quality T0–T3 evidence is complete. A generalized
savings or quality-non-inferiority claim waits for all three fresh cycles. Measurement
uses normal lifecycle boundaries and never dispatches a model solely to measure.

## Specialist Verdicts

- **Architecture (`architecture-advisor`, contextual): significant.** Keep the CLI as
  the sole parser/gate and the registry as the semantic process owner. Use one
  versioned contract, explicit slice declarations, fail-closed validation and legacy
  fallback instead of introducing another orchestration service.
- **Technology (`technology-evaluator`, contextual): trivial.** Reuse TypeScript,
  Commander, Markdown, JSON output, npm's authoritative `latest` channel and Git remote
  tag discovery. No runtime dependency, database, daemon, cache service, embedding or
  provider API is justified.
- **NFR (`nfr-checklist-generator`, contextual): significant.** Determinism,
  executable sufficiency, path containment, command safety, bounded network behavior,
  machine-readable provenance, provider parity, backward compatibility, explicit
  fallback, quality non-regression and honest evidence are release gates.

## Requirements

### Compact plan contract

- **R4-CP-1** — WHEN `writing-plans` creates an optimized implementation plan, THE
  planning process SHALL declare exactly `compact-slices/v1` and SHALL assign every
  implementation requirement to one explicit owning slice.
- **R4-CP-2** — WHEN a slice is handed to a low-context executor, THE plan SHALL contain
  the required behavior, affected surfaces, exact interfaces, implementation sequence,
  edge cases, test-first evidence, commands, risks and fallback conditions needed to
  execute without making a new product or architecture decision.
- **R4-CP-3** — WHEN a plan delegates detail to an authoritative source, THE plan SHALL
  identify a repository-relative regular file and a bounded anchor or symbol, and SHALL
  state what fact the executor must obtain from it.
- **R4-CP-4** — IF a source is absent, unstable, unsafe, inaccessible, ambiguous, or
  insufficient to determine behavior, THEN THE plan SHALL inline the necessary
  instruction or code instead of delegating discovery to the executor.
- **R4-CP-5** — WHEN implementation text, commands or evidence apply to several steps in
  one slice, THE plan SHALL state them once at the narrowest shared boundary and SHALL
  reference their stable IDs instead of copying the same payload into each step.

### Cohesive slices and execution

- **R4-CS-1** — WHEN the planner combines work into a slice, THE plan SHALL declare one
  behavioral boundary, its requirement IDs, files/symbols/interfaces, dependencies,
  RED/GREEN evidence, review evidence and applicable verification boundary.
- **R4-CS-2** — THE CLI SHALL validate declared slice structure and traceability but
  SHALL NOT create, merge, reorder or semantically infer slices.
- **R4-CS-3** — WHEN a valid optimized plan is executed, THE controller SHALL dispatch
  the complete current slice plus its role-scoped Evidence Capsule v1 and SHALL exclude
  unrelated slices and full conversational history by default.
- **R4-CS-4** — WHEN a slice completes implementation, THE workflow SHALL obtain one
  independent specification verdict and one independent code-quality verdict for that
  complete slice before advancing its state.
- **R4-CS-5** — IF implementation or review discovers omitted behavior, a new
  requirement, an invalid slice boundary, or insufficient plan guidance, THEN THE
  workflow SHALL stop the slice, amend and revalidate the plan, record the deviation,
  and SHALL NOT hide the plan defect only in code.
- **R4-CS-6** — IF a declared risk trigger activates, THEN THE workflow SHALL provide
  full relevant context and full applicable verification, record the fallback, and
  SHALL preserve every review role.

### CLI validation and compatibility

- **R4-VAL-1** — WHEN `awm plan validate PLAN_PATH` receives a valid
  `compact-slices/v1` plan, THE CLI SHALL return success and emit deterministic human or
  `--json` evidence for schema, requirements, slices, sources, commands and traceability.
- **R4-VAL-2** — IF a known optimized-plan declaration is partial, malformed,
  inconsistent, unsafe, or has missing/duplicate/orphan trace IDs, THEN THE CLI SHALL
  fail loudly before handoff with an actionable bounded diagnostic.
- **R4-VAL-3** — IF a plan declares an unsupported future schema, THEN THE CLI SHALL
  fail loudly with the installed/supported schema and an update remedy and SHALL NOT
  reinterpret the plan as legacy.
- **R4-VAL-4** — WHEN a plan has no optimized-plan declaration, THE workflow SHALL
  preserve the existing full-quality execution path without migration or reduced
  context assumptions.
- **R4-VAL-5** — WHEN the validator inspects a plan, THE CLI SHALL perform no file
  mutation, command execution, network request, model invocation, semantic grouping or
  automatic plan rewrite.
- **R4-VAL-6** — IF a source path is absolute, empty, `.`, `..`, traverses outside the
  repository, resolves through a symlink, is not a regular file, or lacks its declared
  anchor/symbol, THEN THE CLI SHALL reject the plan.
- **R4-VAL-7** — IF a verification command contains shell control syntax outside the
  validated command representation, THEN THE CLI SHALL reject it rather than execute
  or normalize it.

### Quality and evidence

- **R4-QUAL-1** — WHEN an optimized cycle runs, THE workflow SHALL retain TDD,
  requirement traceability, specification review, code-quality review, final Track A,
  every applicable Track B lens, sensors, complete project verification,
  documentation, retro and completion gates.
- **R4-QUAL-2** — IF acceptance coverage decreases, a blocker or important defect
  escapes, security or robustness regresses, or a correction is attributable to
  omitted plan/context evidence, THEN THE R4 candidate SHALL fail regardless of token,
  byte, dispatch or quota reduction.
- **R4-EVID-1** — WHEN a normal R4 cycle crosses T0–T4 boundaries, THE initiative SHALL
  record plan/context bytes, requirement/slice/dispatch counts, natural retrievals and
  fallbacks, retries, findings, gates, commits, releases and pull requests without a
  measurement-only model invocation.
- **R4-EVID-2** — IF provider token, cache, model, price or cost fields are unavailable,
  THEN THE evidence SHALL label them `unobservable` and SHALL NOT substitute zero,
  bytes, quota percentage or an invented estimate as measured usage.
- **R4-EVID-3** — WHEN owner-reported quota is recorded, THE evidence SHALL identify it
  as an owner observation with its cycle boundary and SHALL NOT present it as provider
  billing telemetry.
- **R4-EVID-4** — WHEN R4 T3 closes, THE release MAY advance on structural dispatch and
  quality evidence, but THE initiative SHALL NOT claim generalized non-inferiority or
  billed savings until all three approved fresh cycles are complete.

### CLI and registry currentness

- **R4-CUR-1** — WHEN `awm preflight --require-current` runs, THE CLI SHALL
  synchronously compare its installed version with npm `dist-tags.latest` and each
  configured registry's installed exact semver tag with the highest stable semver tag
  advertised by its configured Git remote.
- **R4-CUR-2** — WHEN strict currentness checks remote state, THE CLI SHALL bypass the
  passive local update cache, SHALL use bounded timeouts, and SHALL report the
  authoritative source queried for each component.
- **R4-CUR-3** — IF the CLI is stale, a registry is stale, a pin is behind the current
  stable tag, installed registry provenance is not an exact tag from the configured
  remote, or any required remote state is unverifiable, THEN strict preflight SHALL
  report `degraded`, exit nonzero and provide an exact remediation path.
- **R4-CUR-4** — WHEN strict currentness succeeds, THE human and JSON reports SHALL
  expose component, installed version/ref, latest version/ref, channel, configured
  source, pin state and `checkedAt` without credentials or unrestricted remote output.
- **R4-CUR-5** — WHEN plain `awm preflight` runs without `--require-current`, THE CLI
  SHALL preserve local/offline-compatible behavior and SHALL NOT claim remote
  currentness was verified.
- **R4-CUR-6** — WHEN `development-process` enters a development session, THE skill
  SHALL run strict currentness as an advisory entry check; WHEN `writing-plans` prepares
  an unattended handoff, THE skill SHALL invoke the strict check again and require that
  invocation to succeed as a blocking gate.
- **R4-CUR-7** — WHEN strict preflight identifies stale state, THE preflight command
  SHALL remain read-only and SHALL distinguish the CLI package update, registry unpin
  and registry update commands rather than applying any of them automatically.
- **R4-CUR-8** — WHEN an environment is built from a cacheable image, THE deployment
  guidance SHALL invoke the published CLI `@latest` channel before strict preflight and
  SHALL state that an image which never runs that bootstrap is outside the enforceable
  guarantee boundary.
- **R4-CUR-9** — WHEN a registry's `minCliVersion` is satisfied but either component is
  not current, THE report SHALL show compatibility as satisfied and currentness as
  failed rather than conflating the two gates.

## `compact-slices/v1` Plan Contract

### Document boundary

An optimized plan is a committed UTF-8 Markdown document containing exactly one JSON
manifest between these literal markers:

```markdown
<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-126-r4a",
  "requirements": ["R4-VAL-1", "R4-CUR-1"],
  "sources": [
    {
      "id": "SRC-PREFLIGHT",
      "path": "cli/src/commands/preflight/index.ts",
      "locator": "registerPreflightCommand",
      "fact": "Commander options and JSON/exit-code behavior to extend"
    }
  ],
  "commands": [
    {
      "id": "CMD-RED-PREFLIGHT",
      "program": "npm",
      "args": ["test", "--", "--runInBand", "preflight.test.ts"],
      "covers": ["R4-CUR-1"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Add strict currentness to preflight",
      "requirements": ["R4-CUR-1"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-PREFLIGHT"],
      "redCommands": ["CMD-RED-PREFLIGHT"],
      "greenCommands": ["CMD-RED-PREFLIGHT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "bounded",
      "fallback": ["remote provenance cannot be established"]
    }
  ],
  "closureCommands": ["CMD-RED-PREFLIGHT"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->
```

The manifest is metadata and trace, not a second copy of implementation prose. The
document is an optimized plan if either marker or the literal
`"schema": "compact-slices/` signal is present. Any partial boundary, invalid JSON or
missing required field is therefore a malformed optimized plan, never a legacy plan.
A document with none of those signals follows the legacy path; an unknown schema
inside valid markers is an unsupported future plan and fails closed.

The parser accepts only the fields shown for each object kind, rejects duplicate JSON
keys and validates deserialized content recursively from `unknown`. IDs match
`[A-Z][A-Z0-9-]{0,63}` and are unique within their namespace. The plan is at most
1 MiB, the manifest at most 256 KiB, there are at most 256 requirements, 64 slices,
256 sources and 512 commands, and one command has at most 128 arguments of at most
4,096 characters each. These are safety bounds, not targets for plan size.

### Required slice shape

Each declared `sectionAnchor` occurs exactly once as an HTML anchor and is immediately
followed by the matching slice heading and five required fourth-level sections:

```markdown
<a id="slice-s1"></a>
### Slice S1: Add strict currentness to preflight

#### Surfaces

Modify `registerPreflightCommand` and its focused tests.

#### Implementation

Add the exact option, dependency seams, result fields and fail-closed branches stated
by the slice; include complete signatures and delicate code in the executable plan.

#### Edge cases

Cover timeout, malformed semver, credential-bearing remote URLs and a pin behind the
latest stable registry tag.

#### Evidence

Run `CMD-RED-PREFLIGHT` before and after implementation and record RED/GREEN results;
then obtain the two review verdicts declared in `reviewEvidence`.

#### Fallback

If remote provenance cannot be established, return `unverifiable` and block strict
handoff; never infer currentness from the local checkout.
```

The heading ID/title must equal the manifest entry. Every required section contains
non-whitespace final prose and no draft sentinel. `Implementation` may contain full code
blocks; compactness is achieved by placing shared material once and by excluding
unrelated slices from dispatches, never by imposing an arbitrary line or byte limit on
necessary instructions.

### Traceability rules

- every declared implementation requirement has exactly one owning slice;
- every slice owns at least one requirement;
- dependencies reference existing slices and form an acyclic order;
- every source has a unique ID, a repository-contained regular path, a non-empty
  locator that occurs in that file, a stated fact and one or more slice consumers;
- every test and verification command maps to a requirement or shared closure gate;
- command, source and dependency references resolve to declared IDs;
- `reviewEvidence` is exactly `specification` plus `code-quality`, without duplicates;
- `risk` is exactly `bounded` or `full-context`, and `fallback` is non-empty;
- every risk/fallback trigger is objective enough for an executor or reviewer to apply;
- a specification reviewer decides semantic executability; the CLI validates structure,
  safety and mechanical traceability only.

### Mandatory full-context triggers

Regardless of a slice's initial `risk`, the controller switches visibly to full
relevant context and full applicable verification when any of these occurs:

- the slice changes authentication, authorization, secrets, permissions, security
  boundaries or redaction;
- the slice changes durable-state schemas, migrations or recovery behavior;
- the slice changes root project configuration, build/release/CI behavior or a public
  contract consumed outside the declared surface;
- an implementer or reviewer cannot establish required behavior after one bounded
  authoritative-source retrieval batch;
- changed files, requirements or dependencies escape the declared slice surface;
- a declared source changed, disappeared or no longer proves the fact recorded in the
  validated plan;
- impact remains uncertain after the declared implementation steps are inspected.

The fallback is not a new model-only measurement call. It enriches the normal role's
evidence and is recorded in the initiative ledger.

### Safe command representation

Commands are stored exactly as `program` plus `args`, with a stable ID and covered
requirement IDs. The validator does not execute them. `program` must be a bare
executable name or a repository-relative contained regular executable; it cannot be a
shell (`sh`, `bash`, `zsh`, `cmd`, `powershell`, `pwsh`) or contain whitespace or shell
control characters. Arguments reject NUL/newline bytes, command substitution, shell
chaining, redirects and unresolved globs. If a project genuinely requires shell logic,
the plan references a reviewed repository script whose path passes source containment
and invokes that script directly rather than embedding uncontrolled shell syntax.

## Runtime Flow

1. `brainstorming` produces an approved design with stable requirements.
2. `writing-plans` creates a robust `compact-slices/v1` implementation plan and maps
   every requirement to one explicit slice.
3. `awm plan validate PLAN_PATH` validates contract, traceability, sources, commands and
   safety without executing or rewriting anything.
4. `writing-plans` obtains a successful `awm preflight --require-current` result before
   offering unattended execution.
5. The controller dispatches one complete slice and its role evidence capsule to an
   implementer. TDD occurs inside the slice.
6. Independent specification and code-quality reviewers inspect the same complete
   slice plus the evidence relevant to their role.
7. A failed review returns the slice for correction; a plan defect stops execution and
   requires a committed plan amendment and revalidation.
8. After all slices close, existing full Track A, applicable Track B, sensors,
   project verification, documentation, retro and branch-completion gates run.
9. Existing lifecycle boundaries append initiative evidence without creating a model
   call whose sole purpose is measurement.

## Components and Delivery Order

### R4a — CLI contract and strict preflight

This is a technical delivery label, not a separate product capability.

| Surface | Responsibility |
|---|---|
| `cli/src/core/plan/` | Parse and validate `compact-slices/v1`, source containment, anchors, trace graph and safe argv. |
| `cli/src/commands/plan/` | Register `awm plan validate PLAN_PATH` with human and JSON output and semantic exit codes. |
| `cli/src/core/currentness/` | Resolve authoritative CLI and registry currentness with bounded injectable transports. |
| `cli/src/commands/preflight/checks.ts` | Add conditional strict currentness checks while preserving plain local preflight. |
| `cli/src/commands/preflight/index.ts` | Add `--require-current`, render provenance/remedies, and preserve JSON stdout integrity. |
| `cli/tests/core/plan/` | Contract, traceability, source, path, symlink, command and mutation cases. |
| `cli/tests/core/currentness/` | npm/Git responses, versions, pins, provenance, timeout, unavailable and redaction cases. |
| `cli/tests/commands/plan/` and preflight tests | Human/JSON behavior, exit codes, legacy/future schema and currentness integration. |
| CLI documentation and protected release automation | User commands, container bootstrap, npm publication and `gitHead` acceptance. |

The implementation may adapt module names to existing conventions, but it may not
split parsing/currentness semantics across competing sources of truth.

### R4b — baseline planning and sliced execution

R4b starts only after R4a is merged, published to npm, and the published package
`gitHead` matches the merge commit. Its registry manifest records that observed CLI
version in `minCliVersion`.

| Surface | Responsibility |
|---|---|
| `skills/development-process/` | Run strict currentness at entry as advisory and surface the result. |
| `skills/writing-plans/` | Author robust compact plans, validate them, and block unattended handoff on invalid plan or stale/unverifiable components. |
| `skills/subagent-driven-development/` | Dispatch one complete slice/capsule, preserve two independent reviews, stop on plan defects and record fallback. |
| `skills/executing-plans/` | Apply the same slice boundary and amendment contract in batch execution mode. |
| `skills/requesting-code-review/` and QA skills | Consume slice trace while retaining branch-wide independent closure. |
| Canonical reference under the owning planning skill | Define `compact-slices/v1` authoring and consumption without duplicating the CLI parser. |
| Registry contract/mutation tests | Preserve literal executability, role topology, legacy fallback, provider parity and strict handoff gates. |
| `awm-registry.json`, `catalog.json`, bundles and versions | Activate the contract under the observed compatible CLI and protected release flow. |

## Failure Behavior

| Condition | Required result |
|---|---|
| No optimized declaration | Existing legacy execution and full-quality gates. |
| Partial or malformed known declaration | Validation failure before handoff; never legacy fallback. |
| Unsupported future schema | Validation failure naming supported schema and CLI update remedy. |
| Missing/unsafe/ambiguous source | Validation failure; inline or repair the source. |
| Unsafe command representation | Validation failure; use argv or a reviewed repository script. |
| Requirement or source orphan/duplicate | Validation failure with exact IDs. |
| Cyclic/missing slice dependency | Validation failure with the implicated slice IDs. |
| Requirement or scope discovered during execution | Stop, amend, commit and revalidate the plan before continuing. |
| Reviewer finds insufficient guidance | Record a plan defect; do not cure only the code. |
| Risk/fallback trigger activates | Load full relevant context and full applicable verification; record the fallback. |
| CLI or registry stale/pinned behind | Strict preflight degraded and nonzero with exact update/unpin remedy. |
| Remote state unavailable, malformed or timed out | Strict preflight degraded as `unverifiable`; never assume current. |
| Plain preflight offline | Preserve existing local result and make no currentness claim. |

## Currentness Sources and Remedies

The CLI current source is npm's `dist-tags.latest` for
`agentic-workflow-manager`. Registry current sources are the configured remotes queried
for stable semver tags. Local registry state must resolve to an exact remote tag; a
detached or branch commit is not silently called current.

The authoritative transport contracts are npm's documented
[`npm view`/`dist-tags.latest`](https://docs.npmjs.com/cli/v11/commands/npm-view/)
behavior and Git's documented
[`ls-remote --tags`](https://git-scm.com/docs/git-ls-remote) behavior. Runtime code uses
bounded direct transports with injectable test seams; it does not scrape human command
output.

Strict JSON output is designed for CI and future process gates. Each component record
contains only bounded metadata:

```json
{
  "component": "registry:baseline",
  "installed": "3.9.2",
  "latest": "3.9.2",
  "channel": "stable",
  "source": "https://github.com/Kodria/awm-baseline-registry.git",
  "pin": null,
  "checkedAt": "RFC3339 timestamp",
  "status": "current"
}
```

Allowed statuses are `current`, `stale`, `pinned-behind` and `unverifiable`. Invalid
types, versions, remote output or unexpected states fail closed. URLs are sanitized so
credentials cannot appear in human or JSON output; unrestricted npm/Git output is never
persisted.

Remedies remain explicit mutations outside preflight:

- stale CLI: install `agentic-workflow-manager@latest`, then invoke a fresh AWM process;
- stale unpinned registry: run `awm update --yes` with the fresh CLI;
- stale pinned registry: run `awm unpin REGISTRY_NAME`, then `awm update --yes`;
- unverifiable state: restore access to the named authoritative source and rerun strict
  preflight; offline mode cannot satisfy unattended-currentness policy.

The documented cacheable-container bootstrap is:

```bash
npm exec --yes --package=agentic-workflow-manager@latest -- awm preflight --require-current
```

The actual development command runs only after that bootstrap succeeds. A deployment
may install globally afterward for reuse, but it must not replace the authoritative
strict check with image age, a cached startup log or the passive 24-hour notice.

The plan must test actual current `awm update` ordering before treating one invocation
as sufficient for both CLI and registry convergence. If the running process cannot
safely continue after replacing its global binary, the remedy remains the explicit
fresh-process sequence above rather than adding fragile self-reexec behavior to R4.

## Verification Strategy

### R4a CLI

- table-driven plan parser tests accept exactly `compact-slices/v1` and reject partial,
  malformed, duplicate, orphaned, cyclic, unknown and future states;
- source tests cover empty, `.`, `..`, absolute, traversal, missing, non-regular,
  symlink and missing-anchor cases on POSIX and Windows path forms;
- command tests prove argv is inert data and reject shell control syntax without ever
  executing plan content;
- validator command tests prove deterministic human/JSON output, stdout integrity and
  nonzero failure semantics;
- currentness tests inject npm and Git transports and cover current, stale,
  pinned-behind, malformed semver, missing tags, wrong provenance, timeout, network
  failure and credential redaction;
- preflight tests prove plain mode remains local, strict mode bypasses passive cache,
  compatibility and currentness remain distinct, and unverifiable fails closed;
- integration tests validate one real R4 compact plan and one unchanged legacy plan;
- mutation tests delete each structural, safety, strictness or read-only guard and
  require a targeted failure;
- CLI build, typecheck, focused/full Jest, sensors, and Ubuntu/macOS/Windows CI remain
  blocking because R4a changes executable behavior.

### R4b registry

- authoring tests prove plans retain requirements, interfaces, exact implementation
  guidance, tests, risks, commands and authoritative-source facts;
- execution tests prove each role receives only the complete current slice/capsule and
  can retrieve bounded authoritative evidence without receiving unrelated slices;
- topology tests prove implementation plus two independent reviews still occur per
  slice and all branch-wide QA/closure roles remain;
- defect tests prove omitted guidance, discovered scope and risk activation stop or
  fall back exactly as designed;
- legacy tests prove undeclared plans preserve the existing full-quality path;
- provider-parity tests apply the same contract to Codex and Claude Code;
- currentness tests prove entry is advisory while unattended handoff is blocking;
- mutation tests remove one requirement mapping, instruction obligation, role, gate,
  fallback, amendment rule or currentness gate and require failure;
- registry portability, skill/bundle version, context budget, privacy, release and
  native CI gates remain blocking.

### Real-cycle acceptance

Before publication, the R4 plan used to build R4 must validate under the candidate CLI,
each slice must retain RED/GREEN evidence and two independent reviews, final QA and
sensors must certify the branch, and no blocker/important finding may be attributable
to omitted plan evidence. Structural dispatch reduction is recorded against a
comparable microtask topology without translating calls or bytes into billed tokens.

## Measurement Ledger

- **R3 T4 / R4 T0:** freeze the installed CLI/registry, valid Context Kernel bytes,
  approved R4 design, pre-R4 plan/task topology, currentness evidence and provider-field
  availability before implementation edits.
- **R4 T1:** after CLI candidate validation, record parser/currentness tests, actual plan
  structure, dispatches, fallbacks, corrections and quality outcomes.
- **R4 T2:** after registry candidate review, record slices, per-slice dispatches,
  evidence-capsule/retrieval behavior, plan defects and all retained roles.
- **R4 T3:** after coordinated publication, record CLI npm version and `gitHead`, registry
  release/tag and `minCliVersion`, full gates, PRs, structural result and owner quota
  observation if supplied.
- **R4 T4:** capture during the first normal later development cycle with both R4
  components installed. Do not create a synthetic benchmark or measurement-only agent.

Release-specific labels, the three-cycle corpus, historical baselines and the initiative
target live only in issue #126 and committed evaluation artifacts. The permanent CLI
schema and registry skills use neutral contract/version names.

## Release Sequence

1. Freeze R3 T4 / R4 T0 from the real R4 development boundary. Because the strict flag
   does not exist before R4a, this bootstrap checkpoint records direct authoritative
   npm/Git version evidence and does not claim the future product gate already passed.
2. Implement, review, certify, merge and publish R4a CLI.
3. Verify npm version and published `gitHead` against the R4a merge commit.
4. Write the observed CLI version into R4b `minCliVersion`.
5. Implement, review, certify, merge and publish R4b baseline registry.
6. Update a real environment and prove strict preflight reports both components current
   with separate compatibility/currentness evidence.
7. Run the first normal post-release development as R4 T4 and the second fresh sample.
8. Capture a third normal cycle from a different scope/risk class before any generalized
   savings or non-inferiority claim.

## Quality Non-Regression

R4 fails regardless of structural savings if any of the following occurs:

- a requirement lacks one owning slice or an implementation/test/review trace;
- a low-context executor must invent behavior because the plan omitted required detail;
- a source reference is accepted despite being unsafe, missing or insufficient;
- a plan defect is hidden only in code instead of being amended and revalidated;
- a required implementation, reviewer, QA lens, sensor, documentation, retro or
  completion role is removed;
- stale, pinned-behind or unverifiable components can pass the strict handoff gate;
- plain preflight falsely claims remote currentness while offline;
- Codex and Claude Code differ in required evidence or quality outcome;
- a blocker/important defect, rollback, security regression or robustness regression is
  attributable to compacting the plan or slice payload.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| “Compact” becomes vague | No arbitrary size ceiling; literal sufficiency requirements and independent spec review. |
| Fewer slices become oversized batches | One behavioral boundary, explicit dependencies, bounded surfaces and fallback. |
| Validator pretends to understand semantics | CLI checks mechanics only; planner declares grouping and reviewer certifies executability. |
| References shift work to the executor | Stable bounded source plus required fact; inline detail when any sufficiency condition fails. |
| Markdown grammar becomes brittle | One versioned bounded contract with fixture/mutation coverage; no general Markdown interpretation. |
| A pin disguises an old registry | Separate `pinned-behind` strict failure and exact unpin/update remedy. |
| Offline environment is called current | `unverifiable` is blocking only in explicit strict mode; plain preflight stays honest and local. |
| Cached container never sees R4 | Published `@latest` bootstrap guidance and explicit enforceable-boundary statement. |
| New checks add token cost | Checks are deterministic local/network CLI work, not model calls; model dispatch topology is unchanged except for fewer slices. |
| Structural reduction is mistaken for cost reduction | Separate dispatch/byte evidence from provider telemetry and owner quota observation. |

## Out of Scope

- Automatic semantic grouping, plan rewriting or model-based plan validation.
- Removing, merging, conditionally skipping or routing review roles to cheaper models.
- Provider billing adapters, permanent token telemetry, pricing databases or remote
  analytics.
- Automatic unpinning, package installation or registry mutation from preflight.
- A daemon that forces upgrades on machines where AWM/bootstrap never executes.
- New prompt, source-body, secret, credential or unrestricted-response persistence.
- Generalized savings/non-inferiority claims before the approved three fresh cycles.

## Planning Handoff

After final owner approval, `writing-plans` produces two serial executable plans:

1. **R4a CLI:** plan validator, strict currentness preflight, documentation, protected
   npm release and R3 T4/R4 T0–T1 evidence.
2. **R4b baseline registry:** robust compact-plan authoring, sliced execution/review,
   strict entry/handoff gates, registry release and R4 T2–T3 evidence; blocked on the
   observed published R4a CLI.

The plans use the smallest genuine cohesive slices supported by each repository while
remaining literal enough for low-context executors. The known local sensor compatibility
drift is resolved before unattended handoff and remains distinct from issue #129's
cross-environment sensor lifecycle problem. No documentation-only PR is required solely
for this design artifact; issue #126 remains the cross-session initiative baton until
the concrete technical deliveries open their PRs.
