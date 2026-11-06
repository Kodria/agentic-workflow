# Slice cost control — Design

**Issue:** [#246](https://github.com/Kodria/agentic-workflow/issues/246)

**Scope:** coordinated changes in `agentic-workflow` (CLI: `sensors run` `sliceCmd` selection, shared mechanical-evidence receipt, `awm evidence run`, digest/cache reuse on full-gate closure, CLI reference, decision record) and `awm-baseline-registry` (pack authoring for `inputs` / `sliceCmd` on expensive `closureOnly` sensors, `review-cycle-v1` cut/ceiling/deferred ledger, reviewer prompts, QA deferred consumption, docs/finish full-gate + cache policy, `minCliVersion` / pack schema / certification)

**Approach:** Unified mechanical-evidence substrate. (A) `closureOnly` + optional `sliceCmd` so `--slice` runs an scoped expensive command instead of skipping when the project opts in; (B) dedicated `awm evidence run` writing the same receipt shape reviewers must contrast; (C) mechanical review-round cut with advance+defer (security non-deferrable) so unattended overnight runs do not BLOCK waiting for the owner; (D) per-gate/per-round duration with fixed warn thresholds; (E) full-gate docs/finish reuse digest cache when expensive sensors declare `inputs` that exclude context-only edits (AGENTS/CONSTITUTION/docs). Extends D-025 / #236; does not reopen Spine #126.

**Specialist gate:** architecture — applicable (extend sensor selection + shared evidence schema; serial CLI→registry); technology — no new stack (reuse `{files}` / digest cache / local `.awm` receipts); NFR — no false green, security non-deferrable, unattended must not stall on owner ping, duration observable.

**Delivery split:** two executable plans — (1) CLI plan in this repo; (2) registry plan in `awm-baseline-registry` after the CLI that parses `sliceCmd` and ships `awm evidence run` is on npm. Registry-implemented RFs below remain normatively owned by this document (IDs + this commit SHA); the registry plan must not rewrite requirement prose.

**Brainstorming:** 2026-11-06 — owner approved purpose, RF set, architecture, Approach 1 + parts A–E.

**Design artifacts:** none (no UI screens).

**Change Record:** required on implementation PRs (not on this documentation-only design commit).

## Purpose

Unattended slice cycles inflate wall-clock: expensive verification runs outside the slice gate without fingerprint cache or receipt; reviewers re-execute identical commands; review loops never cut on severity; docs/finish full gates re-charge mutation after context-only edits. This design makes those costs mechanical and bounded without weakening QA/docs/finish full-gate policy or Change Record honesty.

## Non-goals

- Reopening R2 / journal / `awm watch` custody (issue #126 remains PARKED).
- Inferring `inputs` via filesystem tracing or stack heuristics (RF-1.8 of #236 stands).
- Naming mutmut, Stryker, or any language tool in the normative contract (examples only).
- A second sensor id (`mutation-slice` / `mutation`) instead of `sliceCmd` on the same sensor.
- Removing the obligation to run full-gate `awm sensors run` at QA / docs / finish.
- Blocking the unattended plan on review-round ceiling (except open security findings).
- UI / cost dashboards.
- Billing-token claims.

## Requirements

### RF-1 — `sliceCmd` and `--slice` selection

- **RF-1.1 — Scoped run when opted in:** WHEN a sensor's effective config has `closureOnly: true` and a usable `sliceCmd` string that contains the `{files}` placeholder, and `--slice` is set, THE CLI SHALL execute that `sliceCmd` with the slice's changed-file list substituted (after optional `changedExtensions` filtering), and SHALL NOT skip the sensor solely because `closureOnly` is true.
- **RF-1.2 — Skip when not opted in:** IF `closureOnly` is effectively true and there is no usable `sliceCmd`, THEN WHEN `--slice` is set THE CLI SHALL skip that sensor with today's synthetic skipped reason (D-025 preserved).
- **RF-1.3 — Full gate unchanged:** WHEN selection is a full gate (no `--slice`), THE CLI SHALL run the sensor's normal command path; `sliceCmd` SHALL NOT replace the closure command.
- **RF-1.4 — No empty green:** IF `--slice` would run `sliceCmd` but scope cannot be resolved (missing `{files}`, resolution error, or zero files after extension filter when the command requires a non-empty list), THEN THE CLI SHALL NOT report `pass` for that sensor; status SHALL be a non-pass outcome with an explicit reason (`inconclusive` / `fail` / equivalent — never a silent pass for "ran nothing").
- **RF-1.5 — Authoring surface:** THE CLI SHALL accept optional sensor-level `sliceCmd` on pack defaults and project manifest overrides under the existing strict `fields()` allowlist discipline (same family as `changedCmd`). Effective value = project override ?? pack default ?? absent.
- **RF-1.6 — Reuse `{files}` mechanics:** THE CLI SHALL substitute `{files}` for `sliceCmd` using the same placeholder rules as `changedCmd` (including refusal when the placeholder is absent → RF-1.4).
- **RF-1.7 — Partial selection:** A `--slice` run that executes any `sliceCmd` remains a non-full selection: THE CLI SHALL NOT write a Change Record receipt for that run (D-025 / existing `isFullSelection` rules).

### RF-2 — Digest cache for expensive sensors (slice + closure)

- **RF-2.1 — Tests invalidate cache:** WHEN a sensor declares effective `inputs` that include test paths (or the project override does), THE CLI SHALL include those paths in the cache input digest so a test-only change misses cache (extends #236 RF-2; no special-case tool).
- **RF-2.2 — Cache on sliceCmd path:** WHEN `--slice` executes `sliceCmd` for a sensor that has effective `inputs` and a usable cache entry for the current fingerprint+digest, THE CLI SHALL reuse the cached raw result (`cached: true`) under #236 RF-2.2/2.11/2.13 rules.
- **RF-2.3 — Cache on docs/finish full gate (part E):** WHEN QA, docs, or finishing invoke full-gate `awm sensors run` without `--no-cache`, and an expensive sensor (e.g. mutation) has effective `inputs` whose digest is unchanged versus a usable prior entry, THE CLI SHALL NOT re-execute that sensor and SHALL report `cached: true` with provenance. Context-only edits outside those `inputs` (including `AGENTS.md`, `CONSTITUTION.md`, `CLAUDE.md`, and documentation paths not listed in `inputs`) MUST NOT by themselves force re-execution of that sensor.
- **RF-2.4 — Teaching inputs for closure sensors (registry):** THE baseline `setup-sensors` skill and pack docs SHALL teach projects to declare `inputs` (code + tests, not agent context kernels) and optional `sliceCmd` for `mutation` and other slow `closureOnly` sensors. Packs MAY ship conservative defaults only when extension-bound and safe under #236 RF-1.9; otherwise project override remains the path. Runtime SHALL NOT invent globs.
- **RF-2.5 — No false green from cache:** THE CLI SHALL NOT claim `overall: pass` from cache unless every selected sensor that affects the verdict is executed or a valid cached pass (#236 RF-6.1). Cache hits remain valid closure evidence for skills (RF-6.1).

### RF-3 — Canonical mechanical evidence

- **RF-3.1 — Dedicated command:** THE CLI SHALL provide `awm evidence run -- <argv…>` (stable public name) that executes the given command from a declared cwd (default: repo root) and writes a mechanical-evidence receipt containing at least: candidate identity, argv, cwd, exit/result summary, duration, and optional declared scope (files or label passed by the dispatcher).
- **RF-3.2 — Shared schema:** Receipts produced by sensor/`sliceCmd` execution and by `awm evidence run` SHALL share one logical mechanical-evidence schema so reviewers have a single contrast procedure.
- **RF-3.3 — Reviewer contrast (registry):** `review-cycle-v1` «Mechanical evidence» and spec/code-quality reviewer prompts SHALL require: consume an authoritative receipt without re-execution only when candidate, argv, cwd, and obligation match; otherwise execute for real. Widening declared scope versus the receipt SHALL be treated as non-equivalent.
- **RF-3.4 — Local, non-committed storage:** Evidence receipts SHALL live under the git-root `.awm/` runtime area with the same self-ignore / 0600 posture as sensor run receipts so `git add -A` cannot publish them by accident.
- **RF-3.5 — No Change Record coupling:** `awm evidence run` alone SHALL NOT write or satisfy a Change Record verification receipt; only full-gate `awm sensors run` hygiene remains that authority.

### RF-4 — Review-round cut (unattended-safe)

- **RF-4.1 — First round complete fix:** WHEN a role's first review verdict for the frozen candidate contains accepted findings, THE controller SHALL require correction of all of them before that role can be clean for the slice.
- **RF-4.2 — Re-review hard gate only:** WHEN a role is in a re-review (second or later round on the same slice obligation), THE controller SHALL open another fix/re-review loop only for findings classified as security, externally false result (user green / wrong shipped behavior), or red mechanical gate. All other findings SHALL be recorded as deferred ledger entries (not discarded).
- **RF-4.3 — Round ceiling advances:** AFTER three total rounds for a role on the same slice (first review + up to two further cycles), THE controller SHALL defer remaining non-security findings with durable reason `round-ceiling`, allow the slice to advance, and SHALL NOT BLOCK the unattended plan waiting for a live owner decision.
- **RF-4.4 — Security never defers:** IF any security finding remains open for the slice, THEN THE controller SHALL NOT advance that slice until the finding is fixed and revalidated, regardless of round ceiling.
- **RF-4.5 — QA consumes deferred:** BEFORE writing `awm-qa-complete`, `post-implementation-qa` SHALL mechanically list and resolve (fix or explicitly accept with recorded rationale per existing QA rules) every deferred ledger entry from the plan's slices. Missing deferred consumption blocks QA completion.
- **RF-4.6 — Classification source:** Security vs deferrable SHALL use the existing ledger-entry fields (`class` / `severity` / equivalent already required by `review-cycle-v1`); THE controller SHALL NOT invent a parallel taxonomy. Ambiguous or missing class on a finding that would be deferred under RF-4.2 SHALL be treated as non-deferrable until clarified (fail closed toward another round or owner-visible ledger gap — never silent drop).

### RF-5 — Visible duration

- **RF-5.1 — Report durations:** WHEN a slice completes or blocks, THE controller measurement report SHALL include duration per mechanical gate and per review round alongside existing dispatch/round counts (`review-cycle-v1` Bounded measurement extended — counts alone are insufficient).
- **RF-5.2 — Warn threshold:** IF any single gate's duration is ≥ 30% of that slice's total measured time OR ≥ 20 minutes, THEN THE report SHALL include an explicit warning naming the gate and durations. Thresholds are fixed for this release (no median-of-prior-slices).

### RF-6 — Lifecycle, honesty, delivery

- **RF-6.1 — Full gate + cache at closure (registry):** `post-implementation-qa`, `post-implementation-docs`, and `finishing-a-development-branch` SHALL continue to require no-flag full-gate `awm sensors run` with `overall: pass`. They SHALL treat valid `cached: true` sensor passes as acceptable evidence and SHALL NOT instruct `--no-cache` or `--slice` as closure evidence.
- **RF-6.2 — Tool-agnostic contract:** Normative requirements SHALL NOT hard-code a mutation tool or language; fixtures MAY use a stub command.
- **RF-6.3 — Serial publish:** Handoff SHALL publish the CLI to npm first; THE registry plan then raises `minCliVersion` / certification and lands packs+skills. Skills that name `sliceCmd`, `awm evidence run`, or the new review cut SHALL declare the minimum CLI version.
- **RF-6.4 — Decision record (CLI):** THE CLI repo SHALL add `D-0xx` stating: `sliceCmd` extends D-025; full gate remains sole Change Record / finish evidence; deferred review findings require QA consumption; docs/finish must not force expensive re-exec when digests match.

### RF-E — Error and integrity

- **RF-E.1:** IF an evidence receipt fails validation (schema, symlink escape, size bound), THEN consumers SHALL treat it as absent and require real execution — never as a pass.
- **RF-E.2:** IF `sliceCmd` execution times out or exits without a parseable result, THEN THE sensor outcome SHALL be non-pass under existing sensor failure kinds; THE CLI SHALL NOT write a reusable cache entry for that run (#236 RF-2.4).
- **RF-E.3:** IF deferred ledger entries exist and QA attempts to complete without listing them, THEN QA SHALL fail closed (no `awm-qa-complete`).

## Architecture

### Unified evidence substrate

```
Skills (SDD / QA / docs / finish)
        │  --slice | full gate | evidence contrast | deferred ledger
        ▼
┌──────────────────────────────────────────────────────────┐
│ CLI                                                       │
│  sensors run → select → digest/cache                      │
│       │   closureOnly + sliceCmd on --slice               │
│       │   normal cmd on full gate                         │
│       ▼                                                   │
│  evidence run → wrap arbitrary argv                       │
│       └──────────→ mechanical-evidence receipt schema     │
│                    (git-root .awm/, local, gitignored)    │
└──────────────────────────────────────────────────────────┘
        ▲
Packs / .awm/sensors.json: inputs, closureOnly, sliceCmd
```

### Component ownership

| Component | Repo | Primary RFs |
|---|---|---|
| `sliceCmd` parse, `--slice` selection, fail-closed empty scope | CLI | RF-1, RF-E.2 |
| Digest cache reuse for sliceCmd + full gate | CLI | RF-2 |
| `awm evidence run` + shared receipt schema | CLI | RF-3.1–3.2, 3.4–3.5, RF-E.1 |
| CLI reference + D-0xx | CLI | RF-6.4 |
| Pack/schema/`setup-sensors` for inputs+sliceCmd | Registry | RF-2.4, RF-6.3 |
| `review-cycle-v1` cut/ceiling/defer; prompts; duration | Registry | RF-4, RF-5 |
| QA deferred consumption; docs/finish cache wording | Registry | RF-4.5, RF-6.1, RF-E.3 |

### Key flows

1. **Slice:** `--slice` runs non-`closureOnly` sensors plus opted-in `sliceCmd`; writes/reuses evidence; reviewers contrast receipts; rounds follow RF-4; security open ⇒ slice does not advance; ceiling ⇒ defer non-security and continue unattended.
2. **Closure:** After docs-only or AGENTS/CONSTITUTION edits, full gate hits cache for sensors whose `inputs` exclude those paths (RF-2.3); Change Record still requires full-gate receipt hygiene.
3. **Publish:** CLI npm → registry `minCliVersion` + content.

### Relationship to D-025 / #236

- D-025 remains: `--slice` is never Change Record / finish evidence; full gate is.
- #236 digest cache remains the reuse engine; this design makes expensive `closureOnly` sensors optionally participate in `--slice` via `sliceCmd` and makes closure reuse real by teaching/declaring `inputs` (part E).
- `changedCmd` / `--changed` stay a separate scoping mechanism and still must not poison the full-gate cache (#236 RF-2.7).

## Error and edge cases

| Case | Behavior |
|---|---|
| `closureOnly` without `sliceCmd` on `--slice` | Skip (today) |
| `sliceCmd` without `{files}` | Non-pass reason (RF-1.4) |
| Zero files after extension filter | Non-pass reason (RF-1.4) |
| Reviewer re-runs despite matching receipt | Process defect; prompts/contracts forbid; duration warning makes waste visible |
| Round ceiling + open security | Slice does not advance (RF-4.4) |
| Round ceiling + only minors | Defer + advance (RF-4.3) |
| Docs-only after QA; mutation has `inputs` | Cache hit on finish full gate (RF-2.3) |
| Docs-only; mutation has no `inputs` | Always execute (honest #236 RF-1.4); setup-sensors teaches override |
| Invalid evidence receipt | Treat as absent (RF-E.1) |

## Testing strategy (design-level)

- CLI: RED/GREEN unit + command tests for RF-1 selection matrix, RF-1.4 non-pass, RF-2.2/2.3 cache hit with stub command, `awm evidence run` receipt fields, validation fail-closed.
- Registry: contract tests (section-scoped, mutation-proof) for `review-cycle-v1` RF-4/RF-5 wording, reviewer prompts, QA deferred consumption, docs/finish cache language, pack schema allowlist for `sliceCmd`.
- No claim of billed-token savings; wall-clock fixtures use stub durations where needed.

## Implementation plans (after design approval)

1. **CLI plan** in this repo: slices for parse/selection, evidence command+schema, cache path for sliceCmd, docs + D-0xx.
2. **Registry plan** after observed npm CLI version: packs/skills/review-cycle/QA/docs/finish + `minCliVersion` / certification.

## Self-review

- [x] Placeholder scan: no TBD/TODO left in normative sections.
- [x] Internal consistency: Approach 1 + A–E match RF-1…RF-6 and architecture.
- [x] Scope: one initiative, two serial plans; #126 excluded.
- [x] Ambiguity: round ceiling=3, security non-deferrable, advance+defer, warn 30%/20m, command name `awm evidence run`, `sliceCmd`+`{files}`, part E via inputs+cache.
- [x] EARS/IDs: every RF above is EARS-shaped and 1:1 testable.

## Approval

Owner approved brainstorming sections (purpose, requirements, architecture) and directed write-out of this artifact on 2026-11-06. **Pending:** explicit approval of this saved design file before `writing-plans`.
