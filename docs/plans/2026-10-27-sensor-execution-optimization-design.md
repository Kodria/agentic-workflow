# Sensor execution optimization — Design

**Issue:** [#236](https://github.com/Kodria/agentic-workflow/issues/236)

**Scope:** coordinated changes in `agentic-workflow` (CLI: `sensors run`, receipts, `change` validate/new, preflight/status, CLI reference) and `awm-baseline-registry` (sensor-pack `inputs` defaults, skills that gate on sensors, `setup-sensors` authoring rules)

**Approach:** (A) per-sensor declarative `inputs` + result reuse when the input digest is unchanged; (B) receipts / Change Record certify measured inputs so text-only HEAD advances do not force a full re-run; (C) lifecycle gates use existing `fast` vs full selection so the implementation loop does not pay non-fast sensors on every slice, while QA / docs / finishing keep a full gate. Brainstorming 2026-10-27.

**Specialist gate:** architecture — applicable (receipt + run pipeline); technology — trivial (content hashing + globs on existing surfaces); NFR — applicable (no false green outranks wall-clock savings).

## Requirements

### RF-1 — Inputs declaration

- **RF-1.1 — Optional inputs on sensors:** WHEN a pack variant or a project-declared sensor entry declares `inputs`, THE CLI SHALL treat it as an ordered list of one or more non-empty glob strings relative to the manifest's package root (or repository root when no package root applies), and SHALL use that list as the sole file set for that sensor's input digest.
- **RF-1.2 — Pack defaults:** WHEN a pack-bound sensor's effective variant declares `inputs`, THE CLI SHALL use those globs unless the project manifest overrides `inputs` for that sensor id.
- **RF-1.3 — Project override:** WHEN a project manifest sensor entry declares `inputs`, THE CLI SHALL use that list as the effective inputs for that sensor id for caching and for “unmeasured path” checks, regardless of pack defaults.
- **RF-1.4 — Missing inputs means always execute:** IF a selected sensor has no effective `inputs`, THEN THE CLI SHALL execute that sensor on every run that selects it and SHALL NOT treat any prior result as a cache hit for that sensor.
- **RF-1.5 — Invalid inputs fail closed:** IF any `inputs` entry is not a safe relative glob (empty, absolute, NUL/control characters, or a path that escapes the package/manifest root after resolution), THEN THE CLI SHALL mark that sensor entry invalid with a reason naming the sensor and field, and SHALL NOT use a partial or guessed input set for caching.
- **RF-1.6 — Changing inputs invalidates cache:** IF the effective `inputs` list for a sensor id differs from the list recorded with a prior usable pass, THEN THE CLI SHALL NOT reuse that prior pass.
- **RF-1.7 — Schema allowlist:** WHEN parsing manifests and pack variants, THE CLI SHALL accept `inputs` on the sensor/variant shapes this design extends and SHALL continue to reject unknown fields elsewhere under the existing strict `fields()` discipline.
- **RF-1.8 — No inferred inputs:** THE CLI SHALL NOT invent `inputs` globs from stack detection, `--changed` diffs, or file-type heuristics. Only pack declarations and explicit project overrides define inputs.

### RF-2 — Input digest and cache on `sensors run`

- **RF-2.1 — Digest definition:** WHEN a selected sensor has effective `inputs`, THE CLI SHALL compute an input digest as a stable hash over the sorted set of matching regular files (canonical relative path + file contents); a path that matches but is absent SHALL contribute an explicit absence marker so deletions change the digest.
- **RF-2.2 — Cache hit:** IF a selected sensor has effective `inputs` AND a usable prior `pass` exists for the same project root, sensor id, effective `inputs` list, and matching input digest, THEN THE CLI SHALL NOT execute that sensor's command and SHALL report status `pass` with `cached: true` and provenance naming the origin commit (or receipt id) and input digest.
- **RF-2.3 — Cache miss executes:** IF there is no usable prior `pass`, OR the input digest differs, OR the sensor has no effective `inputs`, THEN THE CLI SHALL prepare and execute the sensor under the existing prepare → execute → interpret → baseline pipeline.
- **RF-2.4 — Never cache non-pass:** IF a prior result for a sensor is not `pass` (`fail`, `inconclusive`, `missing-tool`, `skipped`, or any other non-pass status), THEN THE CLI SHALL NOT reuse it as a cache hit.
- **RF-2.5 — Overall reduction unchanged:** WHEN reducing `overall`, THE CLI SHALL treat a cached `pass` exactly as an executed `pass`, and SHALL let any executed non-pass drive `overall` under the existing reduction rules.
- **RF-2.6 — Selection filters unchanged:** WHEN `--fast`, `--slow`, and/or `--all` are set, THE CLI SHALL apply the existing `shouldRun` selection first; cache decisions apply only to sensors that remain selected.
- **RF-2.7 — `--changed` remains argv scope:** WHEN `--changed` is set, THE CLI SHALL keep today's meaning (optional `changedCommand` / file argv scoping) and SHALL NOT treat `--changed` as the input-digest cache mechanism. Cache hits MAY still apply to selected sensors under RF-2.2 when digests match.
- **RF-2.8 — Machine-readable provenance:** WHEN emitting the stdout JSON of `awm sensors run`, THE CLI SHALL include, for each cached sensor, fields that identify `cached: true` and provenance sufficient to audit the hit (origin and input digest), without removing existing sensor result fields required by current consumers.
- **RF-2.9 — Force execute:** WHEN the operator passes an explicit force-execute flag defined in the plan (name fixed at planning), THE CLI SHALL ignore cache hits and execute every selected sensor that would otherwise run.

### RF-3 — Authoring and teaching (agent-facing)

- **RF-3.1 — Pack defaults ship with baseline packs:** THE `awm-baseline-registry` sensor packs SHALL declare `inputs` for each shipped sensor variant such that the globs cover only paths that sensor is intended to measure (tool configs and source/test trees for that check), and SHALL NOT include generic documentation paths (`README*`, `docs/**` except when that sensor's purpose is documentation), `docs/plans/**`, `docs/changes/**`, `AGENTS.md`, `CLAUDE.md`, or `.awm/sensors/runs/**` by default.
- **RF-3.2 — setup-sensors teaches inputs:** THE `setup-sensors` skill SHALL document, as normative authoring rules: when to set `inputs`; what belongs vs must not belong by default; that missing `inputs` means always-execute; how a project overrides pack defaults; and that agents MUST NOT invent broad globs such as `**/*` to “be safe.”
- **RF-3.3 — CLI reference:** THE CLI reference SHALL document `inputs`, cache hit semantics, provenance fields, force-execute, and the relationship to receipts / Change Record.
- **RF-3.4 — Preflight / status warning:** WHEN a configured enabled sensor lacks effective `inputs`, THE CLI SHALL surface a non-blocking warning on `awm sensors status` and on sensor-related preflight checks that the sensor is not cacheable.
- **RF-3.5 — No agent-side skip protocol:** Skills SHALL instruct agents to invoke the phase gate command and read `overall`; they SHALL NOT instruct agents to skip `awm sensors run` based on a private judgment that “only docs changed.” Reuse is the CLI's responsibility.

### RF-4 — Receipts and Change Record

- **RF-4.1 — Full-gate receipt still required for Change Record:** WHEN writing a receipt usable by `awm change new` / `change validate --strict`, THE CLI SHALL require a full-gate selection (not `--fast` xor `--slow`, and not a selection that today's `isFullSelection` treats as partial for receipt purposes), a clean tree under existing dirty rules, root manifest, no invalid dropped entries / pack drift, and at least one non-all-skipped certification under existing R2 rules, except as RF-4.2–RF-4.5 amend.
- **RF-4.2 — Cached passes may appear on a full-gate receipt:** WHEN a full-gate run's `overall` is `pass` and every selected sensor is either an executed `pass` or a cached `pass` under RF-2.2, THE CLI SHALL allow writing a receipt for the current HEAD that records those statuses.
- **RF-4.3 — Receipt records measured digests:** THE receipt schema used for new receipts SHALL carry enough input-digest evidence (per cacheable sensor or an aggregated measured-inputs digest plus per-sensor digests) for validate to decide whether later paths were unmeasured. Existing schema `1` receipts without digests remain readable as today's receipts; only new-schema receipts enable the unmeasured-path reuse in RF-4.5.
- **RF-4.4 — Rewrite receipt on unmeasured-only HEAD advance:** WHEN `awm sensors run` performs a full-gate run and every selected cacheable sensor is a cache hit and every selected non-cacheable sensor (no `inputs`) either did not need to run because none were selected or… **Correction:** WHEN HEAD differs from the origin commit of usable prior passes only by paths outside the union of effective `inputs` of all sensors that will appear as `pass` on the new receipt, AND every sensor that lacks `inputs` is either not selected or has been executed on this HEAD, THEN THE CLI MAY complete the run via cache hits for cacheable sensors and SHALL write a receipt keyed to the current HEAD reflecting `overall: pass` when reduction says so.
- **RF-4.5 — Validate unmeasured paths:** WHEN `awm change validate` checks files changed after `verification.commit`, THE CLI SHALL NOT emit `code-changed-after-verification` solely for paths that lie outside the union of effective `inputs` recorded for the sensors on the verification receipt (and outside existing runtime-state exclusions). Paths inside any recorded sensor `inputs`, or any change when the receipt lacks input-digest evidence (legacy schema), SHALL continue to count as code-after-verification except for the existing `docs/changes/` carve-out.
- **RF-4.6 — Sensors without inputs block text-only reuse:** IF the verification receipt's sensor set includes any sensor that had no effective `inputs` at certification time, THEN THE CLI SHALL NOT treat arbitrary non-`docs/changes/` path advances as unmeasured for that receipt; validate SHALL keep today's strict path check for those receipts (legacy behavior), aside from `docs/changes/`.
- **RF-4.7 — `change new` remedy honesty:** IF `change new` fails for lack of a HEAD receipt after an unmeasured-only commit, THEN THE remedy SHALL tell the operator to run `awm sensors run` (full gate), which under RF-4.4 is expected to be fast when digests match, and SHALL NOT tell them that documentation changes require re-running every tool binary.

### RF-5 — Lifecycle gate policy (skills)

- **RF-5.1 — Slice / task DONE is fast gate:** THE skills `subagent-driven-development`, `executing-plans`, and their implementer prompts SHALL require `awm sensors run --fast` with `overall: pass` before marking a task/slice DONE, and SHALL NOT require a full-gate run at that moment unless the active plan or project constitution explicitly demands a full gate.
- **RF-5.2 — verification-before-completion in the implementation loop:** WHEN `verification-before-completion` is used to gate task completion during implementation (not QA/docs/finish closure), THE skill SHALL treat the fast gate (`awm sensors run --fast`, `overall: pass`) as sufficient.
- **RF-5.3 — QA is full gate:** THE `post-implementation-qa` skill SHALL require full-gate `awm sensors run` (no speed-only flag) with `overall: pass` at entry, after fixes, and at completion, with cache reuse allowed under RF-2.
- **RF-5.4 — Docs Step 5 is full gate:** THE `post-implementation-docs` skill SHALL keep requiring `awm sensors run` (full gate) before `awm-docs-complete`, and SHALL state that the CLI may reuse cached passes when inputs are unchanged (including typical documentation-only edits).
- **RF-5.5 — Finishing / Change Record is full gate + receipt:** THE `finishing-a-development-branch` Step 4.1 SHALL keep requiring a clean commit, full-gate `awm sensors run`, a written receipt, and `awm change validate --strict` behavior unchanged in obligation, amended only by RF-4 reuse semantics.
- **RF-5.6 — Forbid fast as closure evidence:** Skills SHALL forbid using `--fast` (or any partial selection) as evidence for QA closure, docs closure, finishing, or Change Record validation.
- **RF-5.7 — Constitutions may harden only:** Project constitution / AGENTS guidance MAY require a full gate earlier than this table; they MUST NOT weaken RF-5.3–RF-5.6.
- **RF-5.8 — Orchestrator carve-out preserved:** THE `development-process` proportional verification carve-out for research/documentation that changes no executable behavior remains valid for work outside the QA/docs/finish marker chain; it does not override RF-5.3–RF-5.5 once those phases are active.
- **RF-5.9 — Wording replaces “always no-flag”:** Every skill that today says to run `awm sensors run` with no flag as a universal completion rule SHALL be updated to name the phase gate (fast vs full) per RF-5.1–RF-5.5.

### RF-6 — Safety and observability

- **RF-6.1 — No false green from cache:** THE CLI SHALL NOT report `overall: pass` from cache unless every selected sensor that can affect the verdict is either an executed pass/fail/etc. under existing rules or a cached pass under RF-2.2. Cache MUST NOT drop a selected sensor from the reduction set.
- **RF-6.2 — Incomplete inputs are a declaration defect:** IF a sensor reads paths not listed in `inputs`, THEN caching MAY produce a false green; THE mitigation SHALL be RF-3 authoring rules, pack defaults, and preflight warnings — THE CLI SHALL NOT attempt to discover undeclared reads at runtime in this design.
- **RF-6.3 — stderr / notes:** WHEN a full-gate run writes or withholds a receipt, THE CLI SHALL keep emitting a single clear stderr note on withhold reasons, and SHALL NOT claim a tool re-executed when the status was cached.

## Non-goals

- Inferring `inputs` automatically from tool behavior or OS file-access tracing.
- Making third-party tools themselves incremental beyond existing `changedCommand` support.
- A new schemaVersion-4 manifest migration wave unrelated to adding `inputs` (prefer additive fields on current v3 / pack schema).
- UI / doctor HTML dashboard surfaces for cache analytics.
- Weakening Change Record strict mode to “trust the agent” without a receipt.
- Per-sensor mute lists maintained only in skill prose without CLI enforcement.

## Context and problem

`awm sensors run` always executes the selected configured sensors. Skills and many project constitutions require that command before task DONE, commits, QA, docs, and finishing. When the latest edits cannot change a sensor's verdict (paths outside what it measures), the full wall-clock cost is pure delay. Separately, the implementation loop currently demands a full no-flag run per slice, so non-fast sensors dominate slice time even when a fast gate would suffice until QA/finishing. Issue #236's mutation timing is one instance of this general pattern across sensors and stacks.

## Architecture

### Three cooperating layers

```text
┌─────────────────────────────────────────────────────────────┐
│ Skills / AGENTS / constitutions                             │
│  phase gate: --fast (slice) vs full (QA/docs/finish)        │
│  always invoke CLI; never invent a skip                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ awm sensors run                                             │
│  select sensors → per sensor: digest inputs → hit? reuse    │
│  : miss? execute → reduce overall → maybe write receipt     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Receipt + change validate                                   │
│  certify statuses + measured input digests                  │
│  allow HEAD advances only on unmeasured paths               │
└─────────────────────────────────────────────────────────────┘
```

### Effective inputs resolution

```text
effectiveInputs(sensorId) =
  projectManifest.sensors[sensorId].inputs
  ?? packVariant.inputs
  ?? <none>   // always execute
```

### Cache store

Reuse evidence is local (alongside or inside `.awm/sensors/runs/`), never committed. Exact on-disk layout is fixed in the implementation plan; it MUST be covered by existing `.awm` gitignore policy / runs `.gitignore` so `git add -A` cannot publish it.

### Receipt evolution

Prefer an additive receipt `schema` bump (e.g. `2`) carrying input digests and inputs list fingerprints. `change validate` accepts schema 1 with legacy path rules and schema 2 with RF-4.5 unmeasured-path rules. Planning names the exact fields.

### Lifecycle table (normative summary)

| Moment | Gate | Receipt for Change Record |
|---|---|---|
| Task/slice DONE | `awm sensors run --fast` | No |
| QA entry / after fix / close | full `awm sensors run` | Yes when clean full gate |
| Docs Step 5 | full `awm sensors run` | Per RF-4 |
| Finishing 4.1 | full + receipt + change strict | Required |
| Research/docs outside marker chain | proportional (`development-process`) | N/A |

## Error paths (unwanted behavior)

- **RF-E.1:** IF cache metadata is tampered or digest recomputation fails, THEN THE CLI SHALL treat the entry as a miss and execute (or fail closed for receipt validate as `receipt-invalid`), never as a silent pass.
- **RF-E.2:** IF git cannot list files for digest or for validate's late-path check, THEN THE CLI SHALL fail closed (no cache hit / diagnostic `git-failed`), not assume “unmeasured.”
- **RF-E.3:** IF a full-gate run mixes cache hits with an executed fail, THEN `overall` SHALL NOT be `pass` and THE CLI SHALL NOT write a passing Change Record receipt.

## Documentation deliverables

- CLI reference updates (RF-3.3).
- `setup-sensors` authoring section (RF-3.2).
- Pack `inputs` on baseline packs (RF-3.1).
- Skill gate wording (RF-5.*).
- Issue #236 closed by the coordinated PRs (CLI + registry) that implement this design.

## Self-review checklist

- [x] Placeholder scan: no TBD/TODO left in requirements; force-execute flag name deferred only to planning with RF-2.9 stating it will be fixed there.
- [x] Internal consistency: fast gate never writes Change Record receipt; full gate + RF-4 covers docs-only; cache never invents pass.
- [x] Scope: CLI + baseline registry; no UI; no inferred inputs.
- [x] Ambiguity: README/docs only invalidate sensors that list them in `inputs`; teaching rules make that explicit for agents.
- [x] EARS/IDs: RF-1..RF-6 and RF-E.* are testable SHALL/IF-THEN requirements.

## UI Screens

None — no direct interactive UI; CLI and skills only.
