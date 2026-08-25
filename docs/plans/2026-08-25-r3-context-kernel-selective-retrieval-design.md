# R3 Context Kernel and Selective Retrieval — Design

**Status:** Proposed — all design sections approved; written artifact pending final owner approval

**Source brief:** [`2026-08-25-performance-tokens-brief.md`](./2026-08-25-performance-tokens-brief.md)

**Trace:** [agentic-workflow#126](https://github.com/Kodria/agentic-workflow/issues/126)

**Prior release:** baseline registry `v3.8.0` / `6ef3a79` (R2 stable role
prefixes and `Evidence Capsule v1`). R2 reduced the frozen real R1 initial-dispatch
corpus from 718,231 to 389,864 bytes (45.72% structural reduction) without removing
quality roles. Provider tokens, cache and billed cost remain unobservable.

## Purpose

R3 reduces the project context supplied to every agent session. Instead of loading all
of `AGENTS.md` and `CONSTITUTION.md` as an ever-growing rule archive, each project keeps
a small protected context kernel and a committed index of authoritative context cards.
Each role retrieves only the cards justified by its task, inside the same model
invocation, and falls back to the current full-context path whenever selection or
evidence is uncertain.

Reduction is obtained by moving repeated feedforward bytes out of the unconditional
session prefix, not by deleting rules, adding summarization calls, or weakening TDD,
review, QA, sensors, documentation, retro, security, validation, or robustness.

## Owner Decisions

### D-R3-1 — Repository-native retrieval

R3 uses committed Markdown context cards and native repository reads. It does not add a
retrieval service, database, provider adapter, daemon, dependency, paid infrastructure,
or model call. A role receives stable IDs and repository-relative paths in its R2
evidence capsule, reads the needed cards with the active runtime's native file tools,
and reports the sources it used.

### D-R3-2 — Pruning cannot erase the kernel

The current `harness-retro` contract says to merge and prune `AGENTS.md` and
`CONSTITUTION.md` after context growth. R3 replaces free-form pruning for migrated
projects with a protected migration contract:

- root kernel regions use versioned start/end markers and stable rule IDs;
- `harness-retro` cannot modify or prune protected regions;
- new process and agent lessons go to indexed cards;
- maintenance compares the complete rule-ID inventory before and after a change;
- removing an ID requires explicit owner approval and a recorded reason;
- a budget threshold can request maintenance, but never authorizes deletion;
- malformed markers, missing IDs, dangling cards, or unsafe paths fail validation and
  select full-context fallback.

The first migration is stricter because legacy prose has no IDs: it must commit a
complete trace table from each existing normative rule to its retained kernel or card
location before the old prose can be reduced.

### D-R3-3 — Preflight makes migration visible

R3 cannot depend on every customer remembering to invoke a skill. The active registry
declares `projectContextSchema: 1` in `awm-registry.json`; a compatible CLI then adds a
`context-kernel` row to every `awm preflight` result.

The row has three distinct outcomes:

| Project state | Preflight row | Overall result | Runtime behavior |
|---|---|---|---|
| Valid Context Kernel v1 | pass | unchanged | selective context eligible |
| No R3 metadata | persistent advisory | `ready` if all blocking checks pass | safe legacy full context |
| Partial or invalid migration | failure | `degraded` | no unattended handoff; full-context safety path |

The legacy advisory is deliberately non-blocking: existing projects remain backward
compatible and quality-safe. It is visibly rendered with a warning glyph and remedy on
every preflight until migration, rather than disguised as a green pass. The
`writing-plans` gate must surface and record whether the owner migrates now or continues
that cycle on legacy full context.

`awm update` never rewrites project-owned `AGENTS.md`, `CONSTITUTION.md`, the index, or
cards. Migration is always explicit and reviewed.

## Specialist Verdicts

- **Architecture (`architecture-advisor`, contextual): significant.** Use a
  repository-native kernel/index/card boundary with fail-closed fallback. The
  preflight detector and registry declaration form one versioned compatibility
  contract; semantic content remains owned by registry skills, not the CLI.
- **Technology (`technology-evaluator`, contextual): trivial.** Reuse TypeScript,
  JSON, Markdown, Git, and native agent file reads. No new technology or dependency is
  justified.
- **NFR (`nfr-checklist-generator`, contextual): significant.** Define now:
  integrity of rule inventory, path containment, symlink safety, bounded retrieval,
  deterministic validation, provider parity, backward compatibility, structural
  measurement, and honest fallback. Provider billing and adaptive review remain later
  concerns.

## Requirements

- **R3.1** — WHEN an active registry declares `projectContextSchema: 1`, THE CLI SHALL
  add a `context-kernel` check to `awm preflight`; WHEN the field is absent, THE CLI
  SHALL preserve the pre-R3 report without claiming that migration is available.
- **R3.2** — WHEN a project has no Context Kernel v1 index, THE preflight check SHALL
  render a persistent advisory with an actionable migration remedy, SHALL preserve an
  otherwise `ready` overall verdict, and SHALL identify the active behavior as legacy
  full context.
- **R3.3** — IF any Context Kernel v1 artifact is present but its schema, markers,
  required fields, IDs, paths, anchors, or files are invalid, THEN preflight SHALL fail
  the check, report `degraded`, and SHALL NOT permit unattended handoff.
- **R3.4** — WHEN a project completes migration, THE root kernel SHALL contain exactly
  one valid versioned protected region in each declared kernel file and SHALL retain a
  stable ID for every unconditional rule.
- **R3.5** — WHEN legacy context is migrated for the first time, THE migration process
  SHALL map every pre-migration normative rule to exactly one retained kernel or
  selective-card entry before reducing the legacy source text.
- **R3.6** — WHEN context maintenance reorganizes or deduplicates a migrated project,
  THE process SHALL preserve the complete pre-change rule-ID set; IF an ID is removed,
  THEN explicit owner approval and its reason SHALL be recorded before the change.
- **R3.7** — WHEN `harness-retro` cures a process rule, agent lesson, or win in a
  migrated project, THE skill SHALL update an applicable context card and index entry
  and SHALL NOT modify the protected kernel region automatically.
- **R3.8** — WHEN the context budget exceeds its reviewed threshold, THE planning gate
  SHALL offer controlled kernel maintenance while the owner is present; THE threshold
  SHALL NOT itself authorize pruning or deletion.
- **R3.9** — WHEN a controller assembles an R2 evidence capsule for a migrated project,
  THE capsule SHALL initially provide only applicable context IDs, repository-relative
  paths, anchors, and role evidence, excluding complete context cards by default.
- **R3.10** — IF a role needs indexed evidence absent from its initial capsule, THEN THE
  role SHALL perform at most one native retrieval batch inside the same invocation and
  SHALL report each ID, source, reason, and result in retrieval history.
- **R3.11** — IF a role needs a second retrieval batch, an indexed source is missing or
  invalid, selection is uncertain, or work affects security, robustness, root
  configuration, a public contract, or uncertain cross-cutting behavior, THEN THE
  controller SHALL select visible `full-context` fallback.
- **R3.12** — WHEN a project is legacy or Context Kernel v1 is unavailable, THE workflow
  SHALL preserve the current full-context behavior and every existing quality gate
  without requiring migration.
- **R3.13** — THE same kernel, retrieval-history, and fallback contract SHALL govern
  Codex and Claude Code; provider capabilities SHALL NOT remove required evidence or
  change quality outcomes.
- **R3.14** — WHEN R3 is evaluated against the frozen real project corpus, THE candidate
  unconditional `AGENTS.md` + `CONSTITUTION.md` + `CLAUDE.md` bytes SHALL be at most
  33,740 compared with the 67,481-byte baseline, while every source rule remains
  traceable to a kernel or card ID.
- **R3.15** — THE R3 selection, validation, retrieval, and measurement path SHALL add no
  model-only invocation, dependency, prompt store, source-body store, secret store, or
  unrestricted response store.
- **R3.16** — WHEN a release checkpoint closes, THE initiative SHALL link exact
  structural bytes, dispatches, natural retrievals and fallbacks, quality outcomes,
  commits, releases and PRs from issue #126; unavailable provider usage SHALL remain
  `unobservable`, and structural reduction SHALL NOT be described as billed-token or
  cost savings.

## Context Kernel v1 Contract

### Project artifacts

| Artifact | Responsibility |
|---|---|
| `AGENTS.md` | Small project/operator kernel plus the protected retrieval contract; not a historical lesson archive. |
| `CONSTITUTION.md` | Small non-negotiable process/security/robustness kernel; not detailed forensic narrative. |
| `CLAUDE.md` | Existing provider-specific context, still counted in the fixed-byte ceiling but not rewritten by R3 migration unless explicitly selected by its owner. |
| `.awm/context/index.json` | Schema, kernel files and indexed rule locations; committed and machine-validated. |
| `docs/awm/context/*.md` | Authoritative cards containing selectively retrieved project rules and lessons. |
| `docs/awm/context/migration-v1.md` | Initial legacy-rule trace table; required for first migration, retained for audit. |

### Index shape

The implementation plan will pin this logical shape in executable TypeScript types and
tests. Field names below are normative; extra unknown fields are rejected so malformed
or newer schemas do not silently degrade:

```json
{
  "schema": 1,
  "kernelFiles": ["AGENTS.md", "CONSTITUTION.md"],
  "maxFixedBytes": 33740,
  "entries": [
    {
      "id": "CTX-PROCESS-001",
      "tier": "kernel",
      "path": "CONSTITUTION.md",
      "anchor": "awm-context:CTX-PROCESS-001",
      "when": "always"
    },
    {
      "id": "CTX-RELEASE-001",
      "tier": "selective",
      "path": "docs/awm/context/releases.md",
      "anchor": "awm-context:CTX-RELEASE-001",
      "when": "release automation or files under .github/workflows/"
    }
  ]
}
```

Validation requires:

- `schema` is exactly integer `1`; unknown future versions fail loudly;
- `kernelFiles` is a non-empty unique allowlist of root context files;
- `maxFixedBytes` is a positive finite integer;
- `entries` is a non-empty array with unique bounded IDs;
- `tier` is exactly `kernel` or `selective`;
- `path` is repository-relative, normalized, contained in the project, a regular file,
  and does not traverse an external symlink;
- every `anchor` occurs exactly once in its declared file;
- `kernel` entries point only to a declared kernel file inside protected markers;
- `selective` entries point outside protected root regions;
- `when` is non-empty and bounded; it guides role selection but is not executed as code;
- unknown fields, missing fields, invalid types, duplicate IDs, duplicate anchors, and
  dangling paths are explicit failures.

The CLI is the executable validator and single source of truth for the schema. Registry
skills document and produce that contract; they do not ship a second parser that could
drift from preflight.

### Protected regions

Each declared kernel file has exactly one pair:

```markdown
<!-- AWM:CONTEXT-KERNEL:START v1 -->
... entries containing their `<!-- awm-context:CTX-... -->` anchors ...
<!-- AWM:CONTEXT-KERNEL:END v1 -->
```

The markers are project-owned content, not the existing CLI-managed
`<!-- AWM:START -->` / `<!-- AWM:END -->` injection boundary. R3 never edits or nests
inside the CLI-owned boundary.

## Runtime Flow

1. `awm preflight` reads the active registry's optional project-context declaration.
2. If R3 is active, preflight classifies the project as valid, legacy, or invalid.
3. `writing-plans` surfaces the result before execution handoff. A legacy project may
   proceed only on the explicitly recorded full-context path.
4. For a valid project, the SDD or QA controller matches task surfaces and risk against
   index entries and writes applicable IDs/paths/anchors into `Evidence Capsule v1`.
5. The role reads at most one batch of required cards with native tools during its
   existing invocation and records retrieval history in its compact report.
6. Any R3.11 trigger selects full-context fallback. Retrieval never becomes an
   unbounded redispatch loop.
7. At retro, new durable learning is merged into an existing card or a new card/index
   entry. The protected root kernel is unchanged.
8. At the next planning gate, budget growth can trigger controlled maintenance with the
   owner present and the before/after ID conservation check.

## Components and Delivery Order

R3 is one product release with two ordered technical deliveries because the CLI must
know how to surface migration before the registry activates it.

### R3a — CLI preflight awareness

Primary surfaces:

| Surface | Responsibility |
|---|---|
| `cli/src/core/context-kernel/` | Registry declaration and project index parsing, validation, path containment and state classification. |
| `cli/src/commands/preflight/checks.ts` | Add the conditional `context-kernel` check and preserve blocking/non-blocking semantics. |
| `cli/src/commands/preflight/index.ts` | Render advisory rows distinctly while preserving JSON and exit-code compatibility. |
| `cli/tests/core/context-kernel/` | Schema, path, marker, anchor, symlink, forward-compatibility and mutation cases. |
| `cli/tests/commands/preflight/preflight.test.ts` | Absent declaration, legacy advisory, valid pass and invalid failure behavior. |
| CLI documentation and package version | Document the row and publish the compatible binary through existing protected automation. |

R3a does not activate warnings by itself when the installed registry lacks
`projectContextSchema`.

### R3b — Registry kernel and selective retrieval

Primary surfaces:

| Surface | Responsibility |
|---|---|
| `awm-registry.json` | Declare `projectContextSchema: 1` and the compatible `minCliVersion`. |
| `skills/project-context-init/` | Initial migration, trace inventory, kernel/index/card creation and safe maintenance. |
| `skills/project-constitution/` | Split unconditional non-negotiables from recoverable detail. |
| `skills/harness-retro/` | Cure migrated-project learning into cards; protect root kernel. |
| `skills/writing-plans/` | Surface preflight advisory and offer controlled migration/maintenance. |
| `skills/subagent-driven-development/` | Select context IDs, support one native retrieval batch, record history and fall back. |
| `skills/post-implementation-qa/` | Apply the same contract to Track A and each Track B lens. |
| Canonical reference under one owning skill | Human-facing `Context Kernel v1` creation and consumption contract. |
| Registry contract/mutation tests | Preserve roles, IDs, fallback, legacy behavior, provider parity and exact byte ceiling. |
| `catalog.json`, affected bundles/skills | Required version bumps and protected registry release behavior. |

R3b is blocked until the R3a CLI version is published. Its `minCliVersion` makes an old
CLI fail compatibility before it can install a registry whose preflight declaration it
cannot understand.

## Measurement Ledger

R3 uses existing development boundaries; measurement never dispatches a dedicated
agent or model call.

- **R2 T4 — first normal cycle with R2 installed:** captured during R3a, the first
  eligible implementation cycle after baseline `v3.8.0`. Record actual dispatches,
  natural retrieval/fallback outcomes, quality results, exact context bytes and owner
  quota observation if supplied. Provider tokens/cache/cost remain `unobservable`
  unless natively reported.
- **R3 T0 — before R3a implementation:** freeze the real 67,481-byte project context,
  source rule inventory, active CLI/registry versions and pre-R3 preflight JSON.
- **R3 T1 — R3a published:** record CLI/preflight behavior and development overhead;
  no project-byte saving is claimed because the registry has not activated migration.
- **R3 T2 — R3b candidate reviewed:** compare the frozen legacy corpus with the
  candidate kernel/cards under the same path and byte definition; include all
  corrections, dispatches and natural retrievals/fallbacks.
- **R3 T3 — coordinated release complete:** record both PRs/releases, exact structural
  result, all quality gates, and owner quota observation if supplied.
- **R3 T4 — first normal cycle on installed/migrated R3:** captured during R4 after an
  explicit reviewed migration of `agentic-workflow`. This is the first valid real-cycle
  observation of R3 feedforward behavior; it is not replaced by a synthetic benchmark.

The 67,481 → at most 33,740 byte comparison is structural evidence only. The initiative
does not convert bytes or owner quota percentages into billed tokens or currency.

## Verification Strategy

### R3a CLI

- Table-driven parser tests accept exactly schema 1 and reject malformed, unknown, or
  extra fields without coercion.
- Path tests reject absolute paths, `..`, non-regular files, duplicate paths where
  forbidden, and symlinks that escape the repository.
- Marker/anchor tests require exact cardinality and correct protected-region placement.
- Preflight tests prove registry declaration absent, legacy advisory, valid kernel, and
  partial/invalid migration are distinct outcomes.
- Renderer tests prove advisory is visually distinct while JSON compatibility and
  ready exit code remain intact.
- Mutation tests remove one validator branch or advisory renderer and require a
  targeted failure.
- Existing CLI typecheck, focused/full tests, sensors, and platform CI remain required
  because R3a changes executable CLI behavior.

### R3b registry

- A normative trace test proves every frozen legacy rule maps to one kernel/card ID.
- Contract tests prove `harness-retro` cannot modify protected regions and
  `writing-plans` cannot authorize deletion from a budget threshold.
- Role tests prove initial capsules carry references rather than full cards, one native
  retrieval batch is bounded, and every R3.11 trigger selects full context.
- Legacy tests prove a project without R3 metadata keeps the current full-quality path.
- Provider-parity tests apply identical evidence and fallback obligations to Codex and
  Claude Code.
- Mutation tests delete a marker, ID, index row, card, anchor, role, quality gate, or
  fallback trigger; every mutation must fail with an actionable reason.
- A deterministic test uses the same frozen real corpus and requires at least 50%
  unconditional-byte reduction with no model invocation.
- Existing portability, skill/bundle version, registry validation, release, privacy,
  and role-evidence-capsule gates remain blocking.

## Quality Non-Regression

R3 fails regardless of byte reduction if any of the following occurs:

- a pre-migration normative rule has no retained ID/location;
- a migrated project can report preflight ready while an index/card/kernel artifact is
  partial or invalid;
- a role reaches a verdict after required evidence was unavailable without visible
  full-context fallback;
- a blocker or important defect escapes, a rollback occurs, or a human correction is
  attributable to omitted context;
- any implementation, specification review, code-quality review, Track A, applicable
  Track B, sensor, documentation, retro, or completion obligation is removed;
- Codex and Claude Code differ in required evidence or quality outcome;
- structural bytes fall by less than 50% on the frozen corpus.

## Rollout

1. Implement, verify, merge and publish R3a CLI.
2. Write the published CLI version into R3b `minCliVersion` and activate
   `projectContextSchema: 1`.
3. Implement, verify, merge and publish R3b baseline registry.
4. Install and pin both releases; verify preflight reports the current project as
   legacy with a visible non-blocking migration advisory.
5. Explicitly migrate `agentic-workflow` before R4, review its rule trace and require
   valid preflight. Installation itself never edits the project.
6. Execute R4 as the first normal cycle on migrated R3 and append T4 evidence.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Pruning deletes the new configuration or a rare rule | Protected markers, stable IDs, before/after set equality, first-migration trace and mutation tests. |
| Customers never migrate | Registry-activated persistent preflight advisory plus mandatory planning-gate disclosure. |
| Migration warning blocks safe legacy work | Advisory stays non-blocking and selects the current full-context path. |
| Partial migration looks complete | Any artifact present but invalid is a blocking degraded state. |
| CLI and registry schema drift | CLI is the only parser; registry activation is versioned and guarded by `minCliVersion`. |
| Selective retrieval omits relevant evidence | Explicit risk triggers, one-batch bound, visible history and full-context fallback. |
| Retrieval adds more cost than it saves | Native reads only, exact retrieval bytes recorded at normal boundaries, no retrieval service or model call. |
| Cards become a new append-only archive | Stable IDs, merge-and-prune within cards, planning-time budget review and explicit removal authority. |
| Structural reduction is mistaken for economic savings | Separate exact bytes from unobservable provider usage and owner-reported quota. |

## Out of Scope

- Automatic project-file rewriting during `awm update`, `awm sync`, or installation.
- Provider billing adapters, permanent token telemetry, remote analytics, or prompt
  persistence.
- A semantic classifier, vector database, embedding service, retrieval daemon, or paid
  infrastructure.
- Compact plan behavior and cohesive-slice generation (R4).
- Merging, skipping, or model-routing reviewers (R5).
- Supporting context-card schemas beyond version 1 in this release.
- Claiming billed-token, cost, or initiative-wide savings from byte measurements alone.

## Planning Handoff

`writing-plans` must produce two coordinated executable plans:

1. **R3a CLI preflight awareness** in `agentic-workflow`, including R2 T4 and R3 T0
   before implementation edits.
2. **R3b registry kernel and retrieval** in `awm-baseline-registry`, blocked on the
   published R3a CLI version and carrying the shared R3 ledger through T3.

Each plan should use the smallest cohesive task count supported by its repository while
retaining test-first implementation, independent review, QA, documentation, retro, and
release gates. Neither plan creates measurement-only dispatches. No documentation-only
PR is required for this design artifact; issue #126 remains the cross-session baton
until a concrete technical PR exists.
