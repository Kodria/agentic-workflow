# Cross-environment sensor portability — Design

**Issue:** [#129](https://github.com/Kodria/agentic-workflow/issues/129)  
**Date:** 2026-08-27  
**Status:** Design proposed after Codex and Claude Code diagnostics  
**Scope:** AWM CLI sensor configuration, resolution, preflight classification, and safe project bootstrap

## Outcome

The same Git project state must produce the same sensor configuration semantics in a
primary checkout, linked worktree, Codex environment, Claude Code environment, or
fixed developer machine. Machine-local registry paths may differ, but they must never
require project repair or create project diffs merely because execution moved to a
different supported environment.

This design separates durable project identity from machine-local resolution. A new
portable manifest identifies a registry logically, while each machine resolves that
identity to its own installed content root. Existing v1 and v2 manifests remain
readable, and v2 absolute paths can be rebound in memory when the recorded path does
not exist.

## Scope boundaries

### In scope

- Portable, project-tracked sensor configuration.
- Backward-compatible reading of existing v1 and v2 manifests.
- A v3 manifest that stores logical registry identity instead of an absolute path.
- One shared project/manifest resolver for `preflight`, `sensors status`, and
  `sensors run`.
- Stable machine-readable modes, reasons, and remedies.
- Explicit representation of native-CI gates and deliberate opt-out.
- One-time, explicit, idempotent project bootstrap and migration.
- Safe staged adoption across fixed machines and ephemeral agent environments.

### Out of scope

- Making an obsolete cached CLI discover commands or schema versions introduced
  after that CLI was published.
- Automatically replacing a globally installed CLI from project commands.
- Weakening sensor or CI quality gates.
- Installing project dependencies or silently disabling sensors.
- Provider-specific Codex or Claude Code configuration branches.
- Automatically editing `AGENTS.md`, `CLAUDE.md`, `CONSTITUTION.md`, registry
  inventory, hooks, or package manifests as part of sensor inspection or migration.

An environment must first execute a currently supported AWM CLI. Existing strict
currentness behavior remains the operational mechanism after cached environments have
been brought onto a version that knows that contract.

## Requirements

### Portable project contract

- **PORT-01:** WHEN AWM writes a portable sensor manifest, THE SYSTEM SHALL persist a
  logical registry identity and SHALL NOT persist an absolute registry path, home
  directory, credential, or secret.
- **PORT-02:** WHEN a supported CLI reads a v1, v2, or v3 sensor manifest, THE SYSTEM
  SHALL parse it according to its declared contract without rewriting it.
- **PORT-03:** WHEN a v2 manifest has a usable `registryRoot`, THE SYSTEM SHALL retain
  the existing source behavior and SHALL NOT rebind or migrate it implicitly.
- **PORT-04:** IF a v2 `registryRoot` does not exist, THEN THE SYSTEM SHALL search the
  locally configured registries for a uniquely compatible source and use that source
  in memory only.
- **PORT-05:** IF no compatible source exists, THEN THE SYSTEM SHALL fail closed with
  `mode=source-unavailable` and a stable reason and remedy.
- **PORT-06:** IF more than one compatible source exists, THEN THE SYSTEM SHALL fail
  closed with `mode=source-ambiguous` and SHALL NOT choose by registry order.
- **PORT-07:** WHEN equivalent project state is opened on supported machines with
  different home or registry paths, THE SYSTEM SHALL select equivalent pack and
  sensor semantics without modifying the project tree.

### Root and manifest selection

- **ROOT-01:** WHEN `preflight`, `sensors status`, or `sensors run` selects sensor
  configuration, THE SYSTEM SHALL use one shared resolver and return the same
  `projectRoot` and `manifestPath` for the same starting CWD.
- **ROOT-02:** WHEN execution begins inside a Git worktree, THE SYSTEM SHALL search
  from the starting CWD toward that worktree's Git root and SHALL NOT cross the Git
  root.
- **ROOT-03:** WHEN multiple manifests exist on that path, THE SYSTEM SHALL select the
  nearest manifest and expose the selected path in diagnostics.
- **ROOT-04:** IF execution begins outside a Git worktree, THEN THE SYSTEM SHALL only
  accept a manifest at the explicit CWD and SHALL NOT adopt configuration from an
  unrelated filesystem ancestor.
- **ROOT-05:** IF `packageRoot` is declared, THEN THE SYSTEM SHALL resolve it beneath
  the selected manifest root and reject traversal or escape.

### Honest modes and diagnostics

- **DIAG-01:** WHEN preflight emits JSON, THE SYSTEM SHALL provide stable `status`,
  `mode`, `reason`, `projectRoot`, `manifestPath`, and structured `remedy` fields.
- **DIAG-02:** IF a manifest exists but is malformed or unsupported, THEN THE SYSTEM
  SHALL report `mode=invalid` and SHALL NOT report `missing` or `NOT_CONFIGURED`.
- **DIAG-03:** IF no declaration exists, THEN THE SYSTEM SHALL report `mode=missing`
  and SHALL NOT infer opt-out, native CI, or sensor readiness.
- **DIAG-04:** WHEN project sensors are configured and all required local tools are
  runnable, THE SYSTEM SHALL report `mode=project-sensors`, `status=ready`, and exit
  zero.
- **DIAG-05:** IF any required sensor source, pack, compatibility contract, command,
  asset, or tool is unavailable or incompatible, THEN THE SYSTEM SHALL report a
  blocking status and SHALL NOT report `ready`.
- **DIAG-06:** WHEN a project declares native CI as its quality authority, THE SYSTEM
  SHALL report `mode=native-gate` distinctly and SHALL NOT return generic preflight
  success.
- **DIAG-07:** WHEN a project declares deliberate opt-out, THE SYSTEM SHALL report
  `mode=opt-out`, `status=ungated`, and SHALL NOT return generic preflight success.
- **DIAG-08:** WHEN a legacy path is rebound in memory, THE SYSTEM SHALL expose that
  fact with a stable reason while preserving the empirically computed sensor verdict.
- **DIAG-09:** WHEN one preflight run inspects a manifest, THE SYSTEM SHALL derive its
  manifest and tool checks from the same parsed result so contradictory claims such
  as `manifest: ok` and `tools: no manifest to check` cannot coexist.

### Bootstrap and migration safety

- **BOOT-01:** WHEN a project has no quality declaration, THE SYSTEM SHALL require an
  explicit bootstrap mode and SHALL NOT guess between `project-sensors`,
  `native-gate`, and `opt-out`.
- **BOOT-02:** WHEN bootstrap creates project sensors, THE SYSTEM SHALL detect and
  display the selected pack before persisting the manifest and declared pack assets.
- **BOOT-03:** WHEN bootstrap declares `native-gate` or `opt-out`, THE SYSTEM SHALL
  require a non-empty versioned reason.
- **BOOT-04:** WHEN bootstrap or migration is run against an already equivalent
  project state, THE SYSTEM SHALL complete successfully without changing bytes on
  disk.
- **BOOT-05:** WHEN `--dry-run` is requested, THE SYSTEM SHALL report the exact planned
  project changes without writing files.
- **BOOT-06:** IF a manifest is invalid, its source is ambiguous, or semantic
  equivalence cannot be proven, THEN THE SYSTEM SHALL stop without replacing the
  existing manifest.
- **BOOT-07:** WHEN a v2 manifest is migrated, THE SYSTEM SHALL preserve pack,
  enabled/disabled choices, commands, assets, timeouts, concurrency, compatibility
  evidence, and `packageRoot` semantics.
- **BOOT-08:** WHEN migration writes a candidate, THE SYSTEM SHALL validate it before
  an atomic replacement and SHALL leave the original intact on validation or write
  failure.
- **BOOT-09:** WHILE inspection, status, run preparation, or preflight executes, THE
  SYSTEM SHALL NOT migrate project files or mutate machine configuration.

### Operational and quality properties

- **NFR-01:** WHEN ordinary preflight or static status resolves a logical registry,
  THE SYSTEM SHALL use local inventory and SHALL NOT add a network request.
- **NFR-02:** WHEN registry resolution is ambiguous or unverifiable, THE SYSTEM SHALL
  fail closed rather than rely on local ordering.
- **NFR-03:** WHEN commands receive invalid paths, schemas, modes, or bootstrap
  options, THE SYSTEM SHALL reject them loudly with bounded, non-secret output.
- **NFR-04:** WHEN the portability suite executes, THE SYSTEM SHALL prove relocation
  using at least two distinct simulated home/registry roots.
- **NFR-05:** WHEN the CLI is tested on Linux, macOS, or Windows, THE SYSTEM SHALL
  preserve equivalent logical resolution without hard-coded platform paths.
- **NFR-06:** WHEN a fixed machine upgrades to the dual-read CLI while retaining its
  existing v2 manifest, THE SYSTEM SHALL preserve its previous runnable result and
  leave the worktree clean.
- **NFR-07:** WHEN the first portability release is published, THE SYSTEM SHALL retain
  rollback compatibility with project v1 and v2 manifests.

## Manifest contracts

### v3 project sensors

```json
{
  "schemaVersion": 3,
  "mode": "project-sensors",
  "pack": "js-ts",
  "source": {
    "registry": "baseline"
  },
  "packageRoot": "cli",
  "sensors": {}
}
```

`source.registry` is a stable name from the AWM registry inventory. The project owns
that logical name; the machine owns its physical `contentRoot`. The runtime resolves
the name locally and verifies that the selected registry provides the declared pack.
The manifest never stores the machine path.

The existing structured sensor entries remain materialized in the project manifest.
The v3 change does not weaken initialized compatibility evidence or replace live
compatibility checks.

### v3 native gate

```json
{
  "schemaVersion": 3,
  "mode": "native-gate",
  "reason": "Release-blocking repository CI is the declared quality authority."
}
```

This is a declaration, not local sensor evidence. It permits an AWM workflow that
explicitly understands `native-gate` to route to remote CI verification. Generic
preflight remains non-zero so scripts cannot mistake the declaration for a local
sensor pass.

### v3 deliberate opt-out

```json
{
  "schemaVersion": 3,
  "mode": "opt-out",
  "reason": "This repository intentionally has no executable quality gate."
}
```

Opt-out is visible and versioned. It is never equivalent to sensor readiness and does
not authorize unattended development that requires a quality gate.

## Shared resolution architecture

### `resolveSensorProject(startCwd)`

One pure resolution boundary serves preflight, status, and run preparation:

1. Validate and normalize `startCwd`.
2. Detect the containing Git worktree root, including `.git` file worktrees.
3. Within a Git worktree, walk from `startCwd` toward the Git root and select the
   nearest `.awm/sensors.json`.
4. Stop at the Git root even if a parent workspace also has `.awm` configuration.
5. Outside Git, inspect only the explicit CWD.
6. Return a structured result containing root, manifest path, existence, and boundary
   type. Do not parse the same file independently in each consumer.

This preserves intentional nested project configuration while making selection
deterministic. Starting from the same directory can no longer cause preflight to
inspect one authority while run adopts another.

### `resolveSensorSource(manifest, projectEvidence)`

Source resolution is schema-aware:

- **v3 `project-sensors`:** resolve the exact logical registry name from local
  inventory, then load the declared pack.
- **v2 with usable absolute provenance:** preserve the current path-bound behavior.
- **v2 with absent provenance path:** enumerate configured registries and retain only
  candidates whose pack structurally contains the manifest's sensor IDs and
  initialized variant IDs. Select only one candidate. Current tool evidence is checked
  later so a legitimate compatibility drift is never mislabeled as source absence.
- **v2 without `registryRoot`:** use the same candidate classification instead of
  silently accepting first-registry order.
- **v1:** retain the existing command-based behavior; no registry migration is
  required for portability.

A v2 rebind is ephemeral. It changes neither `.awm/sensors.json` nor local registry
configuration. A later explicit migration can capture the selected logical name.

## Preflight result contract

The human-readable report remains concise, but JSON exposes an automation contract:

```json
{
  "status": "degraded",
  "mode": "source-unavailable",
  "reason": "registry-not-installed",
  "projectRoot": "/workspace/project",
  "manifestPath": "/workspace/project/.awm/sensors.json",
  "remedy": {
    "code": "install-registry",
    "command": "awm update --yes"
  },
  "checks": []
}
```

The stable status vocabulary is:

| Status | Meaning | Generic exit |
|---|---|---:|
| `ready` | Runnable local project sensors | `0` |
| `degraded` | Configuration or runnable gate failure | non-zero |
| `not_configured` | No project declaration | non-zero |
| `native_gate` | Deliberate external quality authority | non-zero |
| `ungated` | Deliberate opt-out | non-zero |

The stable mode vocabulary is:

- `project-sensors`
- `native-gate`
- `opt-out`
- `missing`
- `invalid`
- `source-unavailable`
- `source-ambiguous`

Reason codes refine a mode without replacing it. Initial required reasons include
`configured-v3`, `legacy-bound`, `legacy-rebound`, `manifest-absent`,
`manifest-malformed`, `schema-unsupported`, `registry-not-installed`,
`pack-not-found`, `multiple-compatible-sources`, `tool-missing`, and
`compatibility-drift`.

An orchestrator may accept `native_gate` only when it routes into a separate flow that
waits for and verifies native CI. It must inspect the structured mode; generic shell
success cannot bypass that obligation.

## Project bootstrap and migration

The explicit project command is:

```bash
awm sensors bootstrap [--mode project-sensors|native-gate|opt-out] [--reason <text>] [--dry-run]
```

This is a one-time project configuration operation, not an environment entry hook.
Its committed output follows the repository into Codex, Claude Code, worktrees, and
fixed machines. Entering a new environment does not rerun bootstrap and does not
rewrite project state.

After Publication B, every public path that creates project sensor configuration uses
this portable writer. `awm sensors init` remains as a compatibility alias for creating
`project-sensors`, and the sensor step inside `awm init` delegates to the same bootstrap
planner/applier. An explicit legacy `--registry-root` is accepted only when it maps to
one configured logical registry identity; otherwise creation fails instead of writing
a machine path. The v2 writer may remain internal for rollback tests, but no public
creation path may emit a new path-bound manifest.

Behavior by current state:

| Current project state | Bootstrap behavior |
|---|---|
| Valid equivalent v3 | Successful no-op |
| Valid v2 with resolvable source | Offer/perform semantic v3 migration |
| Valid portable v1 | Preserve v1 unless explicit migration is supported and requested |
| Missing | Require an explicit `--mode` |
| Invalid | Fail without overwrite |
| Unavailable source | Fail with remedy |
| Ambiguous source | Fail and list bounded candidate identities |

For a new `project-sensors` configuration, bootstrap may materialize the manifest and
pack-declared project assets. For migration, it changes only `.awm/sensors.json`; it
does not reinstall dependencies, rewrite existing assets, or prune project context.

## Fixed-machine preservation

Compatibility is a release gate, not a best-effort promise:

- Merely installing the new CLI cannot modify a project.
- Existing v2 manifests whose absolute source remains usable keep that source.
- Existing fixed-machine results are captured before change and asserted after the
  dual-read implementation.
- No migration is committed in the first portability publication.
- A project migration is considered only after the published dual-reader is verified
  in Codex, Claude Code, and a fixed machine.
- Reverting a migrated project manifest to its prior v2 Git revision remains readable
  by the new CLI.

## Verification matrix

| ID | Fixture / environment | Required evidence |
|---|---|---|
| V-01 | Fixed machine, v2 path valid | Same verdict, selected pack, enabled sensors, and clean tree |
| V-02 | Second machine, v2 path absent, one compatible registry | In-memory `legacy-rebound`, equivalent sensor semantics, clean tree |
| V-03 | v2 path absent, no compatible registry | `source-unavailable`, non-zero, no writes |
| V-04 | v2 path absent, two compatible registries | `source-ambiguous`, non-zero, no order-based selection |
| V-05 | v3 under two distinct HOME/registry roots | Same mode, pack, checks, and verdict; different physical roots stay unpersisted |
| V-06 | Primary checkout and linked worktree at equivalent Git state | Same classification without bootstrap or repair |
| V-07 | Root, nested package, and nested source CWDs | Preflight, status, and run preparation select the same nearest authority |
| V-08 | Parent workspace contains unrelated `.awm` | Resolver stops at Git root |
| V-09 | Valid v1 manifest | Existing behavior retained |
| V-10 | Missing manifest | `missing`, not opt-out or ready |
| V-11 | Malformed or unsupported manifest | `invalid`, not missing |
| V-12 | Native CI declaration | `native_gate`, non-zero generic exit |
| V-13 | Deliberate opt-out | `ungated`, non-zero generic exit |
| V-14 | Missing tool and compatibility drift | Distinct stable reasons, no false ready |
| V-15 | Bootstrap dry run | Exact planned changes, no writes |
| V-16 | Bootstrap applied twice | Second run is byte-for-byte no-op |
| V-17 | Linux, macOS, Windows | Equivalent logical resolution and path containment |
| V-18 | Published package in Codex, Claude Code, fixed machine | Cross-environment evidence from the released artifact, not only source tests |

The relocation fixtures use HOME-A and HOME-B (or equivalent injected AWM homes),
with different absolute registry roots. Tests must write or seed configuration under
one root and consume it under the other; a single temporary home cannot prove
portability.

## Release sequence

### Publication A — dual-reader and runtime portability

- Shared project/manifest resolver.
- v1/v2/v3 parsing.
- v2 in-memory rebind with uniqueness checks.
- Stable preflight modes/reasons/remedies.
- Fixed-machine and dual-home regression matrix.
- No migration of the repository's own v2 manifest.

After publication, validate the packaged CLI in Codex, Claude Code, and one fixed
machine. Existing project files remain unchanged throughout this checkpoint.

### Publication B — explicit project adoption

- Enable/document `awm sensors bootstrap` and v2-to-v3 migration.
- Prove dry-run, atomic write, semantic preservation, and idempotence.
- Migrate selected projects only after their environments use the dual-reader.
- Publish and document cross-environment evidence.

This sequence prevents a project from committing v3 before the compatible reader has
been released and verified. It also lets Publication A solve the immediate v2
cross-machine failure without forcing any project mutation.

## Documentation

Documentation must explain:

- Project configuration is committed once and reused everywhere.
- Machine registry installation and project sensor configuration are separate.
- A new worktree or VM must not bootstrap or rewrite an already configured project.
- How v2 path-bound manifests behave on their original and a different machine.
- How and when to migrate to v3.
- Meanings and automation semantics of every status, mode, reason, and remedy.
- Native-CI and opt-out declarations are not local sensor passes.
- Cached obsolete CLI bootstrap is an operational prerequisite outside #129.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| New schema reaches an old reader | Publish and verify dual-read before any project migration |
| Fixed machine changes source unexpectedly | Preserve usable v2 path; rebind only when absent |
| Two registries provide the same pack | Fail as `source-ambiguous`; never use inventory order |
| Parent workspace contaminates project | Stop shared resolver at Git root |
| Nested manifests remain surprising | Nearest authority is deterministic and reported explicitly |
| Migration changes sensor meaning | Semantic equivalence check before atomic replacement |
| Native CI is mistaken for local quality | Distinct non-zero `native_gate` state |
| Opt-out becomes false green | Distinct non-zero `ungated` state |
| Ordinary preflight gains network latency | Resolve registries locally; currentness stays separate and explicit |

## Acceptance mapping

Issue #129 acceptance is satisfied as follows:

- Primary checkout, worktree, Codex, Claude, native CI, opt-out, and broken tools are
  covered by V-01 through V-18.
- Equivalent checkouts require no manual repair through PORT-04, PORT-07, and ROOT-01.
- Bootstrap idempotence is required by BOOT-04 and V-16.
- Stable machine-readable classification is required by DIAG-01 through DIAG-09.
- False readiness is prohibited by DIAG-05 through DIAG-07.
- Provider neutrality follows from logical registry identity and the shared local
  resolver; there are no Codex- or Claude-specific branches.
- Setup, worktree, ephemeral-environment, fixed-machine, and troubleshooting behavior
  are mandatory documentation outputs.

