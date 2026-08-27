# Sensor Portability Publication B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan slice-by-slice. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an explicit, atomic, idempotent project bootstrap that writes portable v3 sensor/native-gate/opt-out declarations only after Publication A has proven dual-read portability in real environments.

**Architecture:** Reuse Publication A's parser, project resolver, and logical source binding to build a pure bootstrap planner and a narrow atomic applier. Migration preserves v2 sensor semantics, never mutates machine state, and writes no project bytes during dry-run or invalid/ambiguous cases.

**Tech Stack:** Node.js 22, TypeScript 5.9, Commander 14, Jest 30, local filesystem atomic rename, existing AWM pack materialization, Markdown and JSON. No runtime dependency is added.

**Modo de ejecución:** interactivo

---

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-129-sensor-portability-publication-b",
  "requirements": ["PORT-01", "BOOT-01", "BOOT-02", "BOOT-03", "BOOT-04", "BOOT-05", "BOOT-06", "BOOT-07", "BOOT-08"],
  "sources": [
    {
      "id": "SRC-DESIGN-B",
      "path": "docs/plans/2026-08-27-cross-environment-sensor-portability-design.md",
      "locator": "## Project bootstrap and migration",
      "fact": "Approved one-time project bootstrap, migration safety, and fixed-machine rollout contract"
    },
    {
      "id": "SRC-PUB-A-GATE",
      "path": "docs/plans/2026-08-27-sensor-portability-publication-a-plan.md",
      "locator": "## Publication B entry gate",
      "fact": "Required published dual-reader evidence before any v3 project adoption"
    },
    {
      "id": "SRC-MATERIALIZE",
      "path": "cli/src/commands/sensors/compatibility/materialize.ts",
      "locator": "export function materializeResolvedSensors",
      "fact": "Existing atomic v2 manifest and selected-asset materialization with rollback"
    },
    {
      "id": "SRC-INIT",
      "path": "cli/src/commands/sensors/init.ts",
      "locator": "export async function initSensors",
      "fact": "Existing stack detection, compatibility resolution, operator intent preservation, and pack asset selection"
    },
    {
      "id": "SRC-SENSORS-CLI",
      "path": "cli/src/commands/sensors/index.ts",
      "locator": "export function registerSensorsCommand",
      "fact": "Current Commander sensor command registration and rendering conventions"
    }
  ],
  "commands": [
    {
      "id": "CMD-MIGRATION-CORE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/commands/sensors/compatibility/manifest.test.ts", "tests/commands/sensors/compatibility/materialize.test.ts", "tests/commands/sensors/migrate.test.ts"],
      "covers": ["BOOT-07", "BOOT-08"]
    },
    {
      "id": "CMD-BOOTSTRAP-CORE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/commands/sensors/bootstrap.test.ts"],
      "covers": ["BOOT-01", "BOOT-03", "BOOT-05", "BOOT-06"]
    },
    {
      "id": "CMD-BOOTSTRAP-CLI",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/commands/sensors/index.test.ts", "tests/commands/sensors/init.test.ts", "tests/core/init/steps.test.ts", "tests/integration/sensor-bootstrap.e2e.test.ts", "tests/structural/sensor-portability-contract.test.ts"],
      "covers": ["PORT-01", "BOOT-02", "BOOT-04"]
    },
    {
      "id": "CMD-TYPECHECK-B",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["BOOT-07"]
    },
    {
      "id": "CMD-BUILD-B",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "build"],
      "covers": ["BOOT-02"]
    },
    {
      "id": "CMD-FULL-JEST-B",
      "program": "npm",
      "args": ["--prefix", "cli", "test"],
      "covers": ["BOOT-04"]
    },
    {
      "id": "CMD-SENSORS-B",
      "program": "awm",
      "args": ["sensors", "run"],
      "covers": ["BOOT-08"]
    },
    {
      "id": "CMD-DIFF-B",
      "program": "git",
      "args": ["diff", "--check"],
      "covers": ["BOOT-05"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Serialize v3 and prove semantic migration",
      "requirements": ["BOOT-07", "BOOT-08"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN-B", "SRC-PUB-A-GATE", "SRC-MATERIALIZE"],
      "redCommands": ["CMD-MIGRATION-CORE"],
      "greenCommands": ["CMD-MIGRATION-CORE", "CMD-TYPECHECK-B", "CMD-SENSORS-B"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["v2 semantics cannot be represented byte-stably in the approved v3 contract"]
    },
    {
      "id": "S2",
      "title": "Plan bootstrap without writes",
      "requirements": ["BOOT-01", "BOOT-03", "BOOT-05", "BOOT-06"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-INIT"],
      "redCommands": ["CMD-BOOTSTRAP-CORE"],
      "greenCommands": ["CMD-BOOTSTRAP-CORE", "CMD-DIFF-B"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["stack detection or v2 source binding cannot produce a complete deterministic change plan"]
    },
    {
      "id": "S3",
      "title": "Apply bootstrap atomically and expose the CLI",
      "requirements": ["PORT-01", "BOOT-02", "BOOT-04"],
      "dependsOn": ["S2"],
      "sectionAnchor": "slice-s3",
      "sources": ["SRC-SENSORS-CLI", "SRC-MATERIALIZE"],
      "redCommands": ["CMD-BOOTSTRAP-CLI"],
      "greenCommands": ["CMD-BOOTSTRAP-CLI", "CMD-BUILD-B", "CMD-FULL-JEST-B"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["atomic project write or exact second-run no-op cannot be proven on every supported platform"]
    }
  ],
  "closureCommands": ["CMD-MIGRATION-CORE", "CMD-BOOTSTRAP-CORE", "CMD-BOOTSTRAP-CLI", "CMD-TYPECHECK-B", "CMD-BUILD-B", "CMD-FULL-JEST-B", "CMD-SENSORS-B", "CMD-DIFF-B"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

## Entry gate and delivery boundary

Execution must first satisfy `SRC-PUB-A-GATE`. If Publication A is not merged,
published, and verified in Codex, Claude Code, and one fixed machine, stop without
starting S1. Base on the published dual-reader's merge commit.

This plan changes project files only when the operator explicitly invokes bootstrap
without `--dry-run`. It never edits machine registry inventory, installs npm/project
packages, updates hooks, prunes context, or changes `AGENTS.md`, `CLAUDE.md`,
`CONSTITUTION.md`, package manifests, lockfiles, or existing pack assets during v2
migration. Do not migrate the repository's own manifest until all slices pass and the
published Publication B package is available.

## Requirements owned by Publication B

This plan owns PORT-01 and BOOT-01 through BOOT-08 from the approved design. All other
requirements are delivered and preserved by Publication A. The compact manifest gives
each owned ID one slice and direct test command.

## File structure

| File | Responsibility |
|---|---|
| `cli/src/commands/sensors/compatibility/manifest.ts` | Canonical v3 serialization using logical identity and no machine path. |
| `cli/src/commands/sensors/compatibility/materialize.ts` | Atomic v3 manifest commit and selected assets for new projects. |
| `cli/src/commands/sensors/migrate.ts` | Pure v2-to-v3 semantic conversion and equivalence comparison. |
| `cli/src/commands/sensors/bootstrap.ts` | Pure bootstrap planning plus narrow atomic apply operation. |
| `cli/src/commands/sensors/index.ts` | `sensors bootstrap` options, dry-run rendering, confirmation-free semantic exits. |
| `cli/src/commands/sensors/init.ts` | Compatibility API delegates new project creation to portable bootstrap; it never persists a physical root. |
| `cli/src/core/init/types.ts`, `cli/src/core/init/steps.ts` | `awm init` sensor step calls the same logical project bootstrap contract. |
| `cli/tests/commands/sensors/migrate.test.ts` | Field preservation, logical source, invalid/ambiguous rejection, and candidate validation. |
| `cli/tests/commands/sensors/bootstrap.test.ts` | Mode state machine, reason validation, dry run, no-op, and no-write failures. |
| `cli/tests/integration/sensor-bootstrap.e2e.test.ts` | Apply twice, byte stability, atomic failure, asset scope, and clean second run. |
| Existing structural contract test and sensor docs | Exact CLI syntax, v3 examples, migration timing, and machine/project separation. |

## Slice execution contract

Every slice uses RED, minimal implementation, GREEN, specification review, code-quality
review, remediation, and one focused commit. No executor may enter this plan by
reinterpreting simulated Publication A tests as the required packaged multi-environment
evidence.

<a id="slice-s1"></a>
### Slice S1: Serialize v3 and prove semantic migration

#### Surfaces

Create `migrate.ts` and `migrate.test.ts`. Modify the manifest serializer and
materializer with a v3-specific path while retaining v2 APIs for rollback. Own
BOOT-07 and BOOT-08.

#### Implementation

- [ ] Confirm and record the Publication A entry evidence before touching code. Add
  RED tests that convert bound and rebound v2 fixtures into v3 while preserving pack,
  selection intent, package root, sensor keys, enabled/fast/timeout, variant,
  structured command, assets, policy, initialized evidence, and concurrency.
- [ ] Add RED serializer cases proving deterministic newline-terminated output,
  parser round-trip, no `registryRoot`, no physical root/HOME substring, and exact
  `source.registry`.
- [ ] Implement `serializeManifestV3(input)` through the production parser boundary.
  Define `planV2Migration(project, source)` as a pure function returning the v3
  candidate plus a field-by-field equivalence report; reject non-project modes,
  unavailable/ambiguous sources, and any mismatch.
- [ ] Add a v3 materialization entry point that accepts the already validated logical
  registry name and selected pack root, validates the complete candidate before any
  write, and retains the existing atomic temporary-file cleanup behavior.
- [ ] Run CMD-MIGRATION-CORE, CMD-TYPECHECK-B, and CMD-SENSORS-B to GREEN, then commit
  migration and serialization.

#### Edge cases

Reject registry IDs with separators, control characters, or unstable casing. Preserve
disabled sensors and custom timeouts exactly. Never translate legacy string commands
in this migration path. If candidate serialization parses differently from the input
semantic model, fail before write. A failed rename leaves the original bytes intact.

#### Evidence

CMD-MIGRATION-CORE asserts every preserved field and absence of machine identity.
CMD-SENSORS-B proves the unchanged v2 repository remains runnable; this slice does not
migrate it. Reviewers compare the equivalence report with BOOT-07 rather than accepting
JSON shape similarity.

#### Fallback

Use full v2 parser/materializer and design context if semantic equivalence cannot be
represented. Keep the v2 file and stop Publication B; do not drop a field, regenerate
commands, or rewrite assets to force migration.

<a id="slice-s2"></a>
### Slice S2: Plan bootstrap without writes

#### Surfaces

Create `bootstrap.ts` and `bootstrap.test.ts`. Reuse Publication A project/source
results and current init detection without invoking existing write paths. Own BOOT-01,
BOOT-03, BOOT-05, and BOOT-06.

#### Implementation

- [ ] Add RED table tests for valid v3 no-op, v2 migration plan, portable v1 preserve,
  missing without mode, missing project-sensors, missing native-gate/opt-out with and
  without reason, invalid manifest, unavailable source, ambiguous source, and invalid
  options. Snapshot all project and machine files before/after planning.
- [ ] Define `BootstrapOptions` with optional closed mode, reason, and `dryRun`; reject
  unknown keys, invalid booleans, conflicting mode/current state, and control-bearing
  reasons. Define `BootstrapPlan` as `noop | create | migrate | blocked` with bounded
  changes and a stable reason/remedy.
- [ ] Implement `planSensorBootstrap(cwd, options, deps)` without writes. Missing state
  requires mode; native-gate and opt-out require a non-empty single-line reason;
  project-sensors resolves one logical registry/pack and lists the exact manifest and
  new pack assets. Existing equivalent v3 returns no-op.
- [ ] Ensure malformed, unsupported, source-unavailable, source-ambiguous, and
  non-equivalent migration return blocked plans and cannot reach an apply callback.
- [ ] Run CMD-BOOTSTRAP-CORE and CMD-DIFF-B to GREEN, then commit the pure planner.

#### Edge cases

Do not infer native CI from workflow files or opt-out from disabled sensors. Do not
overwrite v1 custom commands. Bound reason and change-list output. Existing project
assets are preserved and omitted from the write set. Dry-run and ordinary planning
must be observationally identical except for the rendered label.

#### Evidence

CMD-BOOTSTRAP-CORE proves the complete state table, exact write set, and zero mutation.
Every blocked reason has a focused assertion and no broad marker substitute. Reviewers
verify that machine installation remedies remain recommendations, not planner actions.

#### Fallback

Use full init/source/planner context if stack detection cannot be separated from
materialization. Stop and extract a pure detection boundary; never call `initSensors`
from dry-run and attempt to undo its writes.

<a id="slice-s3"></a>
### Slice S3: Apply bootstrap atomically and expose the CLI

#### Surfaces

Modify `bootstrap.ts`, `sensors/index.ts`, `sensors/init.ts`, `core/init/types.ts`,
`core/init/steps.ts`, their focused tests, integration tests, structural contract
tests, and sensor documentation. Own PORT-01, BOOT-02, and BOOT-04.

#### Implementation

- [ ] Add RED Commander tests for exact syntax
  `awm sensors bootstrap [--mode project-sensors|native-gate|opt-out] [--reason <text>] [--dry-run]`,
  human summaries, invalid input exit, blocked exit, and JSON-safe bounded errors if
  the command exposes JSON. Add RED e2e tests for create/apply twice and migrate/apply
  twice.
- [ ] Implement `applySensorBootstrap(plan)` accepting only a validated create or
  migrate plan. New project-sensors may atomically create the v3 manifest and missing
  selected assets; migration changes only `.awm/sensors.json`; native/opt-out create
  only that manifest. Validate all candidates before the first write.
- [ ] Wire the CLI so `--dry-run` never calls apply, prints chosen pack and exact files,
  and exits according to plan state. A normal explicit command applies once and reports
  `created`, `migrated`, or `already-configured` without prompts that would hang an
  unattended bootstrap script.
- [ ] Make `awm sensors init` a compatibility creation alias over the project-sensors
  bootstrap path, and route the sensor step in `awm init` through the same planner and
  applier. Map `--registry-root` to exactly one configured logical registry or reject
  it; no public creation path may call the v2 path-persisting materializer.
- [ ] In e2e, inject a write/rename failure and assert original bytes plus absence of
  temporary files; assert existing assets and every machine/context/package file are
  unchanged. The second successful invocation must produce no byte changes.
- [ ] Document one-time project bootstrap, mode semantics, migration staging, dry-run,
  fixed-machine safety, and the rule that entering another environment never reruns
  bootstrap. Run CMD-BOOTSTRAP-CLI, CMD-BUILD-B, and CMD-FULL-JEST-B to GREEN, then
  commit CLI, tests, and docs.

#### Edge cases

Reject applying a stale plan whose manifest changed after planning by carrying and
rechecking an original-content fingerprint. Create `.awm` only at apply time. Roll back
newly created assets best-effort if the manifest commit fails; never delete preexisting
files. Symlinked destinations, path escapes, non-regular manifests, and concurrent
replacement fail closed.

#### Evidence

CMD-BOOTSTRAP-CLI proves exact command behavior, chosen-pack visibility, atomicity,
asset scope, and byte-identical second execution. Build and full Jest protect package
integration. After publication, migrate a selected project only with the published
package and record before/after Codex, Claude Code, and fixed-machine results in #129.

#### Fallback

If atomicity or stale-plan fencing differs on a supported platform, retain the pure
planner and dry-run but do not expose applying migration on that platform. Record the
platform limitation and amend/revalidate the plan; never downgrade to an unchecked
overwrite.

## Traceability matrix

| Requirements | Owner | Direct tests |
|---|---|---|
| BOOT-07..08 | S1 | `manifest.test.ts`, `materialize.test.ts`, `migrate.test.ts` |
| BOOT-01; BOOT-03; BOOT-05..06 | S2 | `bootstrap.test.ts` |
| PORT-01; BOOT-02; BOOT-04 | S3 | `index.test.ts`, `init.test.ts`, `core/init/steps.test.ts`, `sensor-bootstrap.e2e.test.ts`, `sensor-portability-contract.test.ts` |

