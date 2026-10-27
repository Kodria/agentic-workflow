# Sensor execution optimization — Design

**Issue:** [#236](https://github.com/Kodria/agentic-workflow/issues/236)

**Scope:** coordinated changes in `agentic-workflow` (CLI: `sensors run`, receipts, `change` validate/new, preflight/status, CLI reference) and `awm-baseline-registry` (sensor-pack `inputs` / `closureOnly` defaults, skills that gate on sensors, `setup-sensors` authoring, `minCliVersion` / pack schema / certification)

**Approach:** (A) per-sensor declarative `inputs` + fingerprint-keyed result reuse when measured content is unchanged; (B) receipts / Change Record certify measured inputs (schema 2) so unmeasured-only HEAD advances do not force a full re-run; (C) lifecycle gates use `awm sensors run --slice` (all sensors except pack-declared `closureOnly`, typically mutation) for slice DONE, and a full gate for QA / docs / finishing. Brainstorming 2026-10-27; amended after PR #237 audit (findings 1–14; #7 revised to `--slice` + `closureOnly`, owner-approved).

**Specialist gate:** architecture — applicable (receipt + run pipeline); technology — pin a glob matcher (`picomatch`); NFR — no false green outranks wall-clock savings.

**Decision:** cycle policy `closureOnly` / `--slice` SHALL be recorded as `D-0xx` in `docs/decisions.md` during implementation (owner-approved 2026-10-27).

## Requirements

### RF-1 — Inputs declaration

- **RF-1.1 — Optional inputs on sensors:** WHEN a pack variant or a project-declared sensor entry declares `inputs`, THE CLI SHALL treat it as an ordered list of one or more non-empty glob strings relative to the manifest's `packageRoot` (or repository root when no package root applies). For digests, cache keys, receipts, and `change validate` late-path checks, THE CLI SHALL normalize every matched path to a POSIX path relative to the **git repository root** (prefixing `packageRoot` when set).
- **RF-1.2 — Pack defaults:** WHEN a pack-bound sensor's effective variant declares `inputs`, THE CLI SHALL use those globs unless the project manifest overrides `inputs` for that sensor id.
- **RF-1.3 — Project override:** WHEN a project manifest sensor entry declares `inputs`, THE CLI SHALL use that list as the effective inputs for that sensor id for caching and for unmeasured-path checks, regardless of pack defaults.
- **RF-1.4 — Missing inputs means always execute:** IF a selected sensor has no effective `inputs`, THEN THE CLI SHALL execute that sensor on every run that selects it (when selected) and SHALL NOT treat any prior result as a cache hit for that sensor.
- **RF-1.5 — Invalid inputs and glob syntax:** IF any `inputs` entry is empty, absolute, contains NUL/control characters, escapes the package/manifest root after resolution, or uses glob syntax outside the supported subset, THEN THE CLI SHALL mark that sensor entry invalid with a reason naming the sensor and field, and SHALL NOT use a partial or guessed input set. THE supported subset is what **picomatch** (pinned dependency) accepts for `*`, `**`, `?`, and character classes; brace expansion `{a,b}` and negation `!` prefixes are **not** supported in v1 of this feature and SHALL be rejected as invalid.
- **RF-1.6 — Changing inputs invalidates cache:** IF the effective `inputs` list for a sensor id differs from the list recorded with a prior usable pass, THEN THE CLI SHALL NOT reuse that prior pass.
- **RF-1.7 — Schema allowlist:** WHEN parsing manifests and pack variants, THE CLI SHALL accept `inputs` and `closureOnly` on the shapes this design extends and SHALL continue to reject unknown fields elsewhere under the existing strict `fields()` discipline.
- **RF-1.8 — No inferred inputs:** THE CLI SHALL NOT invent `inputs` globs from stack detection, `--changed` diffs, or file-type heuristics. Only pack declarations and explicit project overrides define inputs (except the always-measured set in RF-2.12, which is CLI-defined and not authored as sensor `inputs`).
- **RF-1.9 — Conservative pack defaults:** THE baseline packs SHALL declare `inputs` **only** for sensors whose tool scope is reliably boundable (at minimum: `typecheck`, and `lint` where extensions/ignore files bound the check). Sensors whose tools walk the tree or run arbitrary project code by default — including `format` (e.g. `prettier --check .`), `test`, `mutation`, and `security` (e.g. semgrep on `.`) — SHALL ship **without** `inputs` (always execute) unless a later, evidence-backed pack change proves a safe bound. Projects MAY override to add `inputs` (including for mutation); `setup-sensors` SHALL teach that override explicitly for the mutmut/#236 case.

### RF-2 — Input digest, fingerprint, and cache on `sensors run`

- **RF-2.1 — Digest enumeration:** WHEN computing an input digest, THE CLI SHALL enumerate candidate files with git (`git ls-files -co --exclude-standard` from the repo root, fail closed on git failure per RF-E.2), filter to paths that match the effective globs after RF-1.1 normalization, and include only regular files. THE CLI SHALL NOT follow symlinks when hashing (lstat; skip or fail closed on symlink matches in line with CONSTITUTION read rules — prefer skip-as-absent for the digest entry and never hash through a link that escapes the root). Untracked but not ignored files that match DO participate (dirty-tree correctness). Ignored paths (e.g. `node_modules/`) DO NOT.
- **RF-2.16 — Digest stability around execute:** THE CLI SHALL compute the input digest **before** execute and, after a successful execute that would be cached, recompute it; IF the digest changed, THE CLI SHALL NOT write a cache entry for that run.
- **RF-2.2 — Cache hit:** IF a selected sensor has effective `inputs` AND a usable prior raw `pass` exists for the same project/manifest identity, sensor id, `sensorFingerprint` (RF-2.10), and matching input digest (including always-measured paths in RF-2.12), AND cache use is enabled for this invocation (RF-2.11), THEN THE CLI SHALL NOT execute that sensor's command and SHALL report status after re-applying baseline (RF-2.13) with `cached: true` and provenance (origin commit or dirty marker, input digest, fingerprint).
- **RF-2.3 — Cache miss executes:** IF there is no usable prior pass, OR the digest/fingerprint differs, OR the sensor has no effective `inputs`, OR cache use is disabled, THEN THE CLI SHALL prepare and execute the sensor under the existing prepare → execute → interpret pipeline (baseline applied after, never as the cached payload).
- **RF-2.4 — Never cache non-pass:** IF a raw (pre-baseline) result for a sensor is not `pass`, THEN THE CLI SHALL NOT store it as a reusable cache entry.
- **RF-2.5 — Overall reduction unchanged:** WHEN reducing `overall`, THE CLI SHALL treat a cached-then-baselined `pass` exactly as an executed baselined `pass`, and SHALL let any non-pass drive `overall` under existing rules.
- **RF-2.6 — Selection filters:** WHEN `--fast`, `--slow`, `--slice`, and/or `--all` are set, THE CLI SHALL apply selection first; cache decisions apply only to sensors that remain selected.
- **RF-2.7 — `--changed` must not poison the cache:** WHEN `--changed` is set, THE CLI SHALL keep today's argv-scoping meaning and SHALL NOT treat `--changed` as the digest cache mechanism. THE CLI SHALL **write** cache entries only when `requestedScope === 'full'`. A `--changed` pass MUST NOT become a full-gate cache hit (RED test required).
- **RF-2.8 — Machine-readable provenance:** WHEN emitting stdout JSON, THE CLI SHALL include for each cached sensor `cached: true` and provenance sufficient to audit the hit (origin commit and/or `originDirty`, input digest, fingerprint id), without removing existing consumer fields.
- **RF-2.9 — Force execute:** WHEN `--no-cache` is set, THE CLI SHALL ignore cache hits and execute every selected sensor that would otherwise run. `--no-cache` alone does not make the selection partial for receipt purposes.
- **RF-2.10 — sensorFingerprint:** THE cache key SHALL include a `sensorFingerprint` hash covering at least: effective `variantId` (when pack-bound), effective command (and changedCommand definition if present), resolved tool/runtime versions from initialized compatibility when present, `cliVersion`, and the effective `inputs` list fingerprint. IF any fingerprint component changes, THE CLI SHALL NOT reuse the prior entry.
- **RF-2.11 — Cache opt-in at the CLI boundary:** THE `runSensors` API SHALL use the cache (read or write) only when `useCache: true` is set. THE `awm sensors run` action in `index.ts` SHALL set `useCache: true` by default for operator runs (unless `--no-cache`). Callers such as `preflight --verify-sensors`, admission `readOnly: true`, and `ignoreBaseline: true` / `awm sensors baseline` SHALL leave `useCache` unset/false and SHALL neither read nor write the result cache.
- **RF-2.12 — Always-measured paths:** IN ADDITION to authored `inputs`, every cacheable sensor's digest SHALL include a CLI-defined always-measured set (repo-root normalized): `.awm/sensors.json`, `.awm/sensors.baseline.json` when present, pack assets referenced by the effective variant, and lockfiles present at the package root (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `Pipfile.lock`, `poetry.lock`, `uv.lock` as applicable). These paths also count as measured for RF-4.5.
- **RF-2.13 — Cache raw pre-baseline results:** THE CLI SHALL store only the **raw** post-interpret result (before `applyBaseline`). On every run (cache hit or miss), THE CLI SHALL apply the current baseline to produce the reported status. IF `ignoreBaseline` is true, THE CLI SHALL NOT read or write the result cache.
- **RF-2.14 — Dirty origin provenance:** WHEN writing a cache entry while the worktree is dirty relative to HEAD (under existing dirty rules excluding runtime-state paths), THE CLI SHALL record `originDirty: true` (and still record HEAD when known). JSON provenance for hits SHALL surface that flag.
- **RF-2.15 — Validated cache reads:** WHEN reading cache files, THE CLI SHALL parse from `unknown` with recursive validation (CONSTITUTION), reuse symlink-chain refusal and size bounds consistent with `receipt.ts`, and treat any invalid entry as a miss (RF-E.1), never as a casted pass.

### RF-3 — Authoring and teaching (agent-facing)

- **RF-3.1 — Pack defaults (conservative):** As RF-1.9. Packs MUST NOT ship documentation-excluding `inputs` on tools that read docs/markdown or arbitrary trees.
- **RF-3.2 — setup-sensors teaches inputs and mutation overrides:** THE `setup-sensors` skill SHALL document normative authoring: when to set `inputs`; what belongs vs must not; always-execute without `inputs`; project overrides; prohibition on inventing `**/*`; and an explicit section on declaring `inputs` for `mutation` / slow sensors when the project knows a safe bound (issue #236 case).
- **RF-3.3 — CLI reference:** THE CLI reference SHALL document `inputs`, `closureOnly`, `--slice`, `--no-cache`, cache hit semantics, provenance (including `originDirty`), fingerprint/always-measured paths, receipt schema 2, and Change Record interaction.
- **RF-3.4 — Preflight / status warning:** WHEN a configured enabled sensor lacks effective `inputs`, THE CLI SHALL surface a non-blocking warning that it is not cacheable.
- **RF-3.5 — No agent-side skip protocol:** Skills SHALL instruct agents to invoke the phase gate command and read `overall`; they SHALL NOT invent skips for “docs only.” Reuse is the CLI's job.
- **RF-3.6 — closureOnly authoring:** THE `setup-sensors` skill and pack docs SHALL explain `closureOnly` (default for mutation; optional for security) and that projects may override it in `.awm/sensors.json`.

### RF-4 — Receipts and Change Record

- **RF-4.1 — Full-gate receipt still required for Change Record:** WHEN writing a receipt usable by `awm change new` / `change validate --strict`, THE CLI SHALL require a full-gate selection (`isFullSelection` true: not `--changed`, not `--fast` xor `--slow`, not `--slice`), clean tree under existing dirty rules, root manifest, no invalid dropped entries / pack drift, and existing R2 hygiene, as amended by RF-4.2–RF-4.5.
- **RF-4.2 — Cached passes may appear on a full-gate receipt:** WHEN a full-gate run's `overall` is `pass` and every selected sensor is either an executed `pass` or a cached `pass` under RF-2.2 (after baseline), THE CLI SHALL allow writing a receipt for the current HEAD that records those statuses.
- **RF-4.3 — Receipt records measured digests:** New receipts SHALL use schema `2` carrying per-cacheable-sensor input digests, inputs fingerprints, and repo-root-normalized measured path unions (or equivalent) sufficient for RF-4.5. Schema `1` remains readable with legacy late-path rules.
- **RF-4.4 — Receipt rewrite; digest is authority:** WHEN `awm sensors run` performs a full-gate run on a clean tree and every selected sensor reports `pass` (executed on this HEAD, or cache hit per RF-2.2), THE CLI SHALL reduce `overall` normally and, when `overall` is `pass` and R2 hygiene holds, SHALL write a receipt keyed to the current HEAD. THE CLI SHALL NOT require a separate git-diff-vs-origin-commit predicate beyond the digest/fingerprint cache rules; the digest is the authority for reuse.
- **RF-4.5 — Validate unmeasured paths:** WHEN `awm change validate` checks files changed after `verification.commit` for a schema 2 receipt, THE CLI SHALL NOT emit `code-changed-after-verification` solely for paths outside the union of (recorded sensor measured inputs ∪ always-measured set ∪ existing runtime-state exclusions), still excluding `docs/changes/` as today. Paths inside that measured union SHALL count. Schema 1 receipts keep today's strict check (only `docs/changes/` carved out). Always-measured paths (RF-2.12) ALWAYS count as measured.
- **RF-4.6 — Sensors without inputs:** IF a schema 2 receipt includes a selected sensor that had no effective authored `inputs` at certification, that sensor contributes no authored glob union; always-measured paths still apply. Broad “any non-docs path is fine” reuse SHALL NOT apply merely because other sensors were cacheable — late paths that are not in any recorded measured union still fail validate, except `docs/changes/` and runtime exclusions. (Sensors without inputs must have been executed on the certifying run per RF-1.4; they do not invent an open-world allowlist.)
- **RF-4.7 — `change new` remedy honesty:** IF `change new` fails for lack of a HEAD receipt, THE remedy SHALL tell the operator to run full-gate `awm sensors run` (often fast under cache) and SHALL NOT claim every tool binary must re-exec for documentation-only edits.
- **RF-4.8 — Monorepo path alignment:** Schema 2 measured paths and cache digests SHALL use repo-root POSIX paths so `lateFiles` (repo-relative) compares correctly when `packageRoot` is set (e.g. `cli/`). Cache files live under the manifest directory's `.awm/sensors/runs/` (same authority as today's receipt root resolution).

### RF-5 — Lifecycle gate policy (skills) — `--slice` + `closureOnly`

- **RF-5.1 — Slice / task DONE is `--slice` gate:** THE skills `subagent-driven-development`, `executing-plans`, and their implementer prompts SHALL require `awm sensors run --slice` with `overall: pass` before marking a task/slice DONE, and SHALL NOT require a full-gate run at that moment unless the active plan or project constitution explicitly demands a full gate.
- **RF-5.2 — verification-before-completion in the implementation loop:** WHEN used to gate task completion during implementation (not QA/docs/finish closure), THE skill SHALL treat `awm sensors run --slice` with `overall: pass` as sufficient.
- **RF-5.3 — QA is full gate:** THE `post-implementation-qa` skill SHALL require full-gate `awm sensors run` (no `--slice` / `--fast` / `--slow`-only) with `overall: pass` at entry, after fixes, and at completion; cache reuse allowed under RF-2.
- **RF-5.4 — Docs Step 5 is full gate:** THE `post-implementation-docs` skill SHALL require full-gate `awm sensors run` before `awm-docs-complete`, stating the CLI may reuse cached passes when digests match.
- **RF-5.5 — Finishing / Change Record is full gate + receipt:** Step 4.1 keeps clean commit → full-gate `awm sensors run` → receipt → `change validate --strict`, amended only by RF-4.
- **RF-5.6 — Forbid partial selection as closure evidence:** Skills SHALL forbid using `--slice`, `--fast`, `--slow` alone, or `--changed` as evidence for QA closure, docs closure, finishing, or Change Record validation.
- **RF-5.7 — Constitutions may harden only:** Constitutions MAY require a full gate earlier; they MUST NOT weaken RF-5.3–RF-5.6.
- **RF-5.8 — Orchestrator carve-out preserved:** `development-process` proportional verification for research/docs outside the marker chain remains; it does not override RF-5.3–RF-5.5 once those phases are active.
- **RF-5.9 — Wording replaces “always no-flag”:** Skills that today mandate no-flag `awm sensors run` as a universal rule SHALL name the phase gate (`--slice` vs full) per RF-5.1–RF-5.5.
- **RF-5.10 — `closureOnly` selection:** WHEN `--slice` is set, THE CLI SHALL run every selected enabled applicable sensor whose effective `closureOnly` is not true, and SHALL skip `closureOnly` sensors (synthetic `skipped` with an explicit reason). `--slice` makes `isFullSelection` false (no Change Record receipt). Effective `closureOnly` = project override ?? pack/sensor default ?? false. Baseline packs SHALL default `mutation` to `closureOnly: true`; `security` MAY be `closureOnly` if pack authors choose; `test` MUST NOT be `closureOnly` by default.

### RF-6 — Safety and observability

- **RF-6.1 — No false green from cache:** THE CLI SHALL NOT report `overall: pass` from cache unless every selected sensor that can affect the verdict is either executed or a valid cached pass under RF-2. Cache MUST NOT drop a selected sensor from the reduction set.
- **RF-6.2 — Incomplete inputs are a declaration defect:** IF a sensor reads paths not listed in authored `inputs`, caching MAY false-green; mitigation is RF-1.9 / RF-3 authoring, preflight warnings — no runtime read tracing in this design.
- **RF-6.3 — stderr / notes:** Receipt withhold notes remain; THE CLI SHALL NOT claim a tool re-executed when the status was cached.

### RF-7 — Cross-repo rollout (CLI before packs with new fields)

- **RF-7.1 — Pack schema and certification:** THE registry PR that publishes `inputs` / `closureOnly` SHALL update `sensor-packs/pack.schema.json`, raise `minCliVersion` in `awm-registry.json` to the CLI version that accepts those fields, and update `cli-certification.json` as required by registry process.
- **RF-7.2 — Publish order:** Handoff SHALL merge/publish the CLI first (npm release), THEN merge the registry PR with matching `minCliVersion`. Skills that name `--slice`, `--no-cache`, or receipt schema 2 SHALL declare the minimum CLI version (same pattern as `writing-plans`).
- **RF-7.3 — Old CLI safety:** Until `minCliVersion` is raised, packs MUST NOT ship `inputs`/`closureOnly` on tags consumed by older CLIs (strict `fields()` would invalidate variants).

## Non-goals

- Inferring `inputs` automatically from tool behavior or OS file-access tracing.
- Making third-party tools themselves incremental beyond existing `changedCommand` support.
- A separate `awm sensors run --since <commit|receipt>` flag: **subsumed** by RF-2 digest cache (issue #236 proposal 2); not implemented as its own UX.
- A new schemaVersion-4 manifest migration wave unrelated to additive fields.
- UI / doctor HTML dashboard surfaces for cache analytics.
- Weakening Change Record strict mode to “trust the agent” without a receipt.
- Agent-maintained mute lists without CLI enforcement.
- Using `--fast` alone as the slice DONE gate (rejected; see RF-5.1 / `#7` revised).

## Context and problem

`awm sensors run` always executes the selected configured sensors. Skills require that command before task DONE, QA, docs, and finishing. Re-running when measured inputs cannot have changed wastes wall-clock; charging `mutation` (and similar closure-only work) on every slice also dominates the loop even when the slice already runs lint/typecheck/test. Issue #236's mutmut timing is one instance. Cache alone does not shrink per-slice cost when code changed and when unbounded sensors lack `inputs`; `--slice` + `closureOnly` addresses frequency, digest cache addresses re-verification.

## Architecture

### Three cooperating layers

```text
┌─────────────────────────────────────────────────────────────┐
│ Skills / AGENTS / constitutions                             │
│  phase gate: --slice (DONE) vs full (QA/docs/finish)        │
│  always invoke CLI; never invent a skip                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ awm sensors run (useCache only from CLI run action)         │
│  select → fingerprint+digest → hit? raw cache + baseline    │
│  : miss? execute → store raw if full scope → baseline       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Receipt schema 2 + change validate                          │
│  certify statuses + repo-root measured digests              │
│  late paths vs measured ∪ always-measured                   │
└─────────────────────────────────────────────────────────────┘
```

### Effective inputs / closureOnly

```text
effectiveInputs(sensorId) =
  projectManifest.sensors[sensorId].inputs
  ?? packVariant.inputs
  ?? <none>   // always execute

effectiveClosureOnly(sensorId) =
  projectManifest.sensors[sensorId].closureOnly
  ?? packSensor.closureOnly
  ?? false
```

### Cache store

Local under the manifest's `.awm/sensors/runs/` (gitignored). Entries validated on read; raw pre-baseline passes only; fingerprint + digest keyed.

### Lifecycle table (normative)

| Moment | Gate | Receipt |
|---|---|---|
| Task/slice DONE | `awm sensors run --slice` | No |
| QA entry / after fix / close | full `awm sensors run` | Yes when clean full gate |
| Docs Step 5 | full `awm sensors run` | Per RF-4 |
| Finishing 4.1 | full + receipt + change strict | Required |
| Research/docs outside marker chain | proportional (`development-process`) | N/A |

## Error paths (unwanted behavior)

- **RF-E.1:** IF cache metadata is invalid, tampered, or digest recomputation fails, THEN miss / execute (or `receipt-invalid`), never silent pass.
- **RF-E.2:** IF git cannot list files for digest or late-path checks, THEN fail closed (no cache hit / `git-failed`).
- **RF-E.3:** IF a full-gate run mixes cache hits with an executed fail, THEN `overall` is not `pass` and no passing Change Record receipt is written.

## Documentation deliverables

- CLI reference (RF-3.3); `setup-sensors` (RF-3.2, RF-3.6); pack defaults (RF-1.9); skill gates (RF-5.*); `docs/decisions.md` D-0xx for `--slice`/`closureOnly`; registry `minCliVersion` / schema / certification (RF-7).
- Issue #236 closed by coordinated CLI + registry PRs in publish order RF-7.2.

## Self-review checklist

- [x] Audit #1–6, 8–14 and revised #7 incorporated as SHALL requirements or explicit non-goals.
- [x] `--fast` is not the slice DONE gate; `--slice` keeps `test`; `mutation` is `closureOnly` by default.
- [x] Cache opt-in; raw pre-baseline; no `--changed` write; fingerprint + always-measured paths.
- [x] RF-4.4 digest authority; RF-4.5/4.8 monorepo + always-measured.
- [x] `--since` subsumed (non-goal).
- [x] EARS/IDs testable; no TBD left in requirements.

## UI Screens

None — CLI and skills only.

## Amendment log

- **2026-10-27 (PR #237 audit):** Added RF-1.9, RF-2.1/RF-2.16/10–15, RF-4.4 rewrite, RF-4.5 always-measured, RF-4.8, RF-5.1/5.2/5.6/5.9/5.10 `--slice`+`closureOnly`, RF-7 rollout; revised RF-3.1; non-goal `--since` subsumed; rejected `--fast` as slice gate.
