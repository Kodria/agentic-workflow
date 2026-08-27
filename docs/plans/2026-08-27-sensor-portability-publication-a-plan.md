# Sensor Portability Publication A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan slice-by-slice. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a dual-read AWM CLI that resolves one sensor authority and one compatible registry source deterministically across fixed machines, worktrees, Codex, and Claude Code without migrating project files.

**Architecture:** Add a shared project-manifest boundary and a schema-aware source resolver, then make status, run, and preflight consume those same results. Parse v3 declarations but keep the repository's own v2 manifest unchanged; a missing v2 path may rebind only to one compatible configured registry and only in memory.

**Tech Stack:** Node.js 22, TypeScript 5.9, Commander 14, Jest 30, Git worktree markers, local AWM registry inventory, Markdown and JSON. No runtime dependency is added.

**Modo de ejecución:** desatendido

---

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-129-sensor-portability-publication-a",
  "requirements": [
    "PORT-02", "PORT-03", "PORT-04", "PORT-05", "PORT-06", "PORT-07",
    "ROOT-01", "ROOT-02", "ROOT-03", "ROOT-04", "ROOT-05",
    "DIAG-01", "DIAG-02", "DIAG-03", "DIAG-04", "DIAG-05", "DIAG-06", "DIAG-07", "DIAG-08", "DIAG-09",
    "BOOT-09",
    "NFR-01", "NFR-02", "NFR-03", "NFR-04", "NFR-05", "NFR-06", "NFR-07"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-08-27-cross-environment-sensor-portability-design.md",
      "locator": "## Requirements",
      "fact": "Approved cross-environment behavior, safety, rollout, and verification contract"
    },
    {
      "id": "SRC-MANIFEST",
      "path": "cli/src/commands/sensors/compatibility/manifest.ts",
      "locator": "export type SensorManifestV2",
      "fact": "Closed v1/v2 parser, durable compatibility evidence, and current absolute provenance validation"
    },
    {
      "id": "SRC-PACK-SOURCE",
      "path": "cli/src/commands/sensors/compatibility/pack-source.ts",
      "locator": "export function resolvePackSource",
      "fact": "Contained regular pack loading currently returns the first configured source"
    },
    {
      "id": "SRC-REGISTRIES",
      "path": "cli/src/core/registries.ts",
      "locator": "export function listRegistries",
      "fact": "Logical registry names map to machine-local content roots"
    },
    {
      "id": "SRC-PROFILE",
      "path": "cli/src/core/profile.ts",
      "locator": "export function findProjectRoot",
      "fact": "Existing upward project-marker search is not sufficient for Git-bounded sensor authority"
    },
    {
      "id": "SRC-STATUS",
      "path": "cli/src/commands/sensors/status.ts",
      "locator": "export async function computeSensorStatus",
      "fact": "Static status currently reads cwd/.awm directly and independently resolves v2 provenance"
    },
    {
      "id": "SRC-RUN",
      "path": "cli/src/commands/sensors/run.ts",
      "locator": "export function findManifestDir",
      "fact": "Run currently walks ancestors with a different boundary from status and preflight"
    },
    {
      "id": "SRC-PREFLIGHT",
      "path": "cli/src/commands/preflight/checks.ts",
      "locator": "export async function preflight",
      "fact": "Preflight independently reads raw manifest and status, allowing contradictory checks"
    }
  ],
  "commands": [
    {
      "id": "CMD-PROJECT-MANIFEST",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/commands/sensors/compatibility/manifest.test.ts", "tests/commands/sensors/project.test.ts"],
      "covers": ["PORT-02", "ROOT-01", "ROOT-02", "ROOT-03", "ROOT-04", "ROOT-05", "DIAG-02", "DIAG-03"]
    },
    {
      "id": "CMD-SOURCE-RESOLUTION",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/commands/sensors/compatibility/source.test.ts"],
      "covers": ["PORT-03", "PORT-04", "PORT-05", "PORT-06", "NFR-01", "NFR-02", "NFR-03"]
    },
    {
      "id": "CMD-CONSUMERS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/commands/sensors/status.test.ts", "tests/commands/sensors/run.test.ts", "tests/commands/sensors/run-is-read-only.test.ts"],
      "covers": ["PORT-07", "DIAG-04", "DIAG-05", "DIAG-08", "BOOT-09", "NFR-06", "NFR-07"]
    },
    {
      "id": "CMD-PREFLIGHT-MODES",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/commands/preflight/preflight.test.ts", "tests/integration/preflight-json-pipe.e2e.test.ts"],
      "covers": ["DIAG-01", "DIAG-06", "DIAG-07", "DIAG-09"]
    },
    {
      "id": "CMD-PORTABILITY-MATRIX",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "tests/integration/sensor-portability.e2e.test.ts", "tests/commands/sensors/status-windows.test.ts", "tests/structural/sensor-portability-contract.test.ts"],
      "covers": ["NFR-04", "NFR-05"]
    },
    {
      "id": "CMD-TYPECHECK-A",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["PORT-02"]
    },
    {
      "id": "CMD-BUILD-A",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "build"],
      "covers": ["NFR-05"]
    },
    {
      "id": "CMD-FULL-JEST-A",
      "program": "npm",
      "args": ["--prefix", "cli", "test"],
      "covers": ["NFR-04", "NFR-05"]
    },
    {
      "id": "CMD-SENSORS-A",
      "program": "awm",
      "args": ["sensors", "run"],
      "covers": ["NFR-06"]
    },
    {
      "id": "CMD-DIFF-A",
      "program": "git",
      "args": ["diff", "--check"],
      "covers": ["BOOT-09"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Parse v3 and resolve one project authority",
      "requirements": ["PORT-02", "ROOT-01", "ROOT-02", "ROOT-03", "ROOT-04", "ROOT-05", "DIAG-02", "DIAG-03"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN", "SRC-MANIFEST", "SRC-PROFILE"],
      "redCommands": ["CMD-PROJECT-MANIFEST"],
      "greenCommands": ["CMD-PROJECT-MANIFEST", "CMD-TYPECHECK-A"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["Git worktree boundaries or v3 union semantics cannot be represented without changing an approved requirement"]
    },
    {
      "id": "S2",
      "title": "Bind logical and legacy registry sources",
      "requirements": ["PORT-03", "PORT-04", "PORT-05", "PORT-06", "NFR-01", "NFR-02", "NFR-03"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-PACK-SOURCE", "SRC-REGISTRIES"],
      "redCommands": ["CMD-SOURCE-RESOLUTION"],
      "greenCommands": ["CMD-SOURCE-RESOLUTION"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["candidate compatibility cannot be proven from pack identity, sensor IDs, and initialized variants"]
    },
    {
      "id": "S3",
      "title": "Unify status and run without project mutation",
      "requirements": ["PORT-07", "DIAG-04", "DIAG-05", "DIAG-08", "BOOT-09", "NFR-06", "NFR-07"],
      "dependsOn": ["S2"],
      "sectionAnchor": "slice-s3",
      "sources": ["SRC-STATUS", "SRC-RUN"],
      "redCommands": ["CMD-CONSUMERS"],
      "greenCommands": ["CMD-CONSUMERS", "CMD-SENSORS-A", "CMD-DIFF-A"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["shared resolution changes the empirical sensor command or fixed-machine v2 verdict"]
    },
    {
      "id": "S4",
      "title": "Expose honest preflight modes and remedies",
      "requirements": ["DIAG-01", "DIAG-06", "DIAG-07", "DIAG-09"],
      "dependsOn": ["S3"],
      "sectionAnchor": "slice-s4",
      "sources": ["SRC-PREFLIGHT"],
      "redCommands": ["CMD-PREFLIGHT-MODES"],
      "greenCommands": ["CMD-PREFLIGHT-MODES"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["legacy human output cannot be preserved while JSON receives stable classification"]
    },
    {
      "id": "S5",
      "title": "Prove dual-home and native-platform portability",
      "requirements": ["NFR-04", "NFR-05"],
      "dependsOn": ["S4"],
      "sectionAnchor": "slice-s5",
      "sources": ["SRC-DESIGN"],
      "redCommands": ["CMD-PORTABILITY-MATRIX"],
      "greenCommands": ["CMD-PORTABILITY-MATRIX", "CMD-BUILD-A", "CMD-FULL-JEST-A"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["a platform-specific filesystem fact is not reproducible in the isolated test matrix"]
    }
  ],
  "closureCommands": ["CMD-PROJECT-MANIFEST", "CMD-SOURCE-RESOLUTION", "CMD-CONSUMERS", "CMD-PREFLIGHT-MODES", "CMD-PORTABILITY-MATRIX", "CMD-TYPECHECK-A", "CMD-BUILD-A", "CMD-FULL-JEST-A", "CMD-SENSORS-A", "CMD-DIFF-A"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

## Delivery boundary

- Base execution on updated `origin/main`, not the currently divergent local `main`.
- Modify only the CLI repository. Do not update the baseline registry, global npm
  installation, machine registry inventory, project dependencies, hooks, context
  files, or the repository's tracked `.awm/sensors.json`.
- This plan is serial because every slice consumes types and behavior introduced by
  the prior slice.
- Publication B is blocked until Publication A is merged, published, and exercised as
  a packaged CLI in Codex, Claude Code, and one fixed machine.

## Requirements owned by Publication A

This plan owns PORT-02 through PORT-07, ROOT-01 through ROOT-05, DIAG-01 through
DIAG-09, BOOT-09, and NFR-01 through NFR-07 from the approved design. PORT-01 and
BOOT-01 through BOOT-08 are owned by Publication B. The requirement text in
`SRC-DESIGN` is authoritative; the slice manifest above assigns every owned ID to
exactly one implementation owner and command.

## File structure

| File | Responsibility |
|---|---|
| `cli/src/commands/sensors/project.ts` | Git-bounded manifest selection, one parse, package-root containment, and structured missing/invalid/configured result. |
| `cli/src/commands/sensors/compatibility/manifest.ts` | Closed v1/v2/v3 manifest union and serializers retained for v2. |
| `cli/src/commands/sensors/compatibility/pack-source.ts` | Enumerate safe pack candidates without first-match authority. |
| `cli/src/commands/sensors/compatibility/source.ts` | Logical v3 binding plus v2 bound/rebound/unavailable/ambiguous classification. |
| `cli/src/commands/sensors/status.ts` | Static checks over the shared project/source result. |
| `cli/src/commands/sensors/run.ts` | Empirical preparation over the same selected authority; remove private ancestor search. |
| `cli/src/commands/sensors/types.ts` | Stable readiness, mode, reason, remedy, root, and manifest-path types. |
| `cli/src/commands/preflight/checks.ts` | Compose one parsed readiness result; no raw/strict split. |
| `cli/src/commands/preflight/index.ts` | Render new modes while preserving complete JSON and semantic exit behavior. |
| `cli/tests/commands/sensors/project.test.ts` | Git boundary, worktree marker, nearest manifest, non-Git exact CWD, invalid/missing, and package containment. |
| `cli/tests/commands/sensors/compatibility/source.test.ts` | Logical source, valid v2 path, unique rebind, unavailable, ambiguity, and bounded errors. |
| Existing status/run/preflight tests | Consumer parity, no mutation, fixed v2 behavior, modes, reasons, remedies, and exit codes. |
| `cli/tests/integration/sensor-portability.e2e.test.ts` | HOME-A/HOME-B relocation and equivalent checkout/worktree fixture. |
| `cli/tests/structural/sensor-portability-contract.test.ts` | Documentation vocabulary and no absolute v3 provenance examples. |
| `docs/cli-reference.md`, `docs/configuration.md`, `docs/testing/os-matrix.md` | Publication A behavior and operational boundary. |

## Slice execution contract

Each slice follows RED, minimal implementation, GREEN, specification review, code-
quality review, remediation, and one focused commit. Do not migrate the repository's
manifest while dogfooding this plan. If a declared source is insufficient, amend and
revalidate this plan before giving an executor broader repository context.

<a id="slice-s1"></a>
### Slice S1: Parse v3 and resolve one project authority

#### Surfaces

Create `cli/src/commands/sensors/project.ts` and
`cli/tests/commands/sensors/project.test.ts`. Modify
`cli/src/commands/sensors/compatibility/manifest.ts` and its parser tests. Own
PORT-02, ROOT-01 through ROOT-05, DIAG-02, and DIAG-03.

#### Implementation

- [ ] Add RED parser cases for all three v3 modes, unknown fields, absent reason,
  invalid registry ID, and unsupported schema. The parsed union must expose
  `kind: 'v3'` with `mode: 'project-sensors' | 'native-gate' | 'opt-out'`; only
  project sensors carry `pack`, `source.registry`, optional `packageRoot`, sensors,
  and concurrency.
- [ ] Add RED project-resolution cases using real temporary `.git` directories and
  `.git` files: root manifest, nearest nested manifest, `cli/src` walk-up, unrelated
  parent `.awm`, non-Git exact CWD, malformed manifest, absent manifest, and escaping
  `packageRoot`. Run CMD-PROJECT-MANIFEST and record failures against absent v3/project
  APIs.
- [ ] Implement the v3 discriminated types and exact-field parser in `manifest.ts`.
  Reuse the existing stable ID, contained asset, sensor, and compatibility parsers;
  do not loosen v1/v2 validation. `ParsedSensorManifest` becomes a three-kind union.
- [ ] Implement `resolveSensorProject(startCwd)` returning a closed union with
  `state`, canonical `projectRoot`, `manifestPath`, selected parsed manifest, and
  contained `packageRoot` when configured. A Git marker bounds upward search; outside
  Git, inspect only `path.resolve(startCwd)/.awm/sensors.json`.
- [ ] Run CMD-PROJECT-MANIFEST and CMD-TYPECHECK-A to GREEN, then commit parser and
  project-boundary files together.

#### Edge cases

Reject empty/non-directory CWD, symlinked or non-regular manifests, invalid UTF-8 or
JSON, unknown schema, package-root traversal, a missing package-root directory, and a
parent manifest above `.git`. A manifest that exists but cannot parse is `invalid`,
never `missing`. A `.git` regular file counts as a worktree boundary.

#### Evidence

CMD-PROJECT-MANIFEST verifies every owned requirement with focused assertions for the
returned state, selected paths, parser kind, and no parent escape. The reviewer checks
that source parsing occurs once and consumers receive the parsed value rather than
reopening the file.

#### Fallback

Use full design and parser context if Git-boundary detection or the closed v3 union
cannot be implemented without changing approved semantics. Amend the design instead
of adopting `git rev-parse` subprocesses or filesystem-root search silently.

<a id="slice-s2"></a>
### Slice S2: Bind logical and legacy registry sources

#### Surfaces

Create `cli/src/commands/sensors/compatibility/source.ts` and its focused test. Modify
`pack-source.ts` to enumerate contained candidates while preserving the existing
single-source API for unaffected consumers. Own PORT-03 through PORT-06 and NFR-01
through NFR-03.

#### Implementation

- [ ] Add RED tests around an injected registry inventory for: v3 exact logical name,
  missing logical registry, pack absent, v2 path present, v2 path absent with one
  candidate, zero candidates, two compatible candidates, unsafe pack content, and
  invalid public input. Assert no fetch, Git command, or write primitive is called.
- [ ] Define `SensorSourceResolution` with resolved variants `logical`,
  `legacy-bound`, and `legacy-rebound`, plus `source-unavailable` and
  `source-ambiguous`. Include bounded logical candidate identities, never physical
  roots in user-facing reasons.
- [ ] Add `listPackSources(pack, registries)` using the existing lstat, size,
  realpath, containment, and regular-file checks. An unsafe claimed candidate is a
  hard failure; absence is not.
- [ ] Implement `resolveSensorSource(manifest, deps)`.
  `project-sensors` v3 resolves exactly `source.registry`; v2 uses an existing
  provenance path unchanged. Only when the path is absent does v2 enumerate sources,
  parse v2 packs, and retain candidates structurally containing every materialized
  sensor ID and initialized `variantId`; choose only a unique candidate. Do not use
  current tool evidence here: live compatibility drift remains a later status verdict.
- [ ] Run CMD-SOURCE-RESOLUTION to GREEN and commit source enumeration and binding.

#### Edge cases

Do not fall back from an existing but unsafe/corrupt v2 provenance path. Do not use
registry inventory order to break ties. Disabled sensors remain part of semantic
matching because their configured identity must survive migration. Bound candidate
lists and strip machine paths and remotes containing credentials from diagnostics.

#### Amendment A — content-identity race contract (owner approved 2026-08-27)

The portable Node implementation cannot atomically retain every parent-directory
topology through a concurrent filesystem mutation. S2 therefore protects the
authority that affects users: it must never read a different or escaping pack content
after inspection. It walks observable components with `lstat`, rejects observable
symlinks, validates canonical containment, opens the final `pack.json` with
`O_NOFOLLOW` where Node exposes it, and otherwise opens only the previously inspected
final file before comparing its exact `bigint` `dev` + `ino`, regular-file type, and size to the
inspection. A changed or unobservable identity fails closed. This Windows fallback is
the portable form of the same content-authority guarantee, not a relaxed symlink rule. A
parent swapped to a symlink that still resolves to that same inspected inode has no
content-authority impact and is accepted; this narrowly does not relax the explicit
symlink rejection for copied or archived registry trees. Add a regression that proves
the same-inode race retains only the inspected content, alongside the existing
different-identity rejection. This is a recorded plan deviation for the S2 review
finding; no runtime dependency or platform-specific native layer is introduced.

#### Evidence

CMD-SOURCE-RESOLUTION proves bound-path preservation, dual-home rebind, zero/multiple
candidate failure, local-only resolution, and loud input validation. Reviewers compare
the compatibility predicate directly with PORT-04 and ensure it does not run project
commands or compatibility probes.

#### Fallback

Use full pack-contract, discovery, and initialized-evidence context if static candidate
matching cannot prove uniqueness. Do not weaken the predicate or pick the first source;
amend and revalidate the plan if another durable identity is required.

<a id="slice-s3"></a>
### Slice S3: Unify status and run without project mutation

#### Surfaces

Modify `status.ts`, `run.ts`, `types.ts`, their focused tests, and
`run-is-read-only.test.ts`. Remove `findManifestDir` after all consumers use
`resolveSensorProject`. Own PORT-07, DIAG-04, DIAG-05, DIAG-08, BOOT-09, NFR-06,
and NFR-07.

#### Implementation

- [ ] Add RED tests proving status and run preparation select the same manifest from
  root and nested CWDs; a fixed v2 valid path keeps its verdict; HOME-A provenance
  consumed under HOME-B uniquely rebounds without file changes; missing tools and
  compatibility drift remain distinct failures; v1 remains unchanged.
- [ ] Extend `SensorStatusResult` with stable mode/reason/root/manifest/remedy data
  while retaining `overall`, `pack`, and checks for compatibility. Add the same
  selected-authority metadata to non-certified run output without changing successful
  sensor result semantics.
- [ ] Refactor static v2 compatibility and live compatibility to receive the resolved
  `PackSource`/registry root from S2 instead of reconstructing provenance independently.
  Preserve package-root execution and existing probe boundaries.
- [ ] Refactor status and run to consume `resolveSensorProject` then
  `resolveSensorSource`. Native-gate and opt-out never dispatch sensors; missing,
  invalid, unavailable, and ambiguous states return fail-closed diagnostics.
- [ ] Assert byte-for-byte snapshots of the manifest and registry inventory before and
  after status and run preparation. Run CMD-CONSUMERS, CMD-SENSORS-A, and CMD-DIFF-A
  to GREEN, then commit consumer convergence.

#### Edge cases

Zero sensors cannot become READY. Disabled sensors remain skipped, not failed. A
rebound source may be ready only after ordinary static/live compatibility and tool
checks pass; the rebind itself is not certification. Run parse/source failures remain
`not_certified`, never empty pass. Existing v1 shell semantics do not enter the v2/v3
source resolver.

#### Evidence

CMD-CONSUMERS proves equivalent selection, fixed-machine preservation, no mutation,
legacy support, and honest failure. CMD-SENSORS-A is empirical project evidence after
the focused suite, and CMD-DIFF-A catches accidental writes to tracked files.

#### Fallback

Use full status/run/preparation context if sharing the resolver changes an empirical
command or formatter. Retain all existing quality tests; revert only the refactor and
amend the boundary rather than duplicating manifest selection again.

<a id="slice-s4"></a>
### Slice S4: Expose honest preflight modes and remedies

#### Surfaces

Modify `preflight/checks.ts`, `preflight/index.ts`, preflight unit tests, and the JSON
pipe integration test. Own DIAG-01, DIAG-06, DIAG-07, and DIAG-09.

#### Implementation

- [ ] Add RED cases for every mode and stable reason, structured remedy, selected
  paths, native-gate, opt-out, malformed manifest, and the Claude 8.1.5 symptom where
  raw manifest inspection and strict parsing previously contradicted each other.
- [ ] Change preflight to call the shared project/status inspection once. Build
  manifest, tools, pack, and baseline checks from that one result; never reopen the
  manifest through a tolerant raw reader.
- [ ] Extend `PreflightReport.status` with `native_gate` and `ungated`, and expose the
  stable top-level mode/reason/root/manifest/remedy contract. Preserve exit zero only
  for runnable `ready`; all other states remain non-zero.
- [ ] Keep `--require-current` and `--verify-sensors` orthogonal. Native-gate can be
  consumed only by a JSON-aware external-CI workflow; generic preflight never turns it
  green. Render bounded human remedies without leaking physical registry paths.
- [ ] Run CMD-PREFLIGHT-MODES to GREEN and commit preflight composition and rendering.

#### Edge cases

JSON must flush fully on non-zero exit. A present unsupported schema is invalid. Native
gate and opt-out require non-empty reasons but no sensor fields. A tools check cannot
claim no manifest after the manifest check accepted one. Currentness transport errors
do not overwrite sensor mode/reason.

#### Evidence

CMD-PREFLIGHT-MODES asserts exact JSON fields, exit codes, contradictory-check
elimination, and native/opt-out safety. Specification review checks every reason and
remedy against the design vocabulary; code-quality review checks bounded output and
single parsing.

#### Fallback

Use full preflight/currentness context if preserving strict currentness composition
requires additional report fields. Do not collapse new modes back into ready or
not-configured; amend the schema deliberately if a compatibility alias is required.

<a id="slice-s5"></a>
### Slice S5: Prove dual-home and native-platform portability

#### Surfaces

Create the integration and structural contract tests. Modify `docs/cli-reference.md`,
`docs/configuration.md`, and `docs/testing/os-matrix.md`. Own NFR-04 and NFR-05.

#### Implementation

- [ ] Add a RED e2e fixture that seeds HOME-A with registry `baseline`, writes a v2
  manifest containing HOME-A's absolute root, then consumes the unchanged project
  under HOME-B where the same logical registry has a different root. Assert equivalent
  mode, pack, sensors, and verdict plus a clean project tree.
- [ ] Add RED cases for a linked-worktree `.git` file, unrelated parent `.awm`, POSIX
  paths, mocked native-Windows path semantics, and v3 examples containing no absolute
  provenance.
- [ ] Document project-once/machine-local resolution, v2 bound/rebound behavior,
  statuses and exits, the no-bootstrap-on-entry rule, and the staged Publication B
  migration. Explicitly state that obsolete cached CLI bootstrap is outside #129.
- [ ] Run CMD-PORTABILITY-MATRIX, CMD-BUILD-A, and CMD-FULL-JEST-A to GREEN. Run the
  existing repository CI matrix through the PR, then commit tests and documentation.

#### Edge cases

The fixture must use two distinct AWM homes, not two directories under one frozen
module-level home. Restore environment variables after every case. Never execute
network calls or mutate the real user home. Windows tests must cover drive/UNC input
rejection where applicable without assuming POSIX separators.

#### Evidence

CMD-PORTABILITY-MATRIX directly proves dual-home and platform requirements. Build and
full Jest protect package/runtime integration. After merge and npm publication, record
packaged-CLI preflight/status evidence from Codex, Claude Code, and one fixed machine
in issue #129 before Publication B begins.

#### Fallback

If a native filesystem condition cannot be simulated faithfully, retain unit coverage
and require the existing real OS CI matrix as full-context evidence. Record the exact
unobservable condition; do not infer platform equivalence from Linux alone.

## Publication B entry gate

Do not begin the migration/bootstrap plan until all of the following are recorded in
issue #129:

- Publication A merge SHA and npm `gitHead` match.
- The installed published CLI reports the expected new version in Codex, Claude Code,
  and one fixed machine.
- The same unchanged v2 project state is `legacy-bound` on its original machine or
  `legacy-rebound` on a different machine as appropriate, with equivalent sensor
  semantics and no project diff.
- The repository remains on its v2 manifest throughout this checkpoint.

## Traceability matrix

| Requirements | Owner | Direct tests |
|---|---|---|
| PORT-02; ROOT-01..05; DIAG-02..03 | S1 | `manifest.test.ts`, `project.test.ts` |
| PORT-03..06; NFR-01..03 | S2 | `source.test.ts` |
| PORT-07; DIAG-04..05; DIAG-08; BOOT-09; NFR-06..07 | S3 | `status.test.ts`, `run.test.ts`, `run-is-read-only.test.ts` |
| DIAG-01; DIAG-06..07; DIAG-09 | S4 | `preflight.test.ts`, `preflight-json-pipe.e2e.test.ts` |
| NFR-04..05 | S5 | `sensor-portability.e2e.test.ts`, `status-windows.test.ts`, `sensor-portability-contract.test.ts` |
