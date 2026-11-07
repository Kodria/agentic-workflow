# Slice cost control — Design

**Issue:** [#246](https://github.com/Kodria/agentic-workflow/issues/246)

**Scope:** coordinated changes in `agentic-workflow` (CLI: structured `sliceCommand` + slice file-scope resolution, scoped vs full cache isolation, mechanical-evidence run receipts separate from `CycleEvidenceV1`, ledger deferred/resolved state, CLI reference, decision record) and `awm-baseline-registry` (pack authoring for `inputs` / `sliceCommand` on expensive `closureOnly` sensors, `review-cycle-v1` cut/ceiling/deferred ledger, reviewer prompts, QA deferred consumption, docs/finish full-gate + cache policy, `minCliVersion` / pack schema / certification)

**Approach:** Unified mechanical-evidence substrate for **command run receipts**, distinct from existing `awm evidence capture` / `CycleEvidenceV1`. (A) `closureOnly` + optional structured `sliceCommand` so `--slice` runs a scoped expensive command instead of skipping when opted in; (B) `awm evidence run` writing integrity-bound run receipts reviewers must contrast; (C) mechanical review-round cut with advance+defer for non-blocking findings only — **all three RF-4.2 blocking classes never defer**; unattended does not BLOCK waiting for the owner on ceiling; (D) per-gate/per-round duration from ledger timestamps and receipt durations (not LLM clocks) with fixed warn thresholds; (E) full-gate docs/finish reuse of the **existing full-scope** digest cache when expensive sensors declare `inputs` (regression of #236; teaching gap is RF-2.4). Extends D-025 / #236; does not reopen Spine #126.

**Specialist gate:** architecture — applicable (extend sensor selection + shared run-receipt schema + ledger state; serial CLI→registry); technology — no new stack (reuse `StructuredCommand`/`fileInput`, digest cache, local `.awm`); NFR — no false green across scoped↔full cache, security/false-external/red-gate non-deferrable, unattended must not stall on owner ping, duration observable from durable clocks.

**Delivery split:** two executable plans — (1) CLI plan in this repo (includes ledger deferred APIs); (2) registry plan in `awm-baseline-registry` after the CLI that parses `sliceCommand` and ships `awm evidence run` + ledger deferred state is on npm. Registry-implemented RFs below remain normatively owned by this document (IDs + design commit SHA); the registry plan must not rewrite requirement prose.

**Brainstorming:** 2026-11-06 — owner approved purpose, RF set, architecture, Approach 1 + parts A–E.

**Design audit:** 2026-11-06 PR #247 review (D1–D11) — amendments below; owner decision on D4: ceiling **defers and advances** (no live escalate), but **all three** RF-4.2 blocking classes remain non-deferrable.

**Design artifacts:** none (no UI screens).

**Change Record:** required on implementation PRs (not on documentation-only design commits).

## Purpose

Unattended slice cycles inflate wall-clock: expensive verification runs outside the slice gate without fingerprint cache or receipt; reviewers re-execute identical commands; review loops never cut on severity; docs/finish full gates re-charge mutation after context-only edits. This design makes those costs mechanical and bounded without weakening QA/docs/finish full-gate policy or Change Record honesty.

## Non-goals

- Reopening R2 / journal / `awm watch` custody (issue #126 remains PARKED).
- Inferring `inputs` via filesystem tracing or stack heuristics (#236 RF-1.8 stands).
- Naming mutmut, Stryker, or any language tool in the normative contract (examples only).
- A second sensor id (`mutation-slice` / `mutation`) instead of `sliceCommand` on the same sensor.
- Removing the obligation to run full-gate `awm sensors run` at QA / docs / finish.
- Blocking the unattended plan on review-round ceiling for **deferrable** findings (blocking classes still prevent advance).
- Replacing or merging with `awm evidence capture` / `CycleEvidenceV1` (privacy-preserving cycle observations remain a separate surface).
- UI / cost dashboards.
- Billing-token claims.
- Recording unbounded command stdout/stderr or raw secrets in run receipts.

## Requirements

### RF-1 — Structured `sliceCommand` and `--slice` selection

- **RF-1.1 — Scoped run when opted in:** WHEN a sensor's effective config has `closureOnly: true` and a usable structured `sliceCommand` (`StructuredCommand` with `fileInput: { placeholder: '{files}', extensions? }` — same shape as pack `changedCommand`), and `--slice` is set, THE CLI SHALL execute that command with the **slice file scope** (RF-1.8) substituted via the same `fileInput` argv expansion used for `changedCommand`, and SHALL NOT skip the sensor solely because `closureOnly` is true.
- **RF-1.2 — Skip when not opted in:** IF `closureOnly` is effectively true and there is no usable `sliceCommand`, THEN WHEN `--slice` is set THE CLI SHALL skip that sensor with today's synthetic skipped reason (D-025 preserved).
- **RF-1.3 — Full gate unchanged:** WHEN selection is a full gate (no `--slice`), THE CLI SHALL run the sensor's normal command path; `sliceCommand` SHALL NOT replace the closure command.
- **RF-1.4 — Unresolvable vs empty scope:**
  - IF slice file scope **cannot be resolved** (git failure, missing required `--base` for slice scope, `fileInput` missing/`placeholder` not `{files}`, path escape), THEN THE CLI SHALL report a non-pass outcome with an explicit reason — never `pass`.
  - IF slice file scope **resolves and is empty** after extension filtering (slice touched only non-matching paths, e.g. docs-only), THEN THE CLI SHALL `skip` that sensor with an explicit reason (not `pass`, not a blocking fail). Empty-scope skip SHALL NOT by itself fail the slice sensor gate; other selected sensors still reduce `overall` normally.
- **RF-1.5 — Authoring surface (structured first):** Pack schema and structured manifests SHALL accept optional **variant-level** `sliceCommand` parallel to `changedCommand`. Effective value = project structured override ?? pack variant default ?? absent. Legacy text `sliceCmd` + `changedExtensions`-style fields, IF supported at all, SHALL be confined to the legacy manifest parser only and MUST NOT be the pack v2 authoring path (D1 — Windows-unsafe shell interpolation is rejected for packs).
- **RF-1.6 — `fileInput` substitution:** THE CLI SHALL expand `sliceCommand.fileInput` with the same substitution and safety rules as `changedCommand` (argv slots / structured expansion — not shell-string interpolation of filenames).
- **RF-1.7 — Partial selection:** A `--slice` run remains a non-full selection: THE CLI SHALL NOT write a Change Record receipt for that run (D-025 / existing `isFullSelection` rules), including when some sensors ran via `sliceCommand`.
- **RF-1.8 — Slice file scope source (D2 / P1):** THE slice file list SHALL be the union of paths changed since the **slice base commit** through the current worktree, computed like today's `--changed` resolver (`changed.ts`: merge-base/diff semantics against the provided base, plus staged, unstaged, and untracked) but with base = the controller-supplied slice-start SHA, **not** the branch merge-base alone.
  - Controllers that will execute a `sliceCommand` SHALL pass that SHA (normative flag: reuse `--base <sha>` with `--slice`, or an equally explicit slice-base option — one public flag, no silent default to branch-wide scope).
  - IF a **selected** sensor would execute `sliceCommand` and no slice base is provided, THAT sensor SHALL be non-pass with an explicit reason (e.g. `slice scope requires --base`) per RF-1.4 — THE CLI SHALL NOT reject the whole `awm sensors run --slice` invocation solely for a missing `--base`.
  - IF `--slice` is set and **no** selected sensor will execute `sliceCommand`, THE CLI SHALL behave as today (D-025 skip of bare `closureOnly`) **without** requiring `--base`, so published CLI remains compatible with registry skills that still call `--slice` alone until the companion lands.
  - Renames SHALL contribute the new path; deletes SHALL contribute the deleted path; paths outside `packageRoot` SHALL be dropped before `fileInput` extension filtering, with the drop visible in diagnostics.
  - THE design REJECTS “reuse branch-wide `--changed` as slice scope” as the default: that set grows every slice and would defeat scoped cache (D2).

### RF-2 — Digest cache isolation (scoped vs full) and closure reuse

- **RF-2.1 — Tests invalidate full-scope cache:** WHEN a sensor declares effective `inputs` that include test paths (or the project override does), THE CLI SHALL include those paths in the **full-scope** cache input digest so a test-only change misses that cache (#236 RF-2; no special-case tool).
- **RF-2.2 — Scoped cache is a separate key space (D3):** WHEN `--slice` executes `sliceCommand`, THE CLI MAY read/write a **scoped** cache entry whose key SHALL include at least: project/manifest identity, sensor id, `sensorFingerprint` components for the **sliceCommand** (not only the full command), effective `inputs` digest when present, **resolved slice file-scope digest**, and an explicit mode marker `scope=slice`. THE CLI SHALL write scoped entries only for `requestedScope === 'slice'` (or equivalent non-full slice selection). THE full gate (`requestedScope === 'full'`) SHALL NEVER read or write scoped entries, and a scoped pass SHALL NEVER surface as `cached: true` on a full-gate run. RED/mutation test required.
- **RF-2.3 — Full-gate cache unchanged (part E / D11):** WHEN QA, docs, or finishing invoke full-gate `awm sensors run` without `--no-cache`, reuse SHALL follow existing #236 full-scope rules only. IF an expensive sensor has effective `inputs` whose full-scope digest is unchanged, THE CLI SHALL report `cached: true` and SHALL NOT re-execute. Context-only edits outside those `inputs` (including `AGENTS.md`, `CONSTITUTION.md`, `CLAUDE.md`, and docs paths not listed) MUST NOT force re-execution. This RF is a **regression obligation** on behavior #236 already specifies when `inputs` exist; the delivery gap is authoring (RF-2.4), not a new cache algorithm.
- **RF-2.4 — Teaching inputs + sliceCommand (registry):** THE baseline `setup-sensors` skill and pack docs SHALL teach projects to declare `inputs` (code + tests, not agent context kernels) and optional `sliceCommand` for `mutation` and other slow `closureOnly` sensors. Packs MAY ship conservative defaults only when extension-bound and safe under #236 RF-1.9; otherwise project override remains the path. Runtime SHALL NOT invent globs.
- **RF-2.5 — No false green from cache:** THE CLI SHALL NOT claim `overall: pass` from cache unless every selected sensor that affects the verdict is executed or a valid cached pass for **that same scope mode** (#236 RF-6.1 + RF-2.2 isolation).
- **RF-2.6 — `--changed` still must not poison full cache:** Existing #236 RF-2.7 remains: `--changed` runs do not write full-gate cache entries. Scoped `sliceCommand` cache is additional and isolated per RF-2.2.

### RF-3 — Mechanical run evidence (separate from CycleEvidenceV1)

- **RF-3.1 — Dedicated run command (D6):** THE CLI SHALL provide `awm evidence run -- <argv…>` under the existing `awm evidence` namespace, **alongside** (not replacing) `awm evidence capture`. `capture` continues to write `CycleEvidenceV1` cycle observations. `run` writes **MechanicalRunEvidence** receipts (new schema id, distinct type and subdirectory).
- **RF-3.2 — Contrast surfaces (P3):** Two contrast paths, not one schema forced onto both:
  - **`awm evidence run`** SHALL write MechanicalRunEvidence with candidate identity (RF-3.6), argv (redacted), cwd, exit/result summary (bounded), duration, declared/resolved scope when applicable, integrity digest (RF-3.7).
  - **`awm sensors run` / `sliceCommand`** SHALL NOT write MechanicalRunEvidence. Reviewer contrast for sensors is the sensor result provenance already returned by the run (`cached: true` / fingerprint / digests / status). Re-running the same sensor argv under the same digests yields a cache hit without a second expensive execution. This avoids #240 read-only `.awm` writes during admission and matches fingerprint cache as the sensor evidence substrate.
- **RF-3.3 — Reviewer contrast (registry):** `review-cycle-v1` «Mechanical evidence» and reviewer prompts SHALL require: for arbitrary commands, consume MechanicalRunEvidence (preferably via `awm evidence verify`, RF-3.9) without re-execution only when verify reports `match`; for sensors, consume current `awm sensors run` provenance / cache hit equivalence without inventing a second receipt format. Prompts SHALL not conflate MechanicalRunEvidence with `CycleEvidenceV1` capsules.
- **RF-3.4 — Storage and privacy (D6):** MechanicalRunEvidence SHALL live under git-root `.awm/` in a dedicated runtime subtree (e.g. `.awm/evidence/runs/`), self-ignored / 0600 like other runtime evidence, **not** mixed into `CycleEvidenceV1` documents. Argv SHALL redact secret-shaped tokens (at least `--token=`, `--password=`, `--api-key=`, `AUTHORIZATION`-like values; exact patterns listed in CLI docs). Result summary SHALL be size-bounded and SHALL NOT persist full unbounded stdout/stderr bodies. Environment variables that affect tool output are **out of band**: receipts SHALL document that env is not part of equivalence; controllers needing env-sensitive gates MUST re-execute or pass env via explicit argv.
- **RF-3.5 — No Change Record coupling:** MechanicalRunEvidence alone SHALL NOT write or satisfy a Change Record verification receipt; only full-gate `awm sensors run` hygiene remains that authority.
- **RF-3.6 — Candidate identity (D7):** Candidate identity on a run receipt SHALL be `headCommit` (or empty if unavailable) **plus** a content digest of the relevant tree state used for the run (worktree input digest or equivalent over the paths that affect the obligation — HEAD alone is insufficient mid-edit). Reviewers SHALL treat receipts whose candidate digest does not match the current candidate as non-equivalent.
- **RF-3.7 — Integrity binding (D7):** Each MechanicalRunEvidence document SHALL carry an integrity digest over its canonical payload (same family as sensor receipts). Consumers SHALL reject tampered/edited files as absent (RF-E.1).
- **RF-3.8 — readOnly writes nothing (D8):** WHEN `runSensors({ readOnly: true })` or an equivalent read-only admission/observation path runs, THE CLI SHALL NOT write MechanicalRunEvidence receipts, scoped cache entries, or full cache entries (align with #236 RF-2.11 and #240 read-only `.awm` observation). RED regression required.
- **RF-3.9 — Mechanical verify command (P4):** THE CLI SHALL provide `awm evidence verify <receipt-path>` that validates integrity, recomputes the current candidate content digest, compares argv/cwd/scope fields as recorded, and exits with a machine-readable `match` or `mismatch` (reason named). Reviewers SHALL use this instead of recomputing digests by hand.

### RF-4 — Review-round cut (unattended-safe) + ledger CLI support

- **RF-4.1 — First round complete fix:** WHEN a role's first review verdict for the frozen candidate contains accepted findings, THE controller SHALL require correction of all of them before that role can be clean for the slice.
- **RF-4.2 — Re-review hard gate only:** WHEN a role is in a re-review (second or later round on the same slice obligation), THE controller SHALL open another fix/re-review loop only for **blocking** findings (RF-4.6). All other findings SHALL be recorded as **deferred** ledger entries (not discarded).
- **RF-4.3 — Round ceiling advances (owner D4):** AFTER three total rounds for a role on the same slice (first review + up to two further cycles), THE controller SHALL defer remaining **non-blocking** findings with durable reason `round-ceiling`, allow the slice to advance, and SHALL NOT BLOCK the unattended plan waiting for a live owner decision.
- **RF-4.4 — Blocking classes never defer:** IF any **blocking** finding (RF-4.6) remains open for the slice, THEN THE controller SHALL NOT advance that slice until it is fixed and revalidated, regardless of round ceiling. This includes security, externally false result, and red mechanical gate — not security alone.
- **RF-4.5 — QA consumes deferred:** BEFORE writing `awm-qa-complete`, `post-implementation-qa` SHALL mechanically list deferred ledger entries (CLI query) and resolve each (fix or explicitly accept with recorded rationale per existing QA rules). Missing deferred consumption blocks QA completion.
- **RF-4.6 — Blocking mapping on existing ledger fields (D5):** THE controller SHALL NOT invent a parallel taxonomy. Normative mapping:
  - **Blocking (never defer):** `class === 'seguridad'` OR `severity === 'blocker'` (covers externally false result and red mechanical gate as reviewer-emitted blockers).
  - **Deferrable on re-review / ceiling:** all other classes/severities.
  Ambiguous or missing `class`/`severity` on a finding that would otherwise defer SHALL be treated as blocking until clarified (fail closed — never silent drop).
- **RF-4.7 — Ledger deferred/resolved state (CLI, D5 / P5):** THE CLI ledger SHALL gain durable deferred/resolved support sufficient for mechanical QA: at minimum `awm ledger add` (or equivalent) can mark an entry deferred with a reason code (e.g. `round-ceiling`, `re-review-defer`); each entry SHALL carry a **stable unique `id`** (generated at add time); resolution SHALL target that `id` (`awm ledger resolve --id <id>`), not `--signature` alone (signature remains a recurrence grouping key and may repeat). Optional `--all-with-signature` may resolve every deferred-open entry sharing a signature, but the default single resolve is by `id`. `awm ledger list --deferred-open` SHALL report deferred && !resolved. Registry skills depend on these APIs; implementation is **CLI-owned**.

### RF-5 — Visible duration (durable clocks)

- **RF-5.1 — Report durations (D10):** WHEN a slice completes or blocks, THE controller measurement report SHALL include duration per mechanical gate and per review round alongside existing dispatch/round counts. Durations SHALL be derived from **durable timestamps**: MechanicalRunEvidence `duration` fields and/or ledger entry timestamps — **not** from LLM self-estimated wall clocks.
- **RF-5.2 — Warn threshold:** IF any single gate's duration is ≥ 30% of that slice's total measured time OR ≥ 20 minutes, THEN THE report SHALL include an explicit warning naming the gate and durations. Thresholds are fixed for this release (no median-of-prior-slices). Unavailable durations remain unavailable (do not invent).

### RF-6 — Lifecycle, honesty, delivery

- **RF-6.1 — Full gate + cache at closure (registry):** `post-implementation-qa`, `post-implementation-docs`, and `finishing-a-development-branch` SHALL continue to require no-flag full-gate `awm sensors run` with `overall: pass`. They SHALL treat valid full-scope `cached: true` sensor passes as acceptable evidence and SHALL NOT instruct `--no-cache` or `--slice` as closure evidence.
- **RF-6.2 — Tool-agnostic contract:** Normative requirements SHALL NOT hard-code a mutation tool or language; fixtures MAY use a stub command.
- **RF-6.3 — Serial publish:** Handoff SHALL publish the CLI to npm first; THE registry plan then raises `minCliVersion` / certification and lands packs+skills. Skills that name `sliceCommand`, `awm evidence run`, deferred ledger filters, or the new review cut SHALL declare the minimum CLI version.
- **RF-6.4 — Decision record (CLI):** THE CLI repo SHALL add `D-0xx` stating: structured `sliceCommand` extends D-025; scoped cache must not satisfy full gate; full gate remains sole Change Record / finish evidence; deferred review findings require QA consumption via ledger state; docs/finish must not force expensive re-exec when full-scope digests match.

### RF-E — Error and integrity

- **RF-E.1:** IF a MechanicalRunEvidence receipt fails validation (schema, symlink escape, size bound, integrity mismatch), THEN consumers SHALL treat it as absent and require real execution — never as a pass.
- **RF-E.2:** IF `sliceCommand` execution times out or exits without a usable result, THEN THE sensor outcome SHALL be non-pass under existing sensor failure kinds; THE CLI SHALL NOT write a reusable scoped or full cache entry for that run (#236 RF-2.4).
- **RF-E.3 — QA policy (registry) over CLI list API (P6):** IF deferred-open ledger entries exist and QA attempts to complete without listing/resolving them, THEN QA SHALL fail closed (no `awm-qa-complete`). Enforcement is **registry skill behavior** consuming `awm ledger list --deferred-open`; THE CLI SHALL expose that query accurately (RF-4.7) and SHALL NOT itself write `awm-qa-complete`.

## Architecture

### Unified run-evidence substrate (≠ CycleEvidenceV1)

```
Skills (SDD / QA / docs / finish)
        │  --slice --base <sliceSha> | full gate | run-receipt contrast | deferred ledger
        ▼
┌──────────────────────────────────────────────────────────────┐
│ CLI                                                           │
│  sensors run → select → scope resolve (RF-1.8)                │
│       │   closureOnly + sliceCommand on --slice               │
│       │   normal cmd on full gate                             │
│       │   scoped cache ⟂ full cache (RF-2.2)                  │
│       ▼                                                       │
│  evidence run  → MechanicalRunEvidence (new)                  │
│  evidence capture → CycleEvidenceV1 (unchanged, separate)     │
│  ledger add/list → deferred / resolved (RF-4.7)               │
└──────────────────────────────────────────────────────────────┘
        ▲
Packs / structured manifest: inputs, closureOnly, sliceCommand
```

### Component ownership

| Component | Repo | Primary RFs |
|---|---|---|
| `sliceCommand` parse, `--slice --base` scope, unresolvable vs empty | CLI | RF-1, RF-E.2 |
| Scoped vs full cache isolation; full-gate regression | CLI | RF-2.2, RF-2.3, RF-2.5–2.6 |
| `awm evidence run` / `verify` + MechanicalRunEvidence schema/integrity/redaction | CLI | RF-3.1, RF-3.4–3.9, RF-E.1 |
| Ledger deferred/resolved APIs (`--id`) | CLI | RF-4.7 |
| QA fail-closed on deferred-open | Registry | RF-E.3, RF-4.5 |
| CLI reference + D-0xx | CLI | RF-6.4 |
| Pack/schema/`setup-sensors` for inputs+sliceCommand | Registry | RF-2.4, RF-6.3 |
| `review-cycle-v1` cut/ceiling/defer mapping; prompts; duration rules | Registry | RF-4.1–4.6, RF-5 |
| QA deferred consumption; docs/finish cache wording | Registry | RF-4.5, RF-6.1, RF-E.3 (policy) |

### Key flows

1. **Slice:** Controller supplies slice-start SHA → `--slice --base <sha>` → non-`closureOnly` sensors + opted-in `sliceCommand` on slice file scope → MechanicalRunEvidence / scoped cache → reviews contrast receipts → RF-4; any blocking finding open ⇒ no advance; ceiling ⇒ defer non-blocking only and continue unattended.
2. **Closure:** After docs-only or AGENTS/CONSTITUTION edits, full gate hits **full-scope** cache when `inputs` exclude those paths (RF-2.3); Change Record still requires full-gate receipt hygiene.
3. **Publish:** CLI npm (including ledger deferred) → registry `minCliVersion` + content.

### Relationship to D-025 / #236 / existing evidence

- D-025 remains: `--slice` is never Change Record / finish evidence; full gate is.
- #236 digest cache remains the **full-scope** reuse engine; this design adds isolated **scoped** cache for `sliceCommand` and closes the authoring gap for mutation `inputs` (part E / D11).
- `changedCommand` / `--changed` stay a separate scoping mechanism and still must not poison the full-gate cache.
- `awm evidence capture` / Evidence Capsule v1 / `CycleEvidenceV1` remain the privacy-preserving cycle observation path; MechanicalRunEvidence is the command-run receipt path reviewers contrast for gate equivalence.

## Error and edge cases

| Case | Behavior |
|---|---|
| `closureOnly` without `sliceCommand` on `--slice` | Skip (today) |
| `--slice` without slice base | Unresolvable → non-pass (RF-1.4 / RF-1.8) |
| `sliceCommand` missing `fileInput` | Unresolvable → non-pass |
| Scope resolves empty after extensions | `skip` with reason; not `pass`; does not alone fail slice gate |
| Scoped cache hit presented to full gate | Forbidden (RF-2.2); RED test |
| Reviewer re-runs despite matching run receipt | Process defect; prompts forbid; duration warning makes waste visible |
| Round ceiling + open blocking finding | Slice does not advance (RF-4.4) |
| Round ceiling + only deferrable findings | Defer + advance (RF-4.3) |
| Docs-only after QA; mutation has `inputs` | Full-scope cache hit (RF-2.3) |
| Docs-only; mutation has no `inputs` | Always execute (#236 RF-1.4); setup-sensors teaches override |
| Invalid / tampered MechanicalRunEvidence | Treat as absent (RF-E.1) |
| `readOnly: true` sensor observation | No run-receipt or cache writes (RF-3.8) |

## Testing strategy (design-level)

- CLI: RED/GREEN for RF-1 selection matrix; unresolvable vs empty scope; `--base` required with `--slice`; RF-2.2 isolation mutation (scoped pass ≠ full cached); RF-2.3 regression with stub `inputs`; `awm evidence run` schema/integrity/redaction; RF-3.8 readOnly; ledger deferred add/list/resolve.
- Registry: section-scoped mutation-proof contracts for RF-4/RF-5 wording, blocking mapping, reviewer prompts naming MechanicalRunEvidence, QA deferred consumption, docs/finish cache language, pack schema `sliceCommand`.
- No billed-token claims; durations in fixtures come from stamped receipt/ledger fields.

## Implementation plans (after design approval)

1. **CLI plan** in this repo: `sliceCommand` + slice scope/`--base`, scoped cache isolation, MechanicalRunEvidence + `evidence run`, ledger deferred/resolved, docs + D-0xx.
2. **Registry plan** after observed npm CLI version: packs/skills/review-cycle/QA/docs/finish + `minCliVersion` / certification.

## Amendments — design audit PR #247 (D1–D11)

| ID | Mitigation in this document |
|---|---|
| D1 | RF-1.1/1.5/1.6: structured `sliceCommand` + `fileInput`; legacy text not pack path |
| D2 | RF-1.8: slice file scope from controller `--base` slice-start SHA; reject branch-wide default |
| D3 | RF-2.2: scoped cache key includes sliceCommand + scope digest + mode; full never reads scoped |
| D4 | RF-4.3/4.4: ceiling defers+advances; all three blocking classes never defer |
| D5 | RF-4.6 mapping + RF-4.7 CLI ledger deferred/resolved; ownership table updated |
| D6 | RF-3.1/3.4: MechanicalRunEvidence ≠ CycleEvidenceV1; redaction/bounds |
| D7 | RF-3.6/3.7: candidate = commit + content digest; integrity digest |
| D8 | RF-3.8: readOnly writes no run receipts/cache |
| D9 | RF-1.4: unresolvable → non-pass; empty → skip |
| D10 | RF-5.1: durations from ledger/receipt clocks only |
| D11 | RF-2.3 reframed as #236 regression; RF-2.4 remains the authoring gap |
| P1 | RF-1.8: `--base` required only for sensors executing `sliceCommand`; bare `--slice` stays compatible |
| P3 | RF-3.2: sensors contrast via cache/provenance; no MechanicalRunEvidence from `sensors run` |
| P4 | RF-3.9: `awm evidence verify` |
| P5 | RF-4.7: stable entry `id`; resolve by `--id` |
| P6 | RF-E.3 owned by registry QA; CLI exposes `--deferred-open` only |

## Self-review

- [x] Placeholder scan: no TBD/TODO left in normative sections.
- [x] Internal consistency: Approach 1 + A–E + D1–D11 match RF-1…RF-6 and architecture.
- [x] Scope: one initiative, two serial plans; #126 excluded; evidence capture preserved.
- [x] Ambiguity: slice base required; structured command; scoped⟂full cache; blocking trio; ledger CLI work; duration sources; empty vs unresolvable.
- [x] EARS/IDs: every RF above is EARS-shaped and 1:1 testable.

## Approval

Owner approved brainstorming sections (purpose, requirements, architecture) and directed write-out on 2026-11-06. Design audit D1–D11 mitigated in this revision. **Pending:** explicit owner approval of this amended design before `writing-plans`.
