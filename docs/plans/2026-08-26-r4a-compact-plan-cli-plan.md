# R4a Compact Plan CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan slice-by-slice. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the CLI contract that validates robust `compact-slices/v1` plans and blocks unattended handoff when the CLI or a configured registry is stale, pinned behind, or unverifiable.

**Architecture:** A pure plan module parses one bounded embedded JSON manifest, validates mechanical traceability plus filesystem/argv safety, and exposes it through `awm plan validate`. A separate read-only currentness module compares npm `dist-tags.latest` and exact remote registry tags through injected bounded transports; preflight composes that evidence only when `--require-current` is explicit. The default preflight path remains local and byte-compatible in behavior.

**Tech Stack:** Node.js 22, TypeScript 5.9, Commander 14, Jest 30, native `fetch`, `child_process.execFile`, Git, npm registry JSON, Markdown and JSON. No runtime dependency is added.

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
  "schema": "compact-slices/v1",
  "planId": "issue-126-r4a-compact-plan-cli",
  "requirements": [
    "R4-CP-1", "R4-CP-3", "R4-CS-1", "R4-CS-2",
    "R4-VAL-1", "R4-VAL-2", "R4-VAL-3", "R4-VAL-4", "R4-VAL-5", "R4-VAL-6", "R4-VAL-7",
    "R4-CUR-1", "R4-CUR-2", "R4-CUR-3", "R4-CUR-4", "R4-CUR-5", "R4-CUR-7", "R4-CUR-8", "R4-CUR-9",
    "R4-EVID-1", "R4-EVID-2", "R4-EVID-3", "R4-EVID-4"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-08-26-r4-compact-plans-cohesive-slices-design.md",
      "locator": "## `compact-slices/v1` Plan Contract",
      "fact": "Approved schema, safety, currentness and release contract"
    },
    {
      "id": "SRC-KERNEL-INSPECT",
      "path": "cli/src/core/context-kernel/inspect.ts",
      "locator": "function resolveRegularInside",
      "fact": "Existing fail-closed unknown parsing and realpath containment pattern"
    },
    {
      "id": "SRC-PREFLIGHT-CHECKS",
      "path": "cli/src/commands/preflight/checks.ts",
      "locator": "export async function preflight",
      "fact": "Current preflight composition, option guard and status reduction"
    },
    {
      "id": "SRC-PREFLIGHT-COMMAND",
      "path": "cli/src/commands/preflight/index.ts",
      "locator": "export function registerPreflightCommand",
      "fact": "Commander, human renderer, JSON and exit-code contract"
    },
    {
      "id": "SRC-REGISTRIES",
      "path": "cli/src/core/registries.ts",
      "locator": "export function listRegistries",
      "fact": "Configured registry names, remotes, roots and compatibility gate"
    },
    {
      "id": "SRC-VERSIONING",
      "path": "cli/src/core/versioning.ts",
      "locator": "export async function currentVersion",
      "fact": "Exact installed semver tag and strict semver comparison behavior"
    },
    {
      "id": "SRC-UPDATE-CHECK",
      "path": "cli/src/core/update-check.ts",
      "locator": "export async function fetchLatestVersion",
      "fact": "Passive 24-hour cache that strict currentness must bypass"
    },
    {
      "id": "SRC-CLI-ROUTER",
      "path": "cli/src/index.ts",
      "locator": "registerPreflightCommand(program)",
      "fact": "Single command registration boundary"
    },
    {
      "id": "SRC-CLI-DOCS",
      "path": "docs/cli-reference.md",
      "locator": "### `awm preflight`",
      "fact": "Existing user-facing preflight and update semantics"
    }
  ],
  "commands": [
    {
      "id": "CMD-PLAN-CORE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/core/plan/validate.test.ts"],
      "covers": ["R4-CP-1", "R4-CP-3", "R4-CS-1", "R4-CS-2", "R4-VAL-2", "R4-VAL-3", "R4-VAL-5", "R4-VAL-6", "R4-VAL-7"]
    },
    {
      "id": "CMD-PLAN-CLI",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/commands/plan/index.test.ts"],
      "covers": ["R4-VAL-1", "R4-VAL-4"]
    },
    {
      "id": "CMD-CURRENTNESS-CORE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/core/currentness/check.test.ts"],
      "covers": ["R4-CUR-1", "R4-CUR-2", "R4-CUR-3", "R4-CUR-4", "R4-CUR-7", "R4-CUR-9"]
    },
    {
      "id": "CMD-PREFLIGHT-R4",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/commands/preflight/preflight.test.ts"],
      "covers": ["R4-CUR-3", "R4-CUR-4", "R4-CUR-5", "R4-CUR-7", "R4-CUR-9"]
    },
    {
      "id": "CMD-R4-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/structural/r4-plan-currentness-docs.test.ts"],
      "covers": ["R4-CUR-8", "R4-EVID-2", "R4-EVID-3", "R4-EVID-4"]
    },
    {
      "id": "CMD-BUILD",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "build"],
      "covers": ["R4-VAL-1", "R4-CUR-4"]
    },
    {
      "id": "CMD-SELF-VALIDATE",
      "program": "node",
      "args": ["cli/dist/src/index.js", "plan", "validate", "docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md", "--json"],
      "covers": ["R4-VAL-1", "R4-EVID-1"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["R4-VAL-1", "R4-CUR-3"]
    },
    {
      "id": "CMD-FULL-JEST",
      "program": "npm",
      "args": ["--prefix", "cli", "test"],
      "covers": ["R4-VAL-4", "R4-CUR-5"]
    },
    {
      "id": "CMD-SENSORS",
      "program": "awm",
      "args": ["sensors", "run"],
      "covers": ["R4-EVID-1"]
    },
    {
      "id": "CMD-DIFF-CHECK",
      "program": "git",
      "args": ["diff", "--check"],
      "covers": ["R4-EVID-1"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Validate the compact plan contract",
      "requirements": ["R4-CP-1", "R4-CP-3", "R4-CS-1", "R4-CS-2", "R4-VAL-2", "R4-VAL-3", "R4-VAL-5", "R4-VAL-6", "R4-VAL-7"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN", "SRC-KERNEL-INSPECT"],
      "redCommands": ["CMD-PLAN-CORE"],
      "greenCommands": ["CMD-PLAN-CORE", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["the approved schema cannot be represented without a new runtime dependency"]
    },
    {
      "id": "S2",
      "title": "Expose deterministic plan validation",
      "requirements": ["R4-VAL-1", "R4-VAL-4"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-CLI-ROUTER", "SRC-PREFLIGHT-COMMAND"],
      "redCommands": ["CMD-PLAN-CLI"],
      "greenCommands": ["CMD-PLAN-CLI", "CMD-BUILD", "CMD-SELF-VALIDATE"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "bounded",
      "fallback": ["Commander cannot flush complete JSON before assigning the failure exit code"]
    },
    {
      "id": "S3",
      "title": "Resolve authoritative component currentness",
      "requirements": ["R4-CUR-1", "R4-CUR-2", "R4-CUR-3", "R4-CUR-4", "R4-CUR-7", "R4-CUR-9"],
      "dependsOn": ["S2"],
      "sectionAnchor": "slice-s3",
      "sources": ["SRC-REGISTRIES", "SRC-VERSIONING", "SRC-UPDATE-CHECK"],
      "redCommands": ["CMD-CURRENTNESS-CORE"],
      "greenCommands": ["CMD-CURRENTNESS-CORE", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["remote provenance or credential redaction cannot be established deterministically"]
    },
    {
      "id": "S4",
      "title": "Gate preflight and close R4a evidence",
      "requirements": ["R4-CUR-5", "R4-CUR-8", "R4-EVID-1", "R4-EVID-2", "R4-EVID-3", "R4-EVID-4"],
      "dependsOn": ["S3"],
      "sectionAnchor": "slice-s4",
      "sources": ["SRC-PREFLIGHT-CHECKS", "SRC-PREFLIGHT-COMMAND", "SRC-CLI-DOCS"],
      "redCommands": ["CMD-PREFLIGHT-R4", "CMD-R4-DOCS"],
      "greenCommands": ["CMD-PREFLIGHT-R4", "CMD-R4-DOCS", "CMD-BUILD", "CMD-SELF-VALIDATE", "CMD-TYPECHECK", "CMD-FULL-JEST", "CMD-SENSORS", "CMD-DIFF-CHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["strict mode mutates disk, uses the passive cache, or changes plain preflight behavior"]
    }
  ],
  "closureCommands": ["CMD-PLAN-CORE", "CMD-PLAN-CLI", "CMD-CURRENTNESS-CORE", "CMD-PREFLIGHT-R4", "CMD-R4-DOCS", "CMD-BUILD", "CMD-SELF-VALIDATE", "CMD-TYPECHECK", "CMD-FULL-JEST", "CMD-SENSORS", "CMD-DIFF-CHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

## Source and delivery boundary

- Approved design: `docs/plans/2026-08-26-r4-compact-plans-cohesive-slices-design.md` at `agentic-workflow@676f9cc`.
- Initiative baton: [agentic-workflow#126](https://github.com/Kodria/agentic-workflow/issues/126).
- Base: `origin/main@4847f4c`, AWM CLI `9.3.0`, baseline registry `v3.9.2`.
- R4a changes only the CLI repository. It does not edit installed registry content, global npm state, project context or registry pins.
- R4b remains blocked until the merged R4a commit is published to npm and `npm view agentic-workflow-manager gitHead` equals that merge SHA.
- This plan is serial. Parallel-track plans keep the legacy task contract in R4; `compact-slices/v1` does not invent track metadata absent from the approved schema.

## Requirements

- **R4-CP-1** — Optimized plans declare exactly `compact-slices/v1` and assign every implementation requirement to one owning slice.
- **R4-CP-3** — Delegated detail names one repository-relative regular source, a bounded locator and the exact fact to retrieve.
- **R4-CS-1** — Every slice declares one behavior boundary, requirement ownership, surfaces, dependencies, RED/GREEN, reviews and fallback.
- **R4-CS-2** — The CLI validates structure and traceability without inferring or rewriting semantic grouping.
- **R4-VAL-1** — `awm plan validate PLAN_PATH` emits deterministic human/JSON success for a valid compact plan.
- **R4-VAL-2** — Partial, malformed, inconsistent, unsafe, duplicate or orphan compact plans fail before handoff with bounded diagnostics.
- **R4-VAL-3** — Unsupported future schemas fail loudly with installed/supported schema and update remedy; they never become legacy.
- **R4-VAL-4** — Plans with no optimized signal return the existing full-quality legacy path without migration.
- **R4-VAL-5** — Validation performs no mutation, command execution, network request, model call, grouping or rewrite.
- **R4-VAL-6** — Empty, `.`, `..`, absolute, traversing, symlinked, non-regular, missing or unlocated sources are rejected.
- **R4-VAL-7** — Verification commands use inert program/argv data and reject shells, control syntax, substitution, redirect and unresolved globbing.
- **R4-CUR-1** — Strict preflight compares the installed CLI with npm `dist-tags.latest` and every registry exact tag/SHA with the highest stable tag on its configured remote.
- **R4-CUR-2** — Strict currentness bypasses passive cache, uses bounded timeouts and names each authoritative source.
- **R4-CUR-3** — Stale, pinned-behind, provenance mismatch and unverifiable state degrade strict preflight and exit nonzero with exact remedy.
- **R4-CUR-4** — Human and JSON output expose component, installed/latest, stable channel, sanitized source, pin, checkedAt and status.
- **R4-CUR-5** — Plain preflight remains local/offline-compatible and makes no remote-currentness claim.
- **R4-CUR-7** — Strict preflight is read-only and separates CLI install, unpin and registry update remedies.
- **R4-CUR-8** — Cacheable-container guidance resolves the published CLI `@latest` before strict preflight and states the enforceable boundary.
- **R4-CUR-9** — Compatibility and currentness remain separate verdicts in one strict report.
- **R4-EVID-1** — T0–T4 evidence records structural bytes, requirements, slices, dispatches, retrieval/fallback, retries, findings and delivery gates without measurement-only model work.
- **R4-EVID-2** — Unavailable provider token/cache/model/price/cost values remain `unobservable`, never zero or inferred from bytes.
- **R4-EVID-3** — Owner quota is recorded only as an owner observation with a cycle boundary.
- **R4-EVID-4** — R4 may publish on structural/quality T0–T3, but generalized savings and non-inferiority wait for three fresh cycles.

## File structure

| File | Responsibility |
|---|---|
| `cli/src/core/plan/types.ts` | Closed `compact-slices/v1` types and validation result. |
| `cli/src/core/plan/json.ts` | Bounded recursive-descent JSON duplicate-key guard. |
| `cli/src/core/plan/validate.ts` | Marker classification, runtime guards, graph/trace, source and argv safety. |
| `cli/src/commands/plan/index.ts` | `awm plan validate`, rendering and semantic exit code. |
| `cli/src/core/currentness/types.ts` | Stable report/status/provenance types. |
| `cli/src/core/currentness/check.ts` | npm/Git transport, installed provenance, pin and read-only comparison. |
| `cli/src/commands/preflight/checks.ts` | Conditional compatibility/currentness checks and report field. |
| `cli/src/commands/preflight/index.ts` | `--require-current` and bounded human/JSON output. |
| `cli/src/index.ts` | Register the new `plan` command. |
| `cli/tests/core/plan/validate.test.ts` | Schema, limits, duplicates, graph, source, symlink, argv and read-only tests. |
| `cli/tests/commands/plan/index.test.ts` | Commander, human/JSON, legacy/future and exit-code tests. |
| `cli/tests/core/currentness/check.test.ts` | npm/Git, semver, pin, provenance, timeout, unavailable and redaction tests. |
| `cli/tests/commands/preflight/preflight.test.ts` | Plain/strict composition and compatibility separation. |
| `cli/tests/structural/r4-plan-currentness-docs.test.ts` | CLI reference, installation/container and development guide contract. |
| `README.md`, `docs/cli-reference.md`, `docs/installation.md`, `docs/guides/development-process.md` | Discoverable user and deployment guidance. |
| This plan and issue #126 | R3 T4 / R4 T0–T1 evidence and cross-session trace. |

## Embedded R3 T4 / R4 measurement ledger

All values are captured at normal planning/execution boundaries. No worker is dispatched solely to measure.

| Gate | State at plan approval | Classification |
|---|---|---|
| R3 T4 / R4 T0 environment | CLI `9.3.0`; baseline `v3.9.2`; Context Kernel v1 valid | exact |
| Fixed project context | `13,166` bytes | exact structural |
| Planning analyze gate | installed CLI `9.3.0` returned `unknown command 'plan'` | exact capability limitation; no substitute inferred |
| Planning preflight / context budget | `ready`; 3/3 sensors runnable; `13,166 / 69,000` fixed-context bytes | exact gate evidence |
| Legacy fixed-context baseline | `67,481` bytes | exact historical |
| Plan topology baseline | 12 independently reviewable implementation concerns; approximately `3N+5 = 41` normal dispatches | derived planning baseline |
| Candidate topology | 4 explicit slices; approximately `3S+5 = 17` normal dispatches before retries/fallback | derived planning candidate |
| Provider tokens/cache/model/cost | `unobservable` | unavailable |
| Owner quota at this boundary | not newly supplied | unavailable; do not carry an older percentage forward |

The 12 baseline concerns are: manifest parser, duplicate-key guard, source safety, argv safety, plan command, npm latest, Git remote tags, installed provenance/pins, preflight composition, docs/bootstrap, full regression, and release evidence. Actual dispatches, retries, retrievals, fallbacks, findings and owner observations replace derived values at T1–T4. Neither bytes nor dispatch count is billed-token evidence.

## Slice execution contract

Each slice is a closed vertical change. The implementer receives this plan plus only the sources named by the slice. After GREEN, one fresh reviewer checks requirement/specification compliance and a different fresh reviewer checks code quality. The implementer resolves both reviews and reruns the slice commands before the slice can close. If a slice discovers that its declared boundary is wrong, stop, amend this plan, rerun `awm plan validate`, and record the amendment in issue #126; do not silently regroup work.

<a id="slice-s1"></a>
### Slice S1: Validate the compact plan contract

#### Surfaces

- Create `cli/src/core/plan/types.ts`, `cli/src/core/plan/json.ts`, and `cli/src/core/plan/validate.ts`.
- Create `cli/tests/core/plan/validate.test.ts` and test fixtures under the test temporary directory; do not add a production fixture parser.
- Own requirements R4-CP-1, R4-CP-3, R4-CS-1, R4-CS-2, R4-VAL-2, R4-VAL-5, R4-VAL-6, and R4-VAL-7.

#### Implementation

1. Write failing tests in `cli/tests/core/plan/validate.test.ts` before production code. Cover one valid manifest and one focused case for every rejection below. Run `npm --prefix cli test -- --runInBand tests/core/plan/validate.test.ts` and record the expected RED failure caused by the absent plan module.
2. In `types.ts`, define closed runtime-facing types for `compact-slices/v1`: requirement IDs, sources, inert commands, slices, review roles, and a discriminated `PlanValidationReport` with `valid`, `legacy`, `invalid`, and `unsupported` outcomes. Diagnostics contain a stable code, bounded message, and optional bounded field path; they never contain file bodies, credentials, or command output.
3. In `json.ts`, implement a dependency-free recursive-descent JSON scanner that consumes strings, numbers, literals, arrays, and objects while maintaining a fresh key set for every object. Reject duplicate keys before returning `JSON.parse(text) as unknown`. Validate parser input as a string and fail loudly on malformed JSON.
4. In `validate.ts`, expose `validatePlanFile(planPath: string, cwd = process.cwd()): PlanValidationReport`. Validate both public inputs, resolve the plan below `cwd`, require a regular non-symlink file, cap the plan at 1 MiB, and read it without mutation.
5. Classify a plan as optimized when either compact marker or the literal schema signal `"schema": "compact-slices/` is present. Require exactly one ordered start/end marker pair for `v1`. A partial marker, malformed body, or unsupported `compact-slices/*` schema is never classified as legacy.
6. Enforce an exact-field manifest with top-level fields `schema`, `planId`, `requirements`, `sources`, `commands`, `slices`, and `closureCommands`; reject unknown and missing fields at every object level. Cap the manifest at 256 KiB, requirements at 256, slices at 64, sources at 256, commands at 512, argv at 128 entries, and every scalar string at 4,096 characters. Require plan IDs in lower kebab case and entity IDs matching `[A-Z][A-Z0-9-]{0,63}`.
7. Prove traceability: every requirement is unique and owned by exactly one slice and has at least one `covers` command referenced by that owning slice; every command/source/slice reference resolves; no requirement, source, or command is orphaned; dependencies are unique, non-self-referential, and acyclic; every slice declares exactly `specification` and `code-quality` review evidence, a `bounded` or `full-context` risk, and at least one nonempty fallback condition.
8. Resolve each source path beneath `cwd` and reject empty, `.`, `..`, absolute, Windows-absolute, backslash-containing, traversing, missing, non-regular, escaped, or symlink-component paths. Require its locator to occur in the bounded source file. Do not follow a symlink even when its target remains inside the repository.
9. Treat commands strictly as inert `{ program, args }` data. Accept a bare executable name or a repository-contained executable regular file. Reject shell programs, NUL/newline characters, substitutions, chaining, redirects, glob metacharacters, and shell control syntax. Never execute or normalize a declared command.
10. Require each slice anchor exactly once in Markdown, followed by the exact heading `### Slice ID: title` and nonempty `#### Surfaces`, `Implementation`, `Edge cases`, `Evidence`, and `Fallback` subsections before the next slice.
11. Run the focused test to GREEN. Add mutation proofs that remove one requirement owner, duplicate one JSON key, insert a symlink source, introduce a cycle, and inject `sh -c`; each mutation must fail with the expected stable diagnostic.

#### Edge cases

- A document with no compact marker or schema signal is a successful `legacy` result, not an invalid optimized plan.
- A future schema signal with broken markers is `unsupported` only when the schema value can be safely identified; otherwise it is `invalid`. Both block handoff.
- File-system errors, invalid UTF-8 replacement, oversized input, duplicate headings, and a locator split across lines fail closed with bounded diagnostics.
- The validator does not infer slice grouping, add requirements, rewrite Markdown, call Git/npm, or consult model context.

#### Evidence

- RED and GREEN output from `CMD-PLAN-CORE` recorded in the slice capsule.
- Mutation table with mutation, expected diagnostic code, and observed verdict.
- Independent specification review checks all eight owned requirements against tests and code.
- Independent code-quality review checks bounded parsing, path safety, diagnostic hygiene, and absence of execution/mutation.
- Commit only this slice after both reviews are resolved and `git diff --check` passes.

#### Fallback

- Stop and amend/revalidate the plan if exact validation requires semantic grouping or undocumented schema fields.
- Use the full-context implementation/review path if parser or path-safety risk cannot be reviewed from the declared surfaces.
- Do not relax duplicate-key, symlink, traversal, argv, or limit checks to obtain GREEN.

<a id="slice-s2"></a>
### Slice S2: Expose deterministic plan validation

#### Surfaces

- Create `cli/src/commands/plan/index.ts` and `cli/tests/commands/plan/index.test.ts`.
- Modify `cli/src/index.ts` only to register the new command family.
- Own requirements R4-VAL-1, R4-VAL-3, and R4-VAL-4; depend on S1.

#### Implementation

1. Write Commander-level RED tests that invoke a fresh command instance through `parseAsync`. Cover valid human output, valid `--json`, legacy success, invalid compact failure, unsupported future schema, missing path, extra arguments, and output completion before `process.exitCode` is set.
2. Implement `registerPlanCommand(program, deps?)` with `awm plan validate <plan-path> [--json] [--cwd <path>]`. Inject the validator in tests; validate options and dependencies at the public boundary.
3. Map `valid` and `legacy` to exit code 0. Map `invalid` and `unsupported` to semantic exit code 2. Human output contains one status line, bounded counts/diagnostics, and the exact legacy/full-quality or unsupported/update remedy. JSON output is one stable object and contains no passive update banner.
4. Register the command in `cli/src/index.ts` alongside existing command registrars without changing startup/update-check behavior for other commands.
5. Run `CMD-PLAN-CLI` to GREEN, then `CMD-BUILD`. Run the built CLI against this plan with `CMD-SELF-VALIDATE`; it must report `valid`, four slices, and complete ownership.

#### Edge cases

- `--cwd` changes only repository containment and source resolution; it never changes the plan path text reported to the user.
- A legacy plan succeeds with an explicit message that the existing full-quality path applies; it must not imply compact optimization.
- Unsupported schemas name installed support (`compact-slices/v1`) and direct the operator to update AWM without attempting migration.
- JSON mode writes diagnostics to stdout as structured data and reserves stderr for process/runtime faults.

#### Evidence

- RED/GREEN output from `CMD-PLAN-CLI`, build output, and the self-validation summary.
- Snapshot assertions for human and JSON output plus exit codes.
- Independent specification review checks all three owned requirements and confirms future schemas never fall through to legacy.
- Independent code-quality review checks Commander lifecycle, dependency injection, output bounds, and no regression in existing registration.

#### Fallback

- Stop if the command cannot preserve deterministic output without changing the shared command-result contract; amend the plan before widening that surface.
- Keep validation available through the core API but do not hand off compact plans if CLI registration or output ordering remains unreliable.

<a id="slice-s3"></a>
### Slice S3: Resolve authoritative component currentness

#### Surfaces

- Create `cli/src/core/currentness/types.ts`, `cli/src/core/currentness/check.ts`, and `cli/tests/core/currentness/check.test.ts`.
- Read existing registry, version, preference, and update-check helpers only through the declared locators; do not change passive update behavior.
- Own requirements R4-CUR-1, R4-CUR-2, R4-CUR-3, R4-CUR-4, and R4-CUR-7.

#### Implementation

1. Write RED tests with injected `fetch`, Git transport, clock, environment, package version, preferences, and registry inventory. Cover current/stale CLI, current/stale registry, pinned-behind, branch/dev checkout, origin mismatch, inaccessible npm/Git, timeout, malformed semver, no configured registries, credential-bearing URLs, and `AWM_NO_UPDATE_CHECK=1`.
2. Define a bounded `CurrentnessComponent` report containing component, installed, latest, channel `stable`, sanitized source, optional pin, checkedAt, status (`current`, `stale`, `pinned-behind`, `unverifiable`), bounded detail, and exact remedy. The aggregate report preserves compatibility separately; it does not conflate `minCliVersion` with latest-version currentness.
3. Implement `checkCurrentness(cwd, deps)` as read-only. Read preferences with the non-writing `readPreferences()` path. Fetch npm package metadata from the authoritative registry and read `dist-tags.latest`; bypass the passive 24-hour cache and honor a bounded timeout.
4. Query each configured registry remote with an argument-array transport equivalent to `git ls-remote --tags --refs REMOTE v*`, bounded timeout, bounded output, and no shell. Select the highest stable `vX.Y.Z`; ignore prerelease/non-semver tags.
5. Compare local HEAD SHA, exact stable tag, configured clone origin, configured remote, and remote tag SHA. Exact stable tag plus matching SHA/source is current. A stable older tag is stale or pinned-behind. Branch/dev state, missing provenance, source mismatch, no stable remote tag, and unavailable authority are unverifiable and block strict mode.
6. Sanitize sources before they enter reports/errors. Strip credentials, query, and fragment from supported HTTPS URLs; accept only bounded safe SSH/SCP forms; render all other values as `[configured remote]`.
7. Emit exact remedies: stale CLI installs `agentic-workflow-manager@latest` and invokes a fresh process; stale unpinned registry runs `awm update --yes`; pinned-behind runs `awm unpin REGISTRY_NAME` then `awm update --yes`; unverifiable state restores source access and reruns strict preflight.
8. Ensure `AWM_NO_UPDATE_CHECK` disables only the passive update notification. An explicitly invoked strict check still contacts authoritative sources.
9. Run `CMD-CURRENTNESS-CORE` to GREEN. Add mutation proofs for passive-cache reuse, preference write, credential leak, accepted branch provenance, and ignored pin; each must be caught.

#### Edge cases

- No configured registry produces a bounded unverifiable component rather than silently claiming currentness.
- Two remote tags pointing at the same SHA still use the highest stable semantic version as `latest`.
- npm/Git timeout, malformed body, excessive output, missing HEAD, and deleted configured remote are unverifiable, never current.
- The checker does not install, update, unpin, sync, write preferences, modify Git, or populate the passive cache.

#### Evidence

- RED/GREEN output from `CMD-CURRENTNESS-CORE` and mutation verdicts.
- Read-only proof comparing relevant preference, registry, Git HEAD/index, and working-tree state before and after representative strict checks.
- Independent specification review checks the five owned requirements and all status/remedy mappings.
- Independent code-quality review checks transport injection, time/output bounds, semver logic, provenance, redaction, and secret-safe diagnostics.

#### Fallback

- Any ambiguous stable provenance is `unverifiable`; never downgrade it to a warning.
- Stop and use the full-context review path if transport/provenance changes cross undeclared registry-update behavior.
- Do not reuse the passive update cache or writing preference helper even if it reduces implementation size.

<a id="slice-s4"></a>
### Slice S4: Gate strict preflight and close release evidence

#### Surfaces

- Modify `cli/src/commands/preflight/checks.ts` and `cli/src/commands/preflight/index.ts`.
- Create or extend `cli/tests/commands/preflight/preflight.test.ts` and create `cli/tests/structural/r4-plan-currentness-docs.test.ts`.
- Modify `README.md`, `docs/cli-reference.md`, `docs/installation.md`, and `docs/guides/development-process.md`.
- Update this plan’s measurement ledger and issue #126 only with observed values.
- Own requirements R4-CUR-5, R4-CUR-8, R4-CUR-9, R4-EVID-1, R4-EVID-2, R4-EVID-3, and R4-EVID-4; depend on S2 and S3.

#### Implementation

1. Write RED tests proving plain preflight never invokes the remote checker and preserves its existing local/offline report. Add strict tests for all-current success; stale CLI; stale/pinned/unverifiable registry; compatibility failure while current; currentness failure while compatible; JSON fields; and exact remedies.
2. Extend validated public options with `requireCurrent?: boolean`. Add explicit compatibility/currentness check IDs or an equally separate typed representation. Add the optional currentness report only when strict mode was requested.
3. Register `--require-current` on `awm preflight`. Strict mode synchronously runs compatibility plus authoritative currentness, degrades status and exits nonzero on any stale, pinned-behind, or unverifiable component, and renders the bounded component fields from S3. It remains read-only.
4. Preserve `awm preflight` and `awm preflight --verify-sensors` behavior when strict mode is absent. Combining `--require-current --verify-sensors` runs both gates in one report without hiding either verdict.
5. Add docs tests first, then document `awm plan validate PLAN_PATH`, legacy behavior, strict preflight semantics, remedies, and the cache-resistant bootstrap exactly as:
   `npm exec --yes --package=agentic-workflow-manager@latest -- awm preflight --require-current`.
6. State the enforceable boundary plainly: the gate can protect only an environment that executes a fresh CLI/bootstrap; it cannot update a host or cached container that never runs new code. Keep `minCliVersion` compatibility documented separately.
7. Run `CMD-PREFLIGHT-R4` and `CMD-R4-DOCS` to GREEN, then `CMD-BUILD`, `CMD-SELF-VALIDATE`, `CMD-TYPECHECK`, `CMD-FULL-JEST`, `CMD-SENSORS`, and `CMD-DIFF-CHECK` in order. Do not repair the previously reported cross-environment sensor issue inside R4; link issue #129 if it reproduces.
8. Record R4 T1 facts in this plan and issue #126: exact plan bytes, requirement/slice/source/command counts, actual dispatches/retries/fallbacks/review findings, Context Kernel bytes, gate verdicts, provider observability, and any owner quota observation supplied for this cycle. Never derive token or cost values from bytes.
9. Complete post-implementation QA, documentation verification, harness retro, and branch-finish checks using their normal full-quality gates. Publish the CLI through the protected release workflow. After merge, verify `npm view agentic-workflow-manager version` and `npm view agentic-workflow-manager gitHead`; R4b remains blocked until `gitHead` equals the merged R4a SHA.

#### Edge cases

- `--json --require-current` contains no human banner, no credential-bearing URL, and no omitted failing component.
- A strict check with zero registries is nonzero/unverifiable even when the CLI is current.
- A registry may be compatible but stale, or current but incompatible; both dimensions remain visible and either can block.
- A failed network authority does not trigger update/install commands and does not alter plain preflight’s offline compatibility.

#### Evidence

- Focused RED/GREEN results, full Jest/type/build/sensor/diff results, and self-validation output.
- Docs contract test verifies the exact bootstrap, remedies, boundary statement, and separation of compatibility/currentness.
- Independent specification review checks all seven owned requirements and the approved design’s honest update guarantee.
- Independent code-quality review checks default-mode nonregression, strict composition, output secrecy/bounds, and release readiness.
- Merge SHA, release workflow URL, npm version, and matching npm `gitHead` become the R4a delivery checkpoint in issue #126.

#### Fallback

- Plain preflight behavior is a hard compatibility boundary; revert only the strict composition if default/offline semantics regress.
- Strict mode fails closed when authoritative state cannot be proved; do not add cached or warning-only success.
- Block R4b if npm publication is absent, its `gitHead` differs from the merged R4a SHA, or any full gate fails.

## Final verification and release gate

From the CLI repository root, run exactly:

```bash
npm --prefix cli ci
npm --prefix cli test -- --runInBand tests/core/plan/validate.test.ts
npm --prefix cli test -- --runInBand tests/commands/plan/index.test.ts
npm --prefix cli test -- --runInBand tests/core/currentness/check.test.ts
npm --prefix cli test -- --runInBand tests/commands/preflight/preflight.test.ts
npm --prefix cli test -- --runInBand tests/structural/r4-plan-currentness-docs.test.ts
npm --prefix cli run build
node cli/dist/index.js plan validate docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md --cwd . --json
npm --prefix cli run typecheck
npm --prefix cli test -- --runInBand
awm sensors run --event pre-commit --format json
git diff --check
```

Before execution handoff, run the currently installed planning gates from the repository root:

```bash
awm plan analyze docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md --json
awm preflight
awm context-budget
```

`awm plan validate` and `awm preflight --require-current` are R4a deliverables and therefore are not claimed as available at T0. After S2/S4 they become mandatory self-validation and release gates. If `awm plan analyze` is unavailable in the installed CLI, record that exact limitation and do not substitute a fabricated result.

## Requirement traceability

| Requirement | Owning slice | Primary tests/evidence |
|---|---|---|
| R4-CP-1 | S1 | Valid/duplicate/orphan ownership tests |
| R4-CP-3 | S1 | Source path, locator, limit and symlink tests |
| R4-CS-1 | S1 | Slice fields, headings, sections and review-role tests |
| R4-CS-2 | S1 | No-rewrite/read-only snapshot and grouping mutation |
| R4-VAL-1 | S2 | Valid human/JSON CLI snapshots |
| R4-VAL-2 | S1 | Malformed, duplicate, inconsistent, unsafe and limit matrix |
| R4-VAL-3 | S2 | Future-schema exit-2/remedy tests |
| R4-VAL-4 | S2 | Legacy exit-0/full-quality tests |
| R4-VAL-5 | S1 | Transport/exec spies and read-only snapshot |
| R4-VAL-6 | S1 | Adversarial source and symlink matrix |
| R4-VAL-7 | S1 | Inert argv acceptance/rejection matrix |
| R4-CUR-1 | S3 | npm latest and Git highest-stable/provenance tests |
| R4-CUR-2 | S3 | Cache bypass and timeout/output-bound tests |
| R4-CUR-3 | S3 | Stale/pinned/unverifiable status and remedy matrix |
| R4-CUR-4 | S3 | Human-neutral typed report and redaction snapshots |
| R4-CUR-5 | S4 | Plain preflight no-remote regression tests |
| R4-CUR-7 | S3 | Read-only proof and exact remedy tests |
| R4-CUR-8 | S4 | Structural docs/bootstrap/boundary test |
| R4-CUR-9 | S4 | Compatibility/currentness independent verdict tests |
| R4-EVID-1 | S4 | T0/T1 ledger and issue checkpoint |
| R4-EVID-2 | S4 | `unobservable` field assertions |
| R4-EVID-3 | S4 | Owner-observation provenance assertion |
| R4-EVID-4 | S4 | Claim-boundary docs and three-cycle deferral assertion |

## Execution handoff

- Work serially S1 → S2 → S3 → S4. Commit each closed slice separately.
- Every slice capsule records owned requirements, exact source retrievals, RED/GREEN commands, reviewer identities, findings, retries, fallback, and final SHA.
- Do not dispatch a worker solely to collect usage data. Capture measurements at normal implementation, review, QA, and release boundaries.
- Do not open the R4a pull request until all closure commands, independent reviews, full QA/docs/retro, and release-readiness checks pass.
