# Retire the inert `onSignal` bundle contract

**Issue:** #112

## Requirements

- **R1:** THE bundle model SHALL represent skill membership with canonical skill names only, without an operational `onSignal` property.
- **R2:** WHEN AWM reads a legacy bundle skill object with a valid `name`, THE bundle discovery boundary SHALL preserve that skill membership and SHALL report one bounded, actionable deprecation diagnostic per affected manifest.
- **R3:** IF a bundle skill entry is neither a valid canonical string nor a supported legacy object, THEN THE bundle discovery boundary SHALL reject it with an error that identifies the manifest without interpreting the entry as a skill.
- **R4:** WHEN a canonical bundle and an equivalent legacy bundle are resolved, installed, exported, reconciled, or diagnosed, THE system SHALL produce the same artifact membership for every supported provider.
- **R5:** WHEN AWM-owned registries are migrated, THE registries SHALL contain no `onSignal` bundle metadata and SHALL preserve their existing ordered skill membership.
- **R6:** THE active registry-authoring documentation SHALL describe string skill references as canonical and SHALL state that legacy object references are accepted only through the current major compatibility window.
- **R7:** WHEN the next CLI major removes the compatibility window, THE current change SHALL leave an explicit, discoverable removal marker without claiming that removal has already shipped.
- **R8:** THE change SHALL pass the repository's Linux checks and the existing injected Windows/macOS provider and path matrices; native Windows CI SHALL remain the authoritative Windows execution gate.

## Context and decision

`BundleSkillRef.onSignal` is parsed but no production path consumes it. Resolution,
installation, export, reconciliation, grouping, and diagnostics use only the skill
name. The original phase plan explicitly deferred SessionStart annotation and left
the field persisted as data. Provider adapters subsequently converged on their own
activation mechanisms: linked skills are discovered natively, Cursor emits every
skill as agent-requested, and Copilot has no equivalent semantic trigger.

The accepted decision is to retire the field rather than invent provider-specific
behavior. Skill activation remains the responsibility of each `SKILL.md` description,
the `using-awm` tier policy, and the provider runtime. A future dynamic skill broker,
if justified, would need a new typed contract; a boolean without a signal definition,
lifetime, or evaluator is not retained as its foundation.

## Considered approaches

### 1. Staged retirement — selected

Use strings as the internal and authored representation. Continue accepting the
published object form for the remainder of CLI major 9, reduce it immediately to its
`name`, and surface a deprecation diagnostic. Migrate AWM-owned registries now. This
removes the false operational contract while preserving private registries during a
bounded compatibility window.

### 2. Immediate rejection

Reject object references in the current release. This is the smallest final-state
implementation but creates an unnecessary breaking change for private registries in
a minor release. It is deferred to the next major.

### 3. Implement `onSignal`

Use the field to annotate session context or filter installed skills. This was
rejected because annotation does not reduce native provider rosters, filtering makes
the skill unavailable when the signal occurs, and provider activation capabilities
do not share a portable mapping.

## Design

### Canonical model and compatibility boundary

`BundleDefinition.skills` becomes an ordered array of skill names. All downstream
consumers operate directly on strings, making it impossible for inert activation
metadata to leak into an operational type.

Bundle manifest parsing remains the single compatibility boundary. It accepts:

- a non-empty string as the canonical representation; or
- a legacy object with a non-empty string `name`, for CLI 9 compatibility only.

The supported legacy shape has exactly `name` and an optional boolean `onSignal`;
unknown keys, empty names, and non-boolean `onSignal` values fail loudly at the
manifest boundary instead of being dropped. The `onSignal` value has no effect and
is not retained. Existing safe artifact-name validation remains in force before any
filesystem plan is built.

### Diagnostics

Parsing returns bundle definitions and diagnostics as separate data. A manifest with
one or more legacy object references produces one diagnostic containing the safe
manifest identity, the number of references, the canonical replacement, and the
planned removal boundary (`v10`). It never echoes untrusted object contents.

Discovery composition deduplicates diagnostics by manifest. Every user-facing command
that discovers bundles receives the same structured discovery result and emits each
diagnostic once through the existing stderr convention; pure resolvers and installers
receive canonical definitions and do not print. This keeps parsing deterministic and
prevents repeated warnings when a command performs more than one discovery pass.

### Registry migration

The baseline `dev` bundle replaces its ten object references with strings in the same
order. Its bundle and catalog versions advance together according to the registry's
release contract. Before opening the registry PR, repository-wide search must prove
that no active AWM-owned bundle manifest still contains `onSignal`.

The CLI and baseline changes ship as separate PRs because they have independent test
suites and release histories. They are order-independent: existing CLI versions
already accept canonical strings, while the new CLI accepts both the old baseline and
the migrated one. The CLI PR references the baseline PR and #112 so the issue is not
considered complete until both are merge-ready.

The CLI authoring guide and active operational documentation identify string entries
as canonical and document the compatibility window. Historical plans remain unchanged
as historical evidence. A versioned removal marker records the v10 follow-up without
pretending it belongs to this v9 change.

### Provider behavior

No renderer, hook, context strategy, or provider capability changes. Canonicalization
happens before artifact planning, so Antigravity, OpenCode, Claude Code, Codex, Cursor,
and Copilot receive exactly the same skill set and order as before. Tests compare
canonical and legacy input through resolution and installation, including injected
Windows path/provider cases where relevant.

## Error handling and robustness

- Manifest JSON and container validation remains fail-closed.
- Empty names and unsupported skill-entry shapes are explicit errors.
- Diagnostics are bounded and do not reproduce attacker-controlled serialized data.
- Compatibility accepts only the known legacy shape; it does not silently bless new
  metadata fields as operational behavior.
- The parser performs no console I/O and no filesystem mutation.

## Verification

TDD will add failing tests before changing production code. Coverage must prove:

1. canonical strings produce canonical model values;
2. legacy objects preserve names, discard `onSignal`, and emit one diagnostic;
3. malformed entries fail loudly;
4. canonical and legacy bundles resolve and install identically;
5. all consumers compile after the model is simplified;
6. active documentation and AWM-owned registries contain no operative `onSignal` use;
7. typecheck, lint, dependency checks, full Jest, sensors, and CI platform gates pass.

## Scope

Included: CLI model/parser/consumers/tests, active authoring documentation, baseline
registry migration, compatibility diagnostics, and an explicit v10 removal marker.

Excluded: dynamic skill loading, changes to provider-native discovery, renderer or
hook changes, modification of historical plans, and immediate rejection of legacy
objects in CLI 9.

## UI Screens

None. This is a CLI contract and registry migration.
