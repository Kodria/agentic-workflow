# Slice cost control — CLI plan (#246)
<!-- awm-qa-complete: 2026-11-06 -->
<!-- awm-docs-complete: 2026-11-06 -->
<!-- awm-retro-complete: 2026-11-06 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship CLI support for structured `sliceCommand`, conditional slice file-scope via `--slice` + `--base` only when executing `sliceCommand`, scoped⟂full cache isolation, MechanicalRunEvidence + `awm evidence run`/`verify`, and ledger deferred/resolved-by-id — so the registry companion can land skills/packs against a published CLI without breaking today's bare `--slice` callers.

**Architecture:** Extend pack/variant `StructuredCommand` with optional `sliceCommand` (parallel to `changedCommand`). Bare `--slice` stays D-025-compatible; `--base` is required only for sensors that will run `sliceCommand`. Scoped cache keys never satisfy full gate. MechanicalRunEvidence is written only by `awm evidence run` (sensors contrast via fingerprint/`cached`); `awm evidence verify` is the mechanical reviewer check. Ledger entries get stable `id`; resolve by `--id`. Docs + D-026 without prose-mention contracts (#239). Registry skills/packs are **out of this plan** (companion after npm), including RF-E.3 QA fail-closed.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, existing `picomatch` digests / result-cache.

**Change Record:** `slice-cost-control`

**Criterios de aceptación:**
- `awm sensors run --slice` without `--base` and without any `sliceCommand` matches 9.22.x skip behavior (compat)
- `awm sensors run --slice --base <sha>` runs a `closureOnly`+`sliceCommand` sensor scoped to files since that SHA; missing `--base` when `sliceCommand` would run → that sensor non-pass (command still runs)
- Empty resolved scope after extension filter → `skip` (not `pass`)
- A scoped cache hit never appears as `cached: true` on a subsequent full-gate run (mutation RED)
- `awm evidence run` writes MechanicalRunEvidence; `awm evidence verify -- <argv>` reports match/mismatch (omit argv → mismatch); sensors do not write run receipts; `readOnly` writes neither receipts nor cache
- `awm ledger add --deferred` assigns stable `id`; `resolve --id` resolves one of two same-signature deferred entries; `list --deferred-open` works
- D-026 exists; CLI reference stays in sync with Commander via `cli-reference-matches-commander`

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** `docs/plans/2026-11-06-slice-cost-control-design.md` (D1–D11 + plan audit P1–P6). Companion registry plan after this CLI is on npm.

**File map:** `compatibility/{contract,types,manifest}.ts`; `prepare.ts`; `changed.ts`; `run.ts`/`index.ts`/`types.ts`/`result-cache.ts`; `core/evidence/{mechanical-run,store}.ts` + `commands/evidence/index.ts`; `core/ledger/{types,store}.ts` + `commands/ledger/index.ts`; `docs/cli-reference.md`; `docs/decisions.md`; focused Jest under `cli/tests/`.

**Dispatch decision:** owner did not select `awm-routed`; emit `compact-slices/v1` / `proveedor-nativo`.

**Out of plan (registry companion):** RF-2.4, RF-3.3 prompts, RF-4.1–4.6 skill text, RF-5.2 warn policy text, RF-6.1/6.3, **RF-E.3** (QA fail-closed on deferred-open — skills consume CLI `--deferred-open`).

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "slice-cost-control-cli",
  "requirements": [
    "RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8",
    "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.5", "RF-2.6",
    "RF-3.1", "RF-3.2", "RF-3.4", "RF-3.5", "RF-3.6", "RF-3.7", "RF-3.8", "RF-3.9",
    "RF-4.7",
    "RF-5.1",
    "RF-6.2", "RF-6.4",
    "RF-E.1", "RF-E.2"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-11-06-slice-cost-control-design.md",
      "locator": "## Requirements",
      "fact": "Amended D1–D11 and P1–P6: --base only when executing sliceCommand; sensors contrast via cache not MechanicalRunEvidence; evidence verify; ledger resolve by id; RF-E.3 registry-owned."
    },
    {
      "id": "SRC-CONTRACT",
      "path": "cli/src/commands/sensors/compatibility/contract.ts",
      "locator": "function parseVariant",
      "fact": "Variant allowlist includes changedCommand with mandatory fileInput; no sliceCommand today."
    },
    {
      "id": "SRC-STRUCT-TYPES",
      "path": "cli/src/commands/sensors/compatibility/types.ts",
      "locator": "export type StructuredCommand",
      "fact": "StructuredCommand supports optional fileInput { placeholder:'{files}', extensions }."
    },
    {
      "id": "SRC-PREPARE",
      "path": "cli/src/commands/sensors/prepare.ts",
      "locator": "expandFileInput",
      "fact": "Structured changedCommand expands {files} via expandFileInput; legacy changedCmd uses applyChangedCmd."
    },
    {
      "id": "SRC-CHANGED",
      "path": "cli/src/commands/sensors/changed.ts",
      "locator": "export function changedFiles",
      "fact": "Union of merge-base HEAD base diff + staged + unstaged + untracked; errors on bad ref / Windows-unsafe names for legacy shell path."
    },
    {
      "id": "SRC-RUN",
      "path": "cli/src/commands/sensors/run.ts",
      "locator": "function sliceSkipExecution",
      "fact": "Today --slice always skips closureOnly; requestedScope is only changed|full; writeCache requires requestedScope==='full'."
    },
    {
      "id": "SRC-INDEX",
      "path": "cli/src/commands/sensors/index.ts",
      "locator": ".option('--slice'",
      "fact": "--slice and --base exist; --base documented for --changed only."
    },
    {
      "id": "SRC-CACHE",
      "path": "cli/src/commands/sensors/result-cache.ts",
      "locator": "export function computeSensorFingerprint",
      "fact": "Fingerprint includes changedCommand; no sliceCommand/scope mode marker yet."
    },
    {
      "id": "SRC-EVIDENCE",
      "path": "cli/src/commands/evidence/index.ts",
      "locator": "evidence.command('capture')",
      "fact": "awm evidence capture writes CycleEvidenceV1 via core/evidence/store; no run subcommand."
    },
    {
      "id": "SRC-EVIDENCE-TYPES",
      "path": "cli/src/core/evidence/types.ts",
      "locator": "export interface CycleEvidenceV1",
      "fact": "CycleEvidenceV1 schema:1 cycle observations; must not be overloaded for command-run receipts."
    },
    {
      "id": "SRC-LEDGER-TYPES",
      "path": "cli/src/core/ledger/types.ts",
      "locator": "export interface LedgerEntry",
      "fact": "LedgerEntry has class/severity/signature; no deferred/resolved status fields."
    },
    {
      "id": "SRC-LEDGER-CMD",
      "path": "cli/src/commands/ledger/index.ts",
      "locator": ".command('add')",
      "fact": "add/list/recurring/archive only; list prints all entries as JSON."
    },
    {
      "id": "SRC-DECISIONS",
      "path": "docs/decisions.md",
      "locator": "## D-025",
      "fact": "D-025 defines --slice+closureOnly cycle; next decision is D-026 for this extension."
    },
    {
      "id": "SRC-CLI-DOCS",
      "path": "docs/cli-reference.md",
      "locator": "### Inputs and closureOnly",
      "fact": "Documents closureOnly/--slice; no sliceCommand or evidence run yet."
    },
    {
      "id": "SRC-CLI-MATCH",
      "path": "cli/tests/structural/cli-reference-matches-commander.test.ts",
      "locator": "compares the docs against the Commander tree",
      "fact": "Existing structural gate: every documented awm command/flag must exist in Commander (#239 — no prose-mention contracts)."
    }
  ],
  "commands": [
    {
      "id": "CMD-SCHEMA",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/compatibility/contract-slice-command.test.ts"],
      "covers": ["RF-1.5", "RF-1.6"]
    },
    {
      "id": "CMD-SLICE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/run-slice-command.test.ts"],
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.7", "RF-1.8", "RF-E.2"]
    },
    {
      "id": "CMD-SCOPED-CACHE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/run-slice-cache-isolation.test.ts"],
      "covers": ["RF-2.1", "RF-2.2", "RF-2.3", "RF-2.5", "RF-2.6"]
    },
    {
      "id": "CMD-EVIDENCE-RUN",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/evidence/run.test.ts", "tests/commands/evidence/verify.test.ts", "tests/core/evidence/mechanical-run.test.ts"],
      "covers": ["RF-3.1", "RF-3.2", "RF-3.4", "RF-3.5", "RF-3.6", "RF-3.7", "RF-3.8", "RF-3.9", "RF-5.1", "RF-E.1"]
    },
    {
      "id": "CMD-LEDGER-DEFER",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/ledger/deferred.test.ts", "tests/core/ledger/deferred-parse.test.ts"],
      "covers": ["RF-4.7"]
    },
    {
      "id": "CMD-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/cli-reference-matches-commander.test.ts", "tests/structural/slice-cost-control-decision-id.test.ts"],
      "covers": ["RF-6.2", "RF-6.4"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-1.5", "RF-2.2", "RF-3.1", "RF-4.7"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Parse variant sliceCommand",
      "requirements": ["RF-1.5", "RF-1.6"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN", "SRC-CONTRACT", "SRC-STRUCT-TYPES"],
      "redCommands": ["CMD-SCHEMA", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-SCHEMA", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S2",
      "title": "Slice scope selection and sliceCommand execution",
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.7", "RF-1.8", "RF-E.2"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN", "SRC-CHANGED", "SRC-PREPARE", "SRC-RUN", "SRC-INDEX"],
      "redCommands": ["CMD-SLICE", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-SLICE", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S3",
      "title": "Scoped versus full cache isolation",
      "requirements": ["RF-2.1", "RF-2.2", "RF-2.3", "RF-2.5", "RF-2.6"],
      "dependsOn": ["S2"],
      "sectionAnchor": "slice-s3",
      "sources": ["SRC-DESIGN", "SRC-CACHE", "SRC-RUN"],
      "redCommands": ["CMD-SCOPED-CACHE", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-SCOPED-CACHE", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S4",
      "title": "MechanicalRunEvidence and awm evidence run",
      "requirements": ["RF-3.1", "RF-3.2", "RF-3.4", "RF-3.5", "RF-3.6", "RF-3.7", "RF-3.8", "RF-3.9", "RF-5.1", "RF-E.1"],
      "dependsOn": ["S2"],
      "sectionAnchor": "slice-s4",
      "sources": ["SRC-DESIGN", "SRC-EVIDENCE", "SRC-EVIDENCE-TYPES"],
      "redCommands": ["CMD-EVIDENCE-RUN", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-EVIDENCE-RUN", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S5",
      "title": "Ledger deferred and resolved state",
      "requirements": ["RF-4.7"],
      "dependsOn": [],
      "sectionAnchor": "slice-s5",
      "sources": ["SRC-DESIGN", "SRC-LEDGER-TYPES", "SRC-LEDGER-CMD"],
      "redCommands": ["CMD-LEDGER-DEFER", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-LEDGER-DEFER", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S6",
      "title": "CLI reference and D-026",
      "requirements": ["RF-6.2", "RF-6.4"],
      "dependsOn": ["S2", "S3", "S4", "S5"],
      "sectionAnchor": "slice-s6",
      "sources": ["SRC-DESIGN", "SRC-CLI-DOCS", "SRC-CLI-MATCH", "SRC-DECISIONS"],
      "redCommands": ["CMD-DOCS"],
      "greenCommands": ["CMD-DOCS"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-SCHEMA", "CMD-SLICE", "CMD-SCOPED-CACHE", "CMD-EVIDENCE-RUN", "CMD-LEDGER-DEFER", "CMD-DOCS", "CMD-TYPECHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Parse variant sliceCommand

#### Surfaces
Own RF-1.5–1.6. Extend pack variant parse so `sliceCommand` is optional `StructuredCommand` requiring `fileInput` when present (same rules as `changedCommand`). Types in `compatibility/types.ts`. Grouping: schema-only; no runtime selection yet.

#### Implementation
1. RED — new `cli/tests/commands/sensors/compatibility/contract-slice-command.test.ts`:
   - accept variant with `sliceCommand` + `fileInput` whose token is `{files}` + exactly one `{files}` arg;
   - reject `sliceCommand` without `fileInput`;
   - reject `fileInput` token ≠ `{files}`;
   - reject unknown field beside allowlist;
   - assert `parseVariant` result includes `sliceCommand` object.
   Run CMD-SCHEMA → expect FAIL (field not allowed / undefined).
2. Implementation facts:
   - Add `sliceCommand?: StructuredCommand` to `SensorVariant` in `cli/src/commands/sensors/compatibility/types.ts`.
   - In `parseVariant` (`contract.ts`), allow `'sliceCommand'` in `fields(...)`; parse via `parseStructuredCommand`; IF present and missing `fileInput`, `invalid(...)` mirroring `changedCommand`.
   - Do **not** add pack-default `sliceCmd` shell text to v2 packs in this plan.
3. GREEN — CMD-SCHEMA + CMD-TYPECHECK.

#### Edge cases
Both `changedCommand` and `sliceCommand` may coexist. Omitted `sliceCommand` remains undefined (RF-1.2 skip path later).

#### Evidence
CMD-SCHEMA, CMD-TYPECHECK. Spec + code-quality reviews on parse allowlist only.

#### Fallback
If pack schema in registry must change first for local fixtures: keep CLI parse green with inline fixture JSON in tests; registry schema bump is companion plan. Public-contract amend only if `parseStructuredCommand` cannot be reused.

<a id="slice-s2"></a>
### Slice S2: Slice scope selection and sliceCommand execution

#### Surfaces
Own RF-1.1–1.4, RF-1.7–1.8, RF-E.2. Wire `--slice` so bare calls stay 9.22.x-compatible; require `--base` **only** when a selected sensor will execute `sliceCommand`. Resolve slice files via `changedFiles`/`changed.ts`, expand via `expandFileInput`, set `requestedScope='slice'` for those executions, keep Change Record non-full. Files: `index.ts`, `run.ts`, `prepare.ts`, `types.ts`.

#### Implementation
1. RED — `cli/tests/commands/sensors/run-slice-command.test.ts` (tmp repo + stub pack fixture):
   - `--slice` without `--base` and **no** `sliceCommand` anywhere selected → same skip-of-closureOnly behavior as 9.22.x; command exit not a missing-base error (P1 / RF-1.8);
   - `closureOnly` + `sliceCommand` + `--slice` **without** `--base` → that sensor non-pass with reason naming missing base; other sensors still run (RF-1.4 / RF-1.8);
   - `closureOnly` + no `sliceCommand` + `--slice --base` → synthetic skip reason contains `closureOnly` (RF-1.2);
   - `closureOnly` + `sliceCommand` + `--slice --base <sha>` with two matching files → argv contains those files; status not skip (RF-1.1);
   - full gate (no `--slice`) uses normal `command`, not `sliceCommand` (RF-1.3);
   - resolved empty after extensions → status `skipped` with empty-scope reason; sensor is not `pass` (RF-1.4);
   - bad base ref when `sliceCommand` would run → that sensor non-pass (unresolvable);
   - `--slice` ⇒ `isFullSelection` false / no Change Record receipt (RF-1.7);
   - timeout/crash path does not mark `pass` (RF-E.2).
   CMD-SLICE RED.
2. Implementation facts:
   - Do **not** require `opts.base` at the commander/`index.ts` level for every `--slice`.
   - `run.ts`: IF `opts.slice` and the sensor has usable `sliceCommand`, require base; missing → synthetic non-pass for that sensor only. IF closureOnly and no `sliceCommand`, keep `sliceSkipExecution` (today). IF executing `sliceCommand`, set that execution's `requestedScope='slice'`, resolve with `changedFiles(cwd, base)`, filter extensions, `expandFileInput`. Empty files → skip (not pass).
   - Document `--base` as slice-start SHA when used with `--slice`+`sliceCommand` (also keeps `--changed` meaning).
   - Paths outside packageRoot dropped before expansion; renames/deletes inherit `changedFiles`.
3. GREEN — CMD-SLICE + CMD-TYPECHECK.

#### Edge cases
Combining `--slice` with `--changed` in one invocation: reject with clear error. `--slice --fast` keeps existing intersection for non-closure sensors; `sliceCommand` path still applies to opted-in closureOnly sensors when base is present.

#### Evidence
CMD-SLICE, CMD-TYPECHECK. Reviews must confirm bare `--slice` compat and no shell-string filename interpolation.

#### Fallback
Security: structured argv only for `sliceCommand`. If `requestedScope` union churn breaks callers, amend types in one commit and re-run CMD-SLICE.

<a id="slice-s3"></a>
### Slice S3: Scoped versus full cache isolation

#### Surfaces
Own RF-2.1, RF-2.2, RF-2.3, RF-2.5, RF-2.6. Extend fingerprint/cache key with `scope=slice`, `sliceCommand`, and resolved file-scope digest. Full gate never reads/writes scoped entries. Files: `result-cache.ts`, `run.ts`, `inputs-digest.ts` as needed.

#### Implementation
1. RED — `cli/tests/commands/sensors/run-slice-cache-isolation.test.ts`:
   - After a successful `--slice --base` run with `inputs` covering stub sources+tests, second identical slice run reports `cached: true` for that sensor (scoped hit) (RF-2.2 / RF-2.1);
   - Changing only a test file under `inputs` forces scoped miss (RF-2.1);
   - After scoped pass, a full-gate run of the same sensor MUST execute (or hit a **full** cache entry), never report a hit sourced from the scoped entry — assert fingerprint/mode differs; mutate implementation to share keys and prove RED (RF-2.2);
   - Full-gate with unchanged `inputs` still hits full cache per #236 (RF-2.3 regression);
   - `--changed` still does not write full cache (RF-2.6 / #236 RF-2.7);
   - `overall: pass` requires every selected sensor executed or valid same-mode cache (RF-2.5).
   CMD-SCOPED-CACHE RED.
2. Implementation facts:
   - Include in scoped fingerprint: `mode: 'slice'`, serialized `sliceCommand`, digest of sorted resolved slice file paths, plus existing live versions / inputs digest when present.
   - `writeCache` for scoped entries only when `requestedScope === 'slice'`; full writes only when `requestedScope === 'full'`.
   - Lookup: full runs query only full keys; slice runs query only slice keys.
3. GREEN — CMD-SCOPED-CACHE + CMD-TYPECHECK.

#### Edge cases
`readOnly` / `useCache:false` / `--no-cache` / `ignoreBaseline`: no scoped or full cache IO (align RF-3.8 / #236 RF-2.11). Invalid cache file → miss.

#### Evidence
CMD-SCOPED-CACHE, CMD-TYPECHECK. Spec review must cite the RED isolation mutation.

#### Fallback
Security/public-contract: if isolation cannot be proven, do **not** enable scoped cache writes; keep slice always-execute until amended — never ship shared keys.

<a id="slice-s4"></a>
### Slice S4: MechanicalRunEvidence and awm evidence run

#### Surfaces
Own RF-3.1–3.2, RF-3.4–3.9, RF-5.1, RF-E.1. New schema + store under `.awm/evidence/runs/`; `awm evidence run` writes receipts; `awm evidence verify` contrasts them; `capture` untouched. **Sensors do not emit MechanicalRunEvidence** (RF-3.2 / P3) — contrast is fingerprint/`cached`.

#### Implementation
1. RED — `tests/core/evidence/mechanical-run.test.ts` + `tests/commands/evidence/run.test.ts` + `verify.test.ts`:
   - validate schema with candidate `{ headCommit, contentDigest }`, redacted argv, cwd, exitCode, durationMs, integrityDigest; reject CycleEvidence shape / missing integrity (RF-3.1, RF-3.6, RF-3.7, RF-E.1);
   - argv redacts `--token=secret` (RF-3.4); result summary size-bounded (RF-3.4);
   - `awm evidence run -- …` writes under `.awm/evidence/runs/` with durationMs ≥ 0 (RF-5.1); does not write CycleEvidenceV1;
   - `awm evidence verify <receipt> -- <expected argv…>` → `match` on unchanged tree/cwd + matching expected argv; → `mismatch` after contentDigest-affecting edit or argv change; omit expected argv → `mismatch` fail-closed (RF-3.9 / P7);
   - after a normal (non-readOnly) `sensors run --slice` / full gate, **zero** new MechanicalRunEvidence files (RF-3.2);
   - `runSensors({ readOnly: true })` writes zero run receipts and zero cache files (RF-3.8);
   - `evidence run` alone does not create Change Record receipt (RF-3.5).
   CMD-EVIDENCE-RUN RED.
2. Implementation facts:
   - `cli/src/core/evidence/mechanical-run.ts`: types, validate, integrity, contentDigest helper shared by run+verify.
   - Store under `.awm/evidence/runs/` with `*` gitignore / 0600.
   - Register `evidence run` and `evidence verify <path> [-- <expected argv…>]`; verify prints JSON `{ status: 'match'|'mismatch', reason? }` and exits 0 only on match; missing expected argv is mismatch (P7).
   - Env out of equivalence (documented).
3. GREEN — CMD-EVIDENCE-RUN + CMD-TYPECHECK.

#### Edge cases
Non-zero command exit still writes a receipt with that exitCode. Verify on tampered integrity → mismatch/absent (RF-E.1).

#### Evidence
CMD-EVIDENCE-RUN, CMD-TYPECHECK.

#### Fallback
Security: fail closed on symlink store paths. If commander `--` parsing is awkward on Windows, use explicit `--cmd` JSON argv array — amend and revalidate.

<a id="slice-s5"></a>
### Slice S5: Ledger deferred and resolved state

#### Surfaces
Own RF-4.7 only (RF-E.3 is registry QA). Extend `LedgerEntry` with stable `id` + deferred/resolved + `awm ledger add/list/resolve --id` so QA can list deferred-open and resolve one entry at a time even when signatures collide (P5).

#### Implementation
1. RED — `tests/core/ledger/deferred-parse.test.ts` + `tests/commands/ledger/deferred.test.ts` (HOME/tmp isolated):
   - parse requires/accepts `id: string` on new entries; optional `deferred` / `resolved`; legacy entries without deferred/resolved still parse; reject bad `resolved.how` (RF-4.7);
   - `awm ledger add ... --deferred round-ceiling` assigns unique `id` and deferred.at;
   - two deferred entries with the **same** `--signature` get distinct ids; `resolve --id <first>` resolves only the first; `--deferred-open` still lists the second (P5);
   - `list --deferred-open` returns only deferred && !resolved;
   - `resolve --id` unknown → non-zero; optional `--all-with-signature` may resolve every deferred-open sharing a signature (explicit, not default).
   CMD-LEDGER-DEFER RED.
2. Implementation facts:
   - Extend `LedgerEntry` (`id`, deferred, resolved); generate id at add (e.g. ulid/uuid or `ts+nonce`).
   - `store.ts`: `listDeferredOpen`, `resolveById`, optional `resolveAllWithSignature`.
   - Prefer append-only resolution records folded by id if in-place rewrite is unsafe.
3. GREEN — CMD-LEDGER-DEFER + CMD-TYPECHECK.

#### Edge cases
Double-resolve same id → error. Existing `--desc` anti-test denylist unchanged. Signature alone never silently resolves multiple entries.

#### Evidence
CMD-LEDGER-DEFER, CMD-TYPECHECK.

#### Fallback
If id generation needs a pinned dependency, prefer zero-dep timestamp+random hex first; amend only if collision tests fail.

<a id="slice-s6"></a>
### Slice S6: CLI reference and D-026

#### Surfaces
Own RF-6.2, RF-6.4. Update `docs/cli-reference.md` and add `D-026`. **No prose-mention contracts** (P2 / #239). Objective gates only: Commander parity + D-026 id presence. Spec review owns narrative correctness.

#### Implementation
1. RED — reuse `cli/tests/structural/cli-reference-matches-commander.test.ts` (fails if reference documents flags/commands that Commander lacks). After documenting new surfaces, temporarily omit Commander registration → RED; restore → GREEN.
   - Add thin `tests/structural/slice-cost-control-decision-id.test.ts`: `docs/decisions.md` contains heading `## D-026` and a table link `[D-026](#d-026)` (objective id check only — no phrase matching of policy prose).
   - Do **not** add `slice-cost-control-docs-contract.test.ts` prose greps.
   CMD-DOCS RED when D-026 heading absent / when reference lists `evidence verify` before the command exists.
2. Write operator docs for `sliceCommand`, conditional `--base`, empty vs unresolvable, scoped cache isolation, `evidence run`/`verify`, ledger `--deferred`/`resolve --id`/`--deferred-open`, tool-agnostic wording. Add D-026 decision section + table row (extends D-025; scoped⟂full; deferred QA via ledger; full gate sole Change Record evidence).
3. GREEN — CMD-DOCS. Spec review reads D-026 prose against RF-6.4.

#### Edge cases
`cli-reference-matches-commander` is the sole reference mechanical gate; rewriting docs without inventing flags stays GREEN.

#### Evidence
CMD-DOCS + specification review of D-026 narrative.

#### Fallback
If D-026 id is taken, use next free id and amend this plan + decision-id test, then revalidate.

## Coverage matrix

| Requirement | Slice | Test command |
|---|---|---|
| RF-1.5, RF-1.6 | S1 | CMD-SCHEMA |
| RF-1.1–1.4, RF-1.7–1.8, RF-E.2 | S2 | CMD-SLICE |
| RF-2.1, RF-2.2, RF-2.3, RF-2.5, RF-2.6 | S3 | CMD-SCOPED-CACHE |
| RF-3.1–3.2, RF-3.4–3.9, RF-5.1, RF-E.1 | S4 | CMD-EVIDENCE-RUN |
| RF-4.7 | S5 | CMD-LEDGER-DEFER |
| RF-6.2, RF-6.4 | S6 | CMD-DOCS |

Forward: every CLI-owned design RF in the manifest has ≥1 slice and ≥1 command. Backward: no orphan commands. Registry: RF-2.4, RF-3.3, RF-4.1–4.6, RF-5.2, RF-6.1, RF-6.3, **RF-E.3**.

## Amendments — plan audit P1–P6

| ID | Change |
|---|---|
| P1 | S2: bare `--slice` compat; `--base` only when executing `sliceCommand` |
| P2 | S6/CMD-DOCS: Commander match + D-026 id only; no prose contracts |
| P3 | S4/design RF-3.2: sensors do not write MechanicalRunEvidence |
| P4 | S4: `awm evidence verify` (RF-3.9) |
| P5 | S5: stable `id`; resolve by `--id` |
| P6 | RF-E.3 moved to registry companion handoff |
| P7 | S4/RF-3.9: verify requires expected argv (after `--`); omit → mismatch fail-closed (spec FAIL on f875497e) |

## Handoff

1. `awm plan validate` this file → admit → implement slices → finish with Change Record `slice-cost-control` → merge → **npm publish**.
2. Registry companion (`minCliVersion` = published): RF-2.4, RF-3.3, RF-4.1–4.6, RF-5.2, RF-6.1, RF-6.3, and **RF-E.3** (QA must `list --deferred-open` and fail closed if any remain).
