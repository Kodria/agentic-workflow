# Sensor execution optimization — Design

**Issue:** [#236](https://github.com/Kodria/agentic-workflow/issues/236)

**Scope:** coordinated changes in `agentic-workflow` (CLI: `sensors run`, receipts, `change` validate/new, preflight/status, CLI reference) and `awm-baseline-registry` (sensor-pack `inputs` / `closureOnly` defaults, skills that gate on sensors, `setup-sensors` authoring, `minCliVersion` / pack schema / certification)

**Approach:** (A) per-sensor declarative `inputs` + fingerprint-keyed result reuse when measured content is unchanged; (B) receipts / Change Record certify measured inputs (schema 2) so unmeasured-only HEAD advances do not force a full re-run; (C) lifecycle gates use `awm sensors run --slice` (all sensors except pack-declared `closureOnly`, typically mutation) for slice DONE, and a full gate for QA / docs / finishing. Brainstorming 2026-10-27; amended after PR #237 audits (r1 1–14; r2 B–K; r3 N1–N3/R3/X1; `#7` → `--slice` + `closureOnly`, owner-approved).

**Specialist gate:** architecture — applicable (receipt + run pipeline); technology — pin a glob matcher (`picomatch`); NFR — no false green outranks wall-clock savings.

**Delivery split (audit [B]):** two executable plans — (1) CLI plan in this repo (S1–S5 + RF-D.1; no registry jest dependency); (2) registry plan in `awm-baseline-registry` after the CLI that parses `inputs`/`closureOnly` is on npm. RF-7 (and pack/skill RFs marked below) are **implemented by the registry plan**; this document remains the **single normative source** for those IDs (audit [X1]). The registry design cites IDs + CLI design commit SHA and must not rewrite requirement prose.

## Requirements

### RF-1 — Inputs declaration

- **RF-1.1 — Optional inputs on sensors:** WHEN a pack variant or a project-declared sensor entry declares `inputs`, THE CLI SHALL treat it as an ordered list of one or more non-empty glob strings relative to the manifest's `packageRoot` (or repository root when no package root applies). For digests, cache keys, receipts, and `change validate` late-path checks, THE CLI SHALL normalize every matched path to a POSIX path relative to the **git repository root** (prefixing `packageRoot` when set).
- **RF-1.2 — Pack defaults:** WHEN a pack-bound sensor's effective variant declares `inputs`, THE CLI SHALL use those globs unless the project manifest overrides `inputs` for that sensor id.
- **RF-1.3 — Project override:** WHEN a project manifest sensor entry declares `inputs`, THE CLI SHALL use that list as the effective inputs for that sensor id for caching and for unmeasured-path checks, regardless of pack defaults.
- **RF-1.4 — Missing inputs means always execute:** IF a selected sensor has no effective `inputs`, THEN THE CLI SHALL execute that sensor on every run that selects it (when selected) and SHALL NOT treat any prior result as a cache hit for that sensor.
- **RF-1.5 — Invalid inputs and glob syntax:** IF any `inputs` entry is empty, absolute, contains NUL/control characters, escapes the package/manifest root after resolution, or uses glob syntax outside the supported subset, THEN THE CLI SHALL mark that sensor entry invalid with a reason naming the sensor and field, and SHALL NOT use a partial or guessed input set. Matching SHALL use pinned **picomatch** with options `{ dot: true, posix: true }` and **without** `nocase` (paths come from `git ls-files`, already normalized). Supported patterns: `*`, `**`, `?`, character classes. Brace expansion `{a,b}` and negation `!` prefixes are **not** supported and SHALL be rejected as invalid.
- **RF-1.6 — Changing inputs invalidates cache:** IF the effective `inputs` list for a sensor id differs from the list recorded with a prior usable pass, THEN THE CLI SHALL NOT reuse that prior pass.
- **RF-1.7 — Schema allowlist:** WHEN parsing manifests and packs, THE CLI SHALL accept `inputs` on sensor/variant shapes this design extends and `closureOnly` on **sensor-level** pack/manifest entries (not variants), and SHALL continue to reject unknown fields elsewhere under the existing strict `fields()` discipline.
- **RF-1.8 — No inferred inputs:** THE CLI SHALL NOT invent `inputs` globs from stack detection, `--changed` diffs, or file-type heuristics. Only pack declarations and explicit project overrides define inputs (except the always-measured set in RF-2.12, which is CLI-defined and not authored as sensor `inputs`).
- **RF-1.9 — Conservative pack defaults (registry-implemented; extension-bound):** THE baseline packs SHALL declare `inputs` **only** for sensors whose tool scope is reliably boundable (at minimum: `typecheck`, and `lint` where extensions/ignore files bound the check). Pack default `inputs` SHALL be bound **by file extension across the whole tree, never by a source directory** (e.g. never `src/**` alone): pack configs such as `tsconfig.awm.json` / `eslint.config.awm.mjs` **extend** the project's own configs, so directory defaults miss `tests/` / `scripts/` and false-green. Normative defaults: **typecheck** → `**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json}` plus `**/tsconfig*.json`; **lint** → the same code extensions the eslint config covers, plus eslint config files / `.eslintignore` / `package.json` when `eslintConfig` applies; **python** (if bounded) → `**/*.{py,pyi}` plus `pyproject.toml`, `setup.cfg`, `mypy.ini`. Sensors whose tools walk the tree or run arbitrary project code — `format`, `test`, `mutation`, `security` — SHALL ship **without** `inputs`. Projects MAY override; `setup-sensors` SHALL teach overrides (including mutation/test for #236). Registry contract tests SHALL reject pack-default globs that are directory-anchored (path segment before `**` that is not a pure extension/config pattern).

### RF-2 — Input digest, fingerprint, and cache on `sensors run`

- **RF-2.1 — Digest enumeration:** WHEN computing an input digest, THE CLI SHALL enumerate candidate paths with git (`git ls-files -co --exclude-standard` from the repo root, fail closed on git failure per RF-E.2), filter to paths that match the effective globs after RF-1.1 normalization (picomatch options per RF-1.5). For each matched path: IF it is a symlink, THE CLI SHALL hash the `readlink` target string (never follow the link / never read through it); IF `lstat` yields ENOENT (deleted but still listed), THE CLI SHALL contribute an explicit `ABSENT` marker; IF it is a regular file, THE CLI SHALL hash contents. Ignored paths (e.g. `node_modules/`) DO NOT participate. Untracked but not ignored matches DO participate.
- **RF-2.16 — Digest stability around execute:** THE CLI SHALL compute the input digest **before** execute and, after a successful execute that would be cached, recompute it; IF the digest changed, THE CLI SHALL NOT write a cache entry for that run.
- **RF-2.2 — Cache hit:** IF a selected sensor has effective `inputs` AND a usable prior raw cache entry exists (RF-2.4) for the same project/manifest identity, sensor id, `sensorFingerprint` (RF-2.10), and matching **cache** input digest (RF-2.12), AND cache use is enabled (RF-2.11), THEN THE CLI SHALL NOT execute that sensor's command and SHALL report status after re-applying the **current** baseline (RF-2.13) with `cached: true` and provenance.
- **RF-2.3 — Cache miss executes:** IF there is no usable prior entry, OR the digest/fingerprint differs, OR the sensor has no effective `inputs`, OR cache use is disabled, THEN THE CLI SHALL prepare and execute the sensor under the existing prepare → execute → interpret pipeline (baseline applied after, never as the cached payload).
- **RF-2.4 — Cacheable raw statuses (`failureKind`):** Today's `fail` conflates formatter findings, absent binaries, and non-zero exit-code tools (`SensorResult` / `SensorError` have no kind). THE interpreter / raw result SHALL carry `failureKind: 'findings' | 'missing-binary' | 'exit-code'` (or equivalent) when status is `fail`. THE CLI SHALL store a raw (pre-baseline) result when it is `pass`, OR when it is `fail` with `failureKind === 'findings'` AND `errors.length > 0`. THE CLI SHALL NOT store `inconclusive`, `skipped`, `fail` with `missing-binary` or `exit-code`, crash/timeout/incomplete runs, or a `fail` without findings. RED: exit-code fail and missing-binary fail are never written to cache; findings fail may be.
- **RF-2.5 — Overall reduction unchanged:** WHEN reducing `overall`, THE CLI SHALL use the post-baseline status for each sensor (cached or executed) under existing rules.
- **RF-2.6 — Selection filters:** WHEN `--fast`, `--slow`, `--slice`, and/or `--all` are set, THE CLI SHALL apply selection first; cache decisions apply only to sensors that remain selected. IF `--slice` is combined with `--all` or `--slow`, THE CLI SHALL reject the invocation with a clear validation error (do not invent an intersection). `--slice` combined with `--fast` SHALL mean the intersection (fast ∧ not closureOnly).
- **RF-2.7 — `--changed` must not poison the cache:** WHEN `--changed` is set, THE CLI SHALL keep today's argv-scoping meaning and SHALL NOT treat `--changed` as the digest cache mechanism. THE CLI SHALL **write** cache entries only when `requestedScope === 'full'`. A `--changed` pass MUST NOT become a full-gate cache hit (RED test required).
- **RF-2.8 — Machine-readable provenance:** WHEN emitting stdout JSON, THE CLI SHALL include for each cached sensor `cached: true` and provenance sufficient to audit the hit (origin commit and/or `originDirty`, input digest, fingerprint id), without removing existing consumer fields.
- **RF-2.9 — Force execute:** WHEN `--no-cache` is set, THE CLI SHALL ignore cache hits and execute every selected sensor that would otherwise run. `--no-cache` alone does not make the selection partial for receipt purposes.
- **RF-2.10 — sensorFingerprint (no live version ⇒ no cache):** THE cache key SHALL include a `sensorFingerprint` hash covering at least: effective `variantId` (when pack-bound), effective command (and changedCommand definition if present), **live** tool/runtime versions from this run's `liveState` / `resolveLiveFromSource` (not solely `initializedCompatibility` stamped at init), `cliVersion`, and the effective `inputs` list fingerprint. IF a live tool or runtime version required for that sensor cannot be obtained on this run, THE CLI SHALL neither read nor write the result cache for that sensor (fail closed). RED: project-declared sensor without live tool version → never cache; pack-bound with liveState → cache keyed by live versions. IF any fingerprint component changes, THE CLI SHALL NOT reuse the prior entry.
- **RF-2.11 — Cache opt-in at the CLI boundary:** THE `runSensors` API SHALL use the cache (read or write) only when `useCache: true` is set. THE `awm sensors run` action in `index.ts` SHALL set `useCache: true` by default for operator runs (unless `--no-cache`). Callers such as `preflight --verify-sensors`, admission `readOnly: true`, and `ignoreBaseline: true` / `awm sensors baseline` SHALL leave `useCache` unset/false and SHALL neither read nor write the result cache.
- **RF-2.12 — Always-measured paths (two consumers):**  
  - **Cache digest** SHALL include (repo-root normalized): `.awm/sensors.json`; pack assets of the effective variant; `requirements.configFiles` of the effective variant when present; `package.json` at the package root when the variant uses `packageManager` / package-script resolution or declares `packageJsonFields`; and lockfiles present at the package root (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `Pipfile.lock`, `poetry.lock`, `uv.lock` as applicable).  
  - **`.awm/sensors.baseline.json` SHALL NOT** be part of the **cache** digest (baseline is re-applied every run per RF-2.13) but SHALL remain in the **validate** always-measured set for RF-4.5 so changing baseline after `verification.commit` still fails `change validate` when appropriate.
- **RF-2.13 — Cache raw pre-baseline results:** THE CLI SHALL store the **raw** post-interpret result (before `applyBaseline`) per RF-2.4. On every run (cache hit or miss), THE CLI SHALL apply the current baseline to produce the reported status. RED: raw `fail` with a finding accepted by baseline → cache hit → reported `pass`; remove that finding from baseline → cache hit → reported `fail` without re-exec. IF `ignoreBaseline` is true, THE CLI SHALL NOT read or write the result cache (RED for `awm sensors baseline`).
- **RF-2.14 — Dirty origin provenance:** WHEN writing a cache entry while the worktree is dirty relative to HEAD (under existing dirty rules excluding runtime-state paths), THE CLI SHALL record `originDirty: true` (and still record HEAD when known). JSON provenance for hits SHALL surface that flag.
- **RF-2.15 — Validated cache reads:** WHEN reading cache files, THE CLI SHALL parse from `unknown` with recursive validation (CONSTITUTION), reuse symlink-chain refusal and size bounds consistent with `receipt.ts`, and treat any invalid entry as a miss (RF-E.1), never as a casted pass.

### RF-3 — Authoring and teaching (agent-facing)

*(RF-3.1, RF-3.2, RF-3.5, RF-3.6 — registry-implemented; prose normative here only.)*

- **RF-3.1 — Pack defaults (conservative):** As RF-1.9. Packs MUST NOT ship documentation-excluding `inputs` on tools that read docs/markdown or arbitrary trees.
- **RF-3.2 — setup-sensors teaches inputs and mutation overrides:** THE `setup-sensors` skill SHALL document normative authoring: when to set `inputs`; what belongs vs must not; always-execute without `inputs`; project overrides; prohibition on inventing `**/*`; and an explicit section on declaring `inputs` for `mutation` / slow sensors when the project knows a safe bound (issue #236 case).
- **RF-3.3 — CLI reference:** THE CLI reference SHALL document `inputs`, `closureOnly`, `--slice`, `--no-cache`, cache hit semantics, provenance (including `originDirty`), fingerprint/always-measured paths, `failureKind`, receipt schema 2, and Change Record interaction.
- **RF-3.4 — Preflight / status warning:** WHEN a configured enabled sensor lacks effective `inputs`, THE CLI SHALL surface a non-blocking warning that it is not cacheable.
- **RF-3.5 — No agent-side skip protocol:** Skills SHALL instruct agents to invoke the phase gate command and read `overall`; they SHALL NOT invent skips for “docs only.” Reuse is the CLI's job.
- **RF-3.6 — closureOnly authoring:** THE `setup-sensors` skill and pack docs SHALL explain sensor-level `closureOnly` (default for mutation; optional for security; test never by default) and that projects may override it in `.awm/sensors.json`.

### RF-4 — Receipts and Change Record

- **RF-4.1 — Full-gate receipt still required for Change Record:** WHEN writing a receipt usable by `awm change new` / `change validate --strict`, THE CLI SHALL require a full-gate selection (`isFullSelection` true: not `--changed`, not `--fast` xor `--slow`, not `--slice`), clean tree under existing dirty rules, root manifest, no invalid dropped entries / pack drift, and existing R2 hygiene, as amended by RF-4.2–RF-4.5.
- **RF-4.2 — Cached passes may appear on a full-gate receipt:** WHEN a full-gate run's `overall` is `pass` and every selected sensor is either an executed `pass` or a cached `pass` under RF-2.2 (after baseline), THE CLI SHALL allow writing a receipt for the current HEAD that records those statuses.
- **RF-4.3 — Receipt records measured digests:** New receipts SHALL use schema `2` carrying per-cacheable-sensor input digests, inputs fingerprints, and repo-root-normalized measured path unions (or equivalent) sufficient for RF-4.5. Schema `1` remains readable with legacy late-path rules.
- **RF-4.4 — Receipt rewrite; digest is authority:** WHEN `awm sensors run` performs a full-gate run on a clean tree and every selected sensor reports `pass` (executed on this HEAD, or cache hit per RF-2.2), THE CLI SHALL reduce `overall` normally and, when `overall` is `pass` and R2 hygiene holds, SHALL write a receipt keyed to the current HEAD. THE CLI SHALL NOT require a separate git-diff-vs-origin-commit predicate beyond the digest/fingerprint cache rules; the digest is the authority for reuse.
- **RF-4.5 — Validate unmeasured paths:** WHEN `awm change validate` checks files changed after `verification.commit` for a schema 2 receipt, THE CLI SHALL NOT emit `code-changed-after-verification` solely for paths outside the union of (recorded sensor measured inputs ∪ always-measured set ∪ existing runtime-state exclusions), still excluding `docs/changes/` as today. Paths inside that measured union SHALL count. Schema 1 receipts keep today's strict check (only `docs/changes/` carved out). Always-measured paths (RF-2.12) ALWAYS count as measured.
- **RF-4.6 — Any sensor without authored inputs ⇒ schema-1 late-path rules:** IF any sensor recorded on the verification receipt had no effective authored `inputs` at certification time, THEN `change validate` SHALL apply schema-1 late-path rules (only `docs/changes/` carved out, plus runtime-state exclusions) for that record. Schema-2 unmeasured-path relaxation (RF-4.5) applies only when **every** sensor on the receipt had effective authored `inputs`. (With RF-1.9 defaults, stock js-ts/python receipts include `test` without `inputs`, so docs-only HEAD advances still need a new full-gate run unless the project overrides `inputs` on every sensor — including teaching mutation/test overrides in `setup-sensors`. Closing #236 acceptance MUST state that “seconds after docs-only” requires those project overrides.)
- **RF-4.7 — `change new` remedy honesty:** IF `change new` fails for lack of a HEAD receipt, THE remedy SHALL tell the operator to run full-gate `awm sensors run` (often faster under cache when overrides exist) and SHALL NOT claim every tool binary must re-exec for documentation-only edits.
- **RF-4.8 — Monorepo path alignment and cache location:** Schema 2 measured paths and cache digests SHALL use repo-root POSIX paths so `lateFiles` compares correctly when `packageRoot` is set. Cache files SHALL live under the **same** git-root `.awm/sensors/runs/` directory used for receipts today (`captureReceiptPrecondition` / `gitState` toplevel), not under a nested manifest-only tree when those differ.

### RF-5 — Lifecycle gate policy (skills) — `--slice` + `closureOnly`

*(RF-5.1–RF-5.9 — registry-implemented; RF-5.10 — CLI-implemented. Prose normative here only.)*

- **RF-5.1 — Slice / task DONE is `--slice` gate:** THE skills `subagent-driven-development`, `executing-plans`, and their implementer prompts SHALL require `awm sensors run --slice` with `overall: pass` before marking a task/slice DONE, and SHALL NOT require a full-gate run at that moment unless the active plan or project constitution explicitly demands a full gate.
- **RF-5.2 — verification-before-completion in the implementation loop:** WHEN used to gate task completion during implementation (not QA/docs/finish closure), THE skill SHALL treat `awm sensors run --slice` with `overall: pass` as sufficient.
- **RF-5.3 — QA is full gate:** THE `post-implementation-qa` skill SHALL require full-gate `awm sensors run` (no `--slice` / `--fast` / `--slow`-only) with `overall: pass` at entry, after fixes, and at completion; cache reuse allowed under RF-2.
- **RF-5.4 — Docs Step 5 is full gate:** THE `post-implementation-docs` skill SHALL require full-gate `awm sensors run` before `awm-docs-complete`, stating the CLI may reuse cached passes when digests match.
- **RF-5.5 — Finishing / Change Record is full gate + receipt:** Step 4.1 keeps clean commit → full-gate `awm sensors run` → receipt → `change validate --strict`, amended only by RF-4.
- **RF-5.6 — Forbid partial selection as closure evidence:** Skills SHALL forbid using `--slice`, `--fast`, `--slow` alone, or `--changed` as evidence for QA closure, docs closure, finishing, or Change Record validation.
- **RF-5.7 — Constitutions may harden only:** Constitutions MAY require a full gate earlier; they MUST NOT weaken RF-5.3–RF-5.6.
- **RF-5.8 — Orchestrator carve-out preserved:** `development-process` proportional verification for research/docs outside the marker chain remains; it does not override RF-5.3–RF-5.5 once those phases are active.
- **RF-5.9 — Wording replaces “always no-flag”:** Skills that today mandate no-flag `awm sensors run` as a universal rule SHALL name the phase gate (`--slice` vs full) per RF-5.1–RF-5.5.
- **RF-5.10 — `closureOnly` selection (sensor-level):** `closureOnly` is a **sensor-level** field (like `fast`), not a per-variant field: effective value = project manifest sensor override ?? pack sensor default ?? false. Pack schema and `contract.ts` sensor parse SHALL allow it on the sensor object. WHEN `--slice` is set, THE CLI SHALL run every selected enabled applicable sensor whose effective `closureOnly` is not true, and SHALL skip `closureOnly` sensors (synthetic `skipped` with an explicit reason). `--slice` makes `isFullSelection` false (no Change Record receipt). Baseline packs SHALL default `mutation` to `closureOnly: true`; `security` MAY be; `test` MUST NOT be `closureOnly` by default.

### RF-6 — Safety and observability

- **RF-6.1 — No false green from cache:** THE CLI SHALL NOT report `overall: pass` from cache unless every selected sensor that can affect the verdict is either executed or a valid cached pass under RF-2. Cache MUST NOT drop a selected sensor from the reduction set.
- **RF-6.2 — Incomplete inputs / live-version gaps:** IF a sensor reads paths not listed in authored `inputs`, caching MAY false-green; mitigation is RF-1.9 / RF-3 authoring, preflight warnings — no runtime read tracing. IF live tool versions cannot be obtained for fingerprinting, RF-2.10 applies (no cache read or write for that sensor).
- **RF-6.3 — stderr / notes:** Receipt withhold notes remain; THE CLI SHALL NOT claim a tool re-executed when the status was cached.

### RF-7 — Cross-repo rollout (CLI before packs with new fields)

*(RF-7.* — registry-implemented; normative here. Docs-only registry PRs may merge before CLI publish; content slices that ship pack fields wait for npm.)*

- **RF-7.1 — Pack schema, minCliVersion, and CLI re-certification:** THE registry PR that publishes `inputs` / `closureOnly` SHALL update `sensor-packs/pack.schema.json`, raise `minCliVersion` in `awm-registry.json` to a **published** CLI version N that accepts those fields, and **re-certify** `cli-certification.json` so `certifiedCli.version ≥ minCliVersion` (with `version`, `sourceSha` of the public release commit, and observed `protocolDigest` per `scripts/cli-certification.mjs`). Leaving `certifiedCli` on an older floor (e.g. 9.14.0) fails `--assert-floor` and acceptance installs that reject the new fields. Confirm `negativeControls` (`routingCli` / `admissionCli`) do not load sensor packs; if they do, document expected behavior in the registry plan.
- **RF-7.2 — Publish order:** Handoff SHALL publish the CLI to npm first, THEN execute registry content slices with `minCliVersion` / `certifiedCli` set to that published version. Skills that name `--slice`, `--no-cache`, or receipt schema 2 SHALL declare the minimum CLI version (same pattern as `writing-plans`).
- **RF-7.3 — Old CLI safety:** Until `minCliVersion` is raised on a release that also ships the new pack fields, packs MUST NOT ship `inputs`/`closureOnly` on tags consumed by older CLIs (strict `fields()` would invalidate variants).
- **RF-7.4 — Mirror pack validator:** THE registry SHALL update `tests/support/sensor-pack-v2-validator.mjs` so sensor `exactFields` allow `closureOnly` and variant `exactFields` allow `inputs`, applying the same RF-1.5 glob rules the CLI enforces (non-empty, relative, no `..`, no `{}` / `!`). THE equivalence suite `tests/sensor-pack-schema-equivalence.test.mjs` SHALL gain positive and negative cases for both fields. Without this, CI goes red as soon as packs declare the new fields.

### RF-D — CLI decision record

- **RF-D.1 — Record `--slice` / `closureOnly` cycle policy:** THE CLI repo SHALL record `D-0xx` in `docs/decisions.md` stating the `--slice` + `closureOnly` cycle policy, that `--slice` / `--fast` / `--slow`-only / `--changed` are never closure evidence for QA/docs/finishing/Change Record, and pointing to the registry companion plan for skill wording updates.

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

Local under the **git-root** `.awm/sensors/runs/` (same directory as receipts; gitignored). Entries validated on read; raw pre-baseline `pass` or findings-bearing `fail`; fingerprint + cache digest keyed.

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

- **2026-10-27 (PR #237 audit r1):** Added RF-1.9, RF-2.1/RF-2.16/10–15, RF-4.4 rewrite, RF-4.5 always-measured, RF-4.8, RF-5.1/5.2/5.6/5.9/5.10 `--slice`+`closureOnly`, RF-7 rollout; revised RF-3.1; non-goal `--since` subsumed; rejected `--fast` as slice gate.
- **2026-10-27 (PR #237 audit r2):** Split delivery into CLI vs registry plans ([B]); cache raw fail+findings ([C]); baseline excluded from cache digest but kept for validate ([C2]); liveState fingerprint ([D]); RF-4.6 single rule + override honesty ([E]); configFiles/package.json + picomatch `dot` ([F]); `closureOnly` sensor-level ([G]); reject `--slice`+`--all`/`--slow` ([H]); cache at git-root runs/ ([I]); readlink + ABSENT ([J]).
- **2026-10-27 (PR #237 / registry #79 audit r3):** `failureKind` for RF-2.4 ([N1]); RF-D.1 in design ([N2]); no-live-version ⇒ no cache ([N3]); RF-1.9 extension-bound defaults ([R3]); single normative source + RF-7.1 re-cert / RF-7.4 mirror validator ([X1]/[R1]/[R2]).
