# Issue #240 — Read-only admission vs tool caches — Design

**Issue:** [#240](https://github.com/Kodria/agentic-workflow/issues/240)

**Scope:** (1) `agentic-workflow` CLI — strip allowlisted tool-cache argv under `readOnly`; (2) `awm-baseline-registry` — eslint `--cache-location` under `node_modules/.cache/eslint/` for `js-ts` lint variants. No UI.

**Approach:** Enfoque 1 (brainstorming 2026-10-30). Strip pre-execute on `readOnly` + pack `cache-location`. Do **not** exclude `.awm/sensors/runs` from the read-only snapshot (issue hypothesis rejected after reproduction).

**Design artifacts:** none

**Change Record:** `issue-240-readonly-tool-cache` (CLI PR); registry companion record per that repo’s process when the pack PR opens.

## Problem

`awm plan admit … --verify-sensors` blocks with:

```text
ADMISSION_SENSORS_BLOCKED: … not-certified (read-only-mutation-detected)
```

Issue #240 blamed AWM result-cache writes under `.awm/sensors/runs/cache-*.json`. Reproduction on 9.22.1 shows that diagnosis is **false**:

- Admission calls `runSensors({ cwd, all: true, readOnly: true })` with `useCache` unset.
- RF-2.11: `cacheEnabled = useCache === true && !ignoreBaseline && !readOnly` — admission neither reads nor writes AWM result cache.
- The observed mutation is ESLint’s `./.eslintcache` from pack `js-ts` lint args `--cache` **without** `--cache-location`.
- Read-only exclusions (#215) skip **directories** (e.g. gitignored `node_modules`), not loose files at the project root.
- Live pack commands override stamped `.awm/sensors.json` args, so a project-only `cache-location` does not fix admit.
- Workaround `awm sensors run` before admit works because `.eslintcache` already exists and is content-stable — not because admit reads AWM cache.

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| DD-1 | CLI strips an allowlist of tool-cache flags only when `readOnly === true`, immediately before spawn. | Fail-closed for admission integrity; operator `sensors run` keeps tool caches. |
| DD-2 | Allowlist is ESLint-shaped: `--cache`, and `--cache-location` plus its following operand when present. Extensible later; no heuristic “any arg containing cache”. | Covers the reproduced bug without false positives on project argv. |
| DD-3 | Apply strip at the execute boundary (copy of `args` for the spawn), not inside prepare and not in fingerprint/cache digests. | Prepare/RF-2 fingerprints stay operator-faithful; admission does not use result cache. |
| DD-4 | Keep RF-2.11 / B-R5 unchanged: no AWM result-cache during `readOnly`; do not exclude `.awm` or `.awm/sensors/runs` from the snapshot. | Issue option “exclude CLI cache paths” does not fix `.eslintcache` and weakens #215. |
| DD-5 | Registry pack adds `--cache-location node_modules/.cache/eslint/` beside every lint `--cache`. | Operator hygiene; cache lives under a default-excluded directory name. |
| DD-6 | Ship CLI first (protects old packs on admit); registry PR second or parallel (operator root litter). | CLI alone satisfies admission for stale packs; pack alone does not satisfy scope “CLI defense”. |
| DD-7 | `--cache-location` without a preceding/paired `--cache` is not stripped by itself. | Avoid deleting unrelated location-like args; ESLint location is meaningful with `--cache`. |

**Accepted risk:** a future tool that writes a non-allowlisted cache file at an observed path can still trip admission until the allowlist (or pack) is extended. Real source mutations remain detected.

## Requirements

- **R1 — Strip on readOnly:** IF `runSensors` runs with `readOnly: true` AND a structured command’s `args` contain allowlisted tool-cache tokens (`--cache`, and when present `--cache-location` plus its immediate following operand), THEN THE CLI SHALL remove those tokens from the argv used to spawn the tool.
- **R2 — Operator unchanged:** IF `runSensors` runs without `readOnly`, THEN THE CLI SHALL NOT strip allowlisted tool-cache tokens from structured command args.
- **R3 — AWM cache policy unchanged:** IF admission invokes sensors with `readOnly: true`, THEN THE CLI SHALL leave `useCache` unset/false and SHALL neither read nor write `.awm/sensors/runs/cache-*.json` for that run (RF-2.11).
- **R4 — Pack cache location:** WHEN a baseline `js-ts` pack lint variant declares ESLint `--cache`, THE pack SHALL also declare `--cache-location` and `node_modules/.cache/eslint/` as consecutive args after `--cache` (or an equivalent adjacent pair documented in the pack PR).
- **R5 — No false mutation from eslint cache:** IF a `readOnly` run’s sensors would pass except for ESLint creating or updating `./.eslintcache` due to `--cache` without an excluded location, THEN after this change THE CLI SHALL NOT report `reason: "read-only-mutation-detected"` solely for that cause.
- **R6 — Helper purity:** WHEN stripping, THE CLI SHALL NOT mutate the caller’s original `args` array (return a new array / command copy).
- **R7 — Real mutations still fail:** IF a `readOnly` sensor run creates or modifies an observed project path outside stripped tool-cache behavior (e.g. a source file under the tree), THEN THE CLI SHALL still report `read-only-mutation-detected`.
- **R8 — Legacy string `cmd`:** WHERE a sensor still uses legacy shell `cmd` (not `StructuredCommand`), THE CLI SHALL NOT attempt tool-cache stripping on that string in this change (admission packs in scope are structured).

## Architecture

```text
plan admit --verify-sensors
  → runSensors({ all: true, readOnly: true })  // useCache unset
  → load admission exclusions + before snapshot
  → prepare sensors (pack live command may still list --cache)
  → for each execute: if readOnly → stripReadOnlyToolCacheArgs(args) → spawn
  → after snapshot → certify (no root .eslintcache from stripped --cache)
```

**CLI module (proposed):** `cli/src/commands/sensors/read-only-tool-cache.ts` exporting `stripReadOnlyToolCacheArgs(args: readonly string[]): string[]` (name may vary; single purpose).

**Wire-up:** `runPreparedSlot` / structured execute path in `run.ts` (or the single call site that passes `command.args` into `runStructuredCommand`), gated on the same `readOnly` flag already used for observation.

**Registry:** edit `sensor-packs/js-ts/pack.json` lint variant commands; bump bundle/catalog versions per registry CONSTITUTION; run `./scripts/check-skill-version-bumps.sh origin/main` if skills change (pack-only PRs follow pack version rules).

## Test plan (design-level)

**CLI**

- Unit: strip `--cache`; strip `--cache` + `--cache-location` + path; leave unrelated args; idempotent; do not mutate input; do not strip lone `--cache-location` without allowlisted pairing rules per DD-7.
- `runSensors({ readOnly: true })` with a structured eslint-like command including `--cache`: assert spawn args lack `--cache`; assert no `./.eslintcache`; assert `reason` is not `read-only-mutation-detected` when that was the only write.
- Without `readOnly`: spawn/mock receives `--cache` unchanged.
- RF-2.11 regression: `readOnly` does not create `cache-*.json`.
- R7: sensor that writes a normal project file under `readOnly` still yields `read-only-mutation-detected`.

**Registry**

- Contract or pack assertion: every `js-ts` lint variant that has `--cache` also has the adjacent `--cache-location` / `node_modules/.cache/eslint/` pair.

## Non-goals

- Excluding `.awm/`, `.awm/sensors/runs/`, or AWM `cache-*.json` from read-only observation.
- Disabling AWM result cache on admission (already disabled).
- Changing prepare fingerprints or RF-2 digest inputs because of `readOnly`.
- Broad “strip any cache-like arg” heuristics.
- Other packs (python, etc.) until a concrete reproduction exists.
- Rewriting B-R5 or `.awm/admission.json` defaults for file-level ignores.

## Delivery split

| PR | Repo | Covers |
|----|------|--------|
| 1 | `agentic-workflow` | R1–R3, R5–R8 + CLI tests |
| 2 | `awm-baseline-registry` | R4 + pack contract / version bumps |

## Self-review

1. **Placeholders:** none.
2. **Consistency:** architecture matches R1–R8; DD-4 rejects the issue’s `.awm` exclusion option.
3. **Scope:** two PRs, one design; no UI.
4. **Ambiguity:** allowlist contents, strip locus, DD-7 pairing, legacy `cmd` exclusion, and delivery order are explicit.
5. **EARS/IDs:** R1–R8 are IF/WHEN/WHERE + SHALL and 1:1 testable.
