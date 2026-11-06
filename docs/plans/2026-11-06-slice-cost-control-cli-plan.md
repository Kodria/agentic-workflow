# Slice cost control — CLI plan (#246)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship CLI support for structured `sliceCommand`, slice file-scope via `--slice --base`, scoped⟂full cache isolation, MechanicalRunEvidence + `awm evidence run`, and ledger deferred/resolved state — so the registry companion can land skills/packs against a published CLI.

**Architecture:** Extend pack/variant `StructuredCommand` with optional `sliceCommand` (parallel to `changedCommand`). When `--slice` is set, require `--base <sliceStartSha>`, resolve the slice file list like `changed.ts` against that base, run `sliceCommand` instead of skipping `closureOnly`, and use a **separate** scoped cache key that full gate never reads. Add MechanicalRunEvidence under `.awm/evidence/runs/` via `awm evidence run`, distinct from `CycleEvidenceV1`. Extend ledger JSONL with deferred/resolved fields + CLI flags. Docs + D-026. Registry skills/packs are **out of this plan** (companion after npm).

**Tech Stack:** TypeScript CLI (`cli/`), Jest, existing `picomatch` digests / result-cache.

**Change Record:** `slice-cost-control`

**Criterios de aceptación:**
- `awm sensors run --slice --base <sha>` runs a `closureOnly` sensor that declares variant `sliceCommand`, scoped to files since that SHA; without `sliceCommand` still skips
- Empty resolved scope after extension filter → `skip` (not `pass`); missing `--base` with `--slice` → non-pass / fail-closed
- A scoped cache hit never appears as `cached: true` on a subsequent full-gate run (mutation RED)
- `awm evidence run -- …` writes MechanicalRunEvidence with integrity digest; `awm evidence capture` unchanged; `readOnly` sensor runs write neither run receipts nor cache
- `awm ledger add --deferred <reason>` and `awm ledger resolve` / `list --deferred-open` round-trip; QA can query deferred-open mechanically
- D-026 recorded; CLI reference documents `sliceCommand`, `--slice --base`, evidence run, scoped cache isolation

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** `docs/plans/2026-11-06-slice-cost-control-design.md` (audit D1–D11 amended). Companion registry plan after this CLI is on npm.

**File map:** `compatibility/{contract,types,manifest}.ts`; `prepare.ts`; `changed.ts` (reuse resolver); `run.ts`/`index.ts`/`types.ts`/`result-cache.ts`; `core/evidence/{types,store,run}.ts` + `commands/evidence/index.ts`; `core/ledger/{types,store}.ts` + `commands/ledger/index.ts`; `docs/cli-reference.md`; `docs/decisions.md`; focused Jest suites under `cli/tests/`.

**Dispatch decision:** owner did not select `awm-routed`; emit `compact-slices/v1` / `proveedor-nativo`.

**Out of plan (registry companion):** RF-2.4, RF-3.3 prompts, RF-4.1–4.6 skill text, RF-5.2 warn policy text, RF-6.1/6.3.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "slice-cost-control-cli",
  "requirements": [
    "RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8",
    "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.5", "RF-2.6",
    "RF-3.1", "RF-3.2", "RF-3.4", "RF-3.5", "RF-3.6", "RF-3.7", "RF-3.8",
    "RF-4.7",
    "RF-5.1",
    "RF-6.2", "RF-6.4",
    "RF-E.1", "RF-E.2", "RF-E.3"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-11-06-slice-cost-control-design.md",
      "locator": "## Requirements",
      "fact": "Amended design D1–D11: variant-parallel sliceCommand+fileInput; --slice requires slice base; scoped cache isolated from full; MechanicalRunEvidence ≠ CycleEvidenceV1; ledger deferred CLI-owned; blocking trio is registry mapping consuming ledger fields."
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
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/evidence/run.test.ts", "tests/core/evidence/mechanical-run.test.ts"],
      "covers": ["RF-3.1", "RF-3.2", "RF-3.4", "RF-3.5", "RF-3.6", "RF-3.7", "RF-3.8", "RF-5.1", "RF-E.1"]
    },
    {
      "id": "CMD-LEDGER-DEFER",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/ledger/deferred.test.ts", "tests/core/ledger/deferred-parse.test.ts"],
      "covers": ["RF-4.7", "RF-E.3"]
    },
    {
      "id": "CMD-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/slice-cost-control-docs-contract.test.ts", "tests/structural/slice-cost-control-decision-contract.test.ts"],
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
      "requirements": ["RF-3.1", "RF-3.2", "RF-3.4", "RF-3.5", "RF-3.6", "RF-3.7", "RF-3.8", "RF-5.1", "RF-E.1"],
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
      "requirements": ["RF-4.7", "RF-E.3"],
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
      "sources": ["SRC-DESIGN", "SRC-CLI-DOCS", "SRC-DECISIONS"],
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
Own RF-1.1–1.4, RF-1.7–1.8, RF-E.2. Wire `--slice` + required `--base` to resolve slice files via `resolveChangedFiles`/`changed.ts`, prepare `sliceCommand` through `expandFileInput`, set `requestedScope` to a new `'slice'` mode for those runs, keep Change Record non-full (`isFullSelection` false). Files: `index.ts`, `run.ts`, `prepare.ts`, `types.ts`.

#### Implementation
1. RED — `cli/tests/commands/sensors/run-slice-command.test.ts` (tmp repo + stub sensor pack fixture):
   - `--slice` without `--base` → validation error / non-zero (RF-1.8 / RF-1.4 unresolvable);
   - `closureOnly` + no `sliceCommand` + `--slice --base` → synthetic skip reason contains `closureOnly` (RF-1.2);
   - `closureOnly` + `sliceCommand` + `--slice --base <sha>` with two matching files → command argv contains those files; status not skip (RF-1.1);
   - full gate (no `--slice`) uses normal `command`, not `sliceCommand` (RF-1.3);
   - resolved empty after extensions → status `skipped` with reason naming empty scope; overall may still pass other sensors; that sensor is not `pass` (RF-1.4 empty);
   - bad base ref → non-pass / error reason (unresolvable);
   - `--slice` ⇒ `isFullSelection` false / no Change Record receipt write (RF-1.7);
   - timeout/crash path does not mark `pass` (RF-E.2).
   CMD-SLICE RED.
2. Implementation facts:
   - `index.ts`: when `opts.slice` is true, require `opts.base`; document `--base` as slice-start SHA for `--slice` (and keep existing meaning for `--changed`).
   - `run.ts`: IF `opts.slice`, set `requestedScope = 'slice'` (do not leave it as `'full'`). IF closureOnly and no effective `sliceCommand`, keep `sliceSkipExecution`. IF closureOnly and `sliceCommand`, resolve files with `changedFiles(cwd, base)` (same helper as `--changed`), filter by `sliceCommand.fileInput.extensions`, then prepare structured command via `expandFileInput`. Empty files → synthetic skip (not pass). Resolve error → synthetic inconclusive/fail with reason (not pass).
   - Paths outside packageRoot: drop before expansion; include count in reason/diagnostics.
   - Renames/deletes: inherit `resolveChangedFiles` behavior (new path / deleted path).
3. GREEN — CMD-SLICE + CMD-TYPECHECK.

#### Edge cases
Combining `--slice` with `--changed` in one invocation: reject with clear error (do not invent intersection). `--slice --fast` keeps existing intersection rules for non-closure sensors; `sliceCommand` path still applies to opted-in closureOnly sensors.

#### Evidence
CMD-SLICE, CMD-TYPECHECK. Independent reviews must confirm no shell-string filename interpolation on the structured path.

#### Fallback
Security: never follow symlinks when hashing for later cache; reuse changed.ts Windows metacharacter refusal only for legacy text paths (structured argv is argv-array safe). If `requestedScope` union type churn breaks callers, amend types in one commit and re-run CMD-SLICE.

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
Own RF-3.1–3.2, RF-3.4–3.8, RF-5.1, RF-E.1. New schema + store under `.awm/evidence/runs/`; CLI `awm evidence run -- <argv…>`; keep `capture` untouched. Optional: sensor slice/full executions may emit the same schema when not `readOnly`.

#### Implementation
1. RED — `tests/core/evidence/mechanical-run.test.ts` + `tests/commands/evidence/run.test.ts`:
   - `validateMechanicalRunEvidence` accepts schema with candidate `{ headCommit, contentDigest }`, redacted argv, cwd, exitCode, durationMs, integrityDigest; rejects missing integrity / wrong schema / CycleEvidence shape (RF-3.1, RF-3.2, RF-3.6, RF-3.7, RF-E.1);
   - argv redacts `--token=secret` → `--token=<redacted>` (RF-3.4);
   - result summary truncated at documented byte cap; full stdout not stored (RF-3.4);
   - `awm evidence run -- node -e "process.exit(0)"` writes file under `.awm/evidence/runs/` with durationMs ≥ 0 (RF-5.1) and does not write CycleEvidenceV1 (RF-3.1);
   - tampered file fails validation → treat absent (RF-E.1);
   - `runSensors({ readOnly: true })` after S2 wiring creates zero new files under `.awm/evidence/runs/` and zero new cache files (RF-3.8);
   - `awm evidence run` alone does not create Change Record receipt (RF-3.5).
   CMD-EVIDENCE-RUN RED.
2. Implementation facts:
   - Add `cli/src/core/evidence/mechanical-run.ts` (types + validate + integrity hash over canonical JSON without the integrity field).
   - Store writer ensures directory `.gitignore` contains `*` (same posture as sensor runs).
   - Register `evidence.command('run').allowUnknownOption()…` or pass-through `--` argv via commander pattern already used elsewhere; cwd default repo root; optional `--scope-file` / `--candidate-digest` flags as needed for controllers — document in S6.
   - Candidate contentDigest: hash of git `ls-files -co --exclude-standard` blob digests (or documented subset); record headCommit from `git rev-parse HEAD` when available.
   - Env not recorded; docs state env out of equivalence (RF-3.4).
3. GREEN — CMD-EVIDENCE-RUN + CMD-TYPECHECK.

#### Edge cases
Non-zero exit still writes a receipt with that exitCode (evidence of failure), unless write itself fails. Secrets in env-only form are out of band (documented).

#### Evidence
CMD-EVIDENCE-RUN, CMD-TYPECHECK.

#### Fallback
Security: fail closed on symlink store paths; reuse receipt size bounds. If commander `--` parsing is awkward on Windows, use explicit `--cmd` JSON argv array flag as amendment — revalidate plan.

<a id="slice-s5"></a>
### Slice S5: Ledger deferred and resolved state

#### Surfaces
Own RF-4.7, RF-E.3. Extend `LedgerEntry` + parse + `awm ledger add/list/resolve` so QA can mechanically list deferred-open entries. No skill text in this slice.

#### Implementation
1. RED — `tests/core/ledger/deferred-parse.test.ts` + `tests/commands/ledger/deferred.test.ts` (HOME/tmp isolated):
   - parse accepts optional `deferred: { reason: string, at: string }` and `resolved: { how: 'fixed'|'accepted', at: string, note?: string }`; rejects bad how; legacy entries without these fields still parse (RF-4.7);
   - `awm ledger add ... --deferred round-ceiling` writes deferred.at ISO timestamp;
   - `awm ledger list --deferred-open` returns only deferred && !resolved;
   - `awm ledger resolve --signature <sig> --how fixed` marks resolved; subsequent `--deferred-open` omits it;
   - helper `listDeferredOpen(cwd, branch)` used by future QA returns [] when none — documenting RF-E.3 API surface (CLI throws/exits non-zero only if resolve target missing, not if list empty).
   CMD-LEDGER-DEFER RED.
2. Implementation facts:
   - Extend `LedgerEntry` in `types.ts`; update `parseLedgerEntry` allowlist carefully (unknown fields still invalid — add known optional objects only).
   - `store.ts`: `listDeferredOpen`, `resolveEntry(signature, how, note?)`.
   - `commands/ledger/index.ts`: `--deferred <reason>` on add; `resolve` subcommand; `list --deferred-open`.
3. GREEN — CMD-LEDGER-DEFER + CMD-TYPECHECK.

#### Edge cases
Resolving unknown signature → non-zero with clear error. Double-resolve → error. Existing `--desc` anti-test denylist unchanged.

#### Evidence
CMD-LEDGER-DEFER, CMD-TYPECHECK.

#### Fallback
If JSONL append-only makes in-place resolve hard: append a resolution record referencing signature and teach `listDeferredOpen` to fold last-write-wins — document in code comment; still satisfy mechanical list API.

<a id="slice-s6"></a>
### Slice S6: CLI reference and D-026

#### Surfaces
Own RF-6.2, RF-6.4. Update `docs/cli-reference.md` and add `D-026` in `docs/decisions.md`. Structural contracts section-scoped (no vacuous whole-file regex).

#### Implementation
1. RED — `tests/structural/slice-cost-control-docs-contract.test.ts` and `…-decision-contract.test.ts`:
   - CLI reference section on sensors mentions `sliceCommand`, `--slice` requiring `--base`, empty-scope skip vs unresolvable non-pass, scoped cache never satisfies full gate, tool-agnostic wording (no mutmut/stryker as normative requirement) (RF-6.2);
   - evidence section documents `awm evidence run` vs `capture`, MechanicalRunEvidence path, redaction, readOnly no-write;
   - ledger section documents `--deferred` / `resolve` / `--deferred-open`;
   - `docs/decisions.md` contains `D-026` stating extension of D-025, scoped⟂full isolation, deferred findings need QA consumption via ledger, full gate sole Change Record evidence (RF-6.4).
   Mutate by deleting D-026 heading → RED. CMD-DOCS RED.
2. Write docs + decision table row + section.
3. GREEN — CMD-DOCS.

#### Edge cases
Contracts must slice after the target `##` / `###` heading (AGENTS.md vacuous-regex lesson).

#### Evidence
CMD-DOCS. Spec review of decision prose vs design RF-6.4.

#### Fallback
Public-contract amend numbering if D-026 taken — use next free id and update this plan via `awm plan validate` amendment.

## Coverage matrix

| Requirement | Slice | Test command |
|---|---|---|
| RF-1.5, RF-1.6 | S1 | CMD-SCHEMA |
| RF-1.1–1.4, RF-1.7–1.8, RF-E.2 | S2 | CMD-SLICE |
| RF-2.1, RF-2.2, RF-2.3, RF-2.5, RF-2.6 | S3 | CMD-SCOPED-CACHE |
| RF-3.1–3.2, RF-3.4–3.8, RF-5.1, RF-E.1 | S4 | CMD-EVIDENCE-RUN |
| RF-4.7, RF-E.3 | S5 | CMD-LEDGER-DEFER |
| RF-6.2, RF-6.4 | S6 | CMD-DOCS |

Forward: every CLI-owned design RF above has ≥1 slice and ≥1 command. Backward: no orphan commands. Registry RFs explicitly out of plan.

## Handoff

1. `awm plan validate` this file → admit → implement slices → finish with Change Record `slice-cost-control` → merge → **npm publish**.
2. Then author/execute registry companion with `minCliVersion` = published version (RF-2.4, RF-3.3, RF-4.1–4.6, RF-5.2, RF-6.1, RF-6.3).
