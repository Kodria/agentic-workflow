# Sensor execution optimization (#236) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `awm sensors run` reuse raw `pass` results when fingerprint+input digests match, keep Change Record receipts honest for unmeasured-only HEAD advances, gate slice DONE with `--slice` (exclude `closureOnly`, keep `test`), and ship pack/skill/rollout changes without breaking older CLIs.

**Architecture:** Additive `inputs` + `closureOnly` on packs/manifests; picomatch-pinned digest over git-enumerated files; opt-in `useCache` only from the CLI `run` action; raw pre-baseline cache; receipt schema 2; registry `minCliVersion` after CLI publish. Contract: `docs/plans/2026-10-27-sensor-execution-optimization-design.md` (amended PR #237 audit).

**Tech Stack:** TypeScript CLI (`cli/`), Jest, pinned `picomatch`, existing sensors/change pipelines; baseline registry packs/skills/contracts.

**Change Record:** `sensor-execution-optimization`

**Criterios de aceptación:**
- Tras un `pass` full-gate, un commit solo de README/plan y un nuevo full `awm sensors run` reutiliza sensores cacheables (`cached: true`) y escribe recibo schema 2 para el nuevo HEAD cuando el árbol está limpio
- Cambiar args/variant/CLI/tool version/lockfile/sensors.json invalida caché (fingerprint / always-measured)
- `--changed` pass no se reutiliza en full gate; `baseline` / `readOnly` / `--verify-sensors` no leen ni escriben caché
- DONE de slice usa `awm sensors run --slice` (incluye test; excluye mutation `closureOnly`); QA/docs/finishing exigen full; `--slice`/`--fast` no cierran
- Registry no publica `inputs`/`closureOnly` hasta CLI en npm con `minCliVersion` alineado

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** owner-approved design 2026-10-27 (#236); audit amendments on PR #237 owner-approved (incl. revised #7 `--slice`+`closureOnly`). Dispatch: `proveedor-nativo` / `compact-slices/v1`. Flags: `--no-cache`, `--slice`. Glob matcher: pinned `picomatch`.

**File map:**
- `cli/src/commands/sensors/compatibility/{manifest,contract}.ts` — `inputs`, `closureOnly`
- `cli/src/commands/sensors/inputs-digest.ts`, `result-cache.ts` (new) — digest + cache
- `cli/src/commands/sensors/{run,index,types,prepare}.ts` — `--slice`, `useCache`, selection
- `cli/src/core/changes/receipt.ts`, `cli/src/commands/change/index.ts` — schema 2 + late paths
- `cli/src/commands/sensors/status.ts`, `cli/src/commands/preflight/checks.ts` — warnings
- `docs/cli-reference.md`, `docs/decisions.md` — D-0xx
- Sibling `../awm-baseline-registry`: packs, schema, minCliVersion, skills, `tests/rNN-sensor-execution-optimization-contract.test.mjs`

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "sensor-execution-optimization",
  "requirements": [
    "RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8", "RF-1.9",
    "RF-2.1", "RF-2.16", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7", "RF-2.8", "RF-2.9",
    "RF-2.10", "RF-2.11", "RF-2.12", "RF-2.13", "RF-2.14", "RF-2.15",
    "RF-3.1", "RF-3.2", "RF-3.3", "RF-3.4", "RF-3.5", "RF-3.6",
    "RF-4.1", "RF-4.2", "RF-4.3", "RF-4.4", "RF-4.5", "RF-4.6", "RF-4.7", "RF-4.8",
    "RF-5.1", "RF-5.2", "RF-5.3", "RF-5.4", "RF-5.5", "RF-5.6", "RF-5.7", "RF-5.8", "RF-5.9", "RF-5.10",
    "RF-6.1", "RF-6.2", "RF-6.3",
    "RF-7.1", "RF-7.2", "RF-7.3",
    "RF-E.1", "RF-E.2", "RF-E.3"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-27-sensor-execution-optimization-design.md",
      "locator": "## Requirements",
      "fact": "Amended RF-1..RF-7 and RF-E after PR #237 audit: fingerprint, always-measured, raw pre-baseline cache, useCache opt-in, --slice/closureOnly, conservative inputs defaults, schema 2, rollout order, picomatch subset."
    },
    {
      "id": "SRC-MANIFEST",
      "path": "cli/src/commands/sensors/compatibility/manifest.ts",
      "locator": "function parseV3SensorEntry",
      "fact": "Strict fields() allowlists omit inputs and closureOnly today."
    },
    {
      "id": "SRC-PACK-CONTRACT",
      "path": "cli/src/commands/sensors/compatibility/contract.ts",
      "locator": "function parseVariant",
      "fact": "Pack variant allowlist has no inputs; unknown field rejects older-CLI-incompatible packs once published."
    },
    {
      "id": "SRC-RUN",
      "path": "cli/src/commands/sensors/run.ts",
      "locator": "export async function runSensors",
      "fact": "applyBaseline after executePrepared; readOnly and ignoreBaseline options exist; no useCache."
    },
    {
      "id": "SRC-INDEX",
      "path": "cli/src/commands/sensors/index.ts",
      "locator": ".command('run')",
      "fact": "run options: --fast --slow --all --changed --base; baseline calls runSensors({ all: true, ignoreBaseline: true })."
    },
    {
      "id": "SRC-RECEIPT",
      "path": "cli/src/core/changes/receipt.ts",
      "locator": "export interface SensorReceipt",
      "fact": "schema 1; isFullSelection treats changed or fast-xor-slow as partial — must also treat --slice as partial."
    },
    {
      "id": "SRC-CHANGE",
      "path": "cli/src/commands/change/index.ts",
      "locator": "function checkVerifiedCommit",
      "fact": "lateFiles only excludes docs/changes/; needs schema 2 measured union + always-measured."
    },
    {
      "id": "SRC-STATUS",
      "path": "cli/src/commands/sensors/status.ts",
      "locator": "export async function computeSensorStatus",
      "fact": "Static readiness; no non-cacheable inputs warning."
    },
    {
      "id": "SRC-PREFLIGHT",
      "path": "cli/src/commands/preflight/checks.ts",
      "locator": "function checkManifest",
      "fact": "checkSensorExecution calls runSensors for --verify-sensors; must not use cache."
    },
    {
      "id": "SRC-CLI-DOCS",
      "path": "docs/cli-reference.md",
      "locator": "## Sensors (per-project computational checks)",
      "fact": "Operator sensors docs must gain inputs, closureOnly, --slice, --no-cache, schema 2."
    },
    {
      "id": "SRC-TYPES",
      "path": "cli/src/commands/sensors/types.ts",
      "locator": "export type SensorResult",
      "fact": "No cached/provenance fields yet."
    },
    {
      "id": "SRC-PKG",
      "path": "cli/package.json",
      "locator": "\"dependencies\"",
      "fact": "No glob matcher today; engines node >=22; add pinned picomatch in S2."
    }
  ],
  "commands": [
    {
      "id": "CMD-SCHEMA",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/compatibility/manifest.test.ts", "tests/commands/sensors/compatibility/contract.test.ts"],
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.5", "RF-1.7", "RF-1.8"]
    },
    {
      "id": "CMD-CACHE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/inputs-digest.test.ts", "tests/commands/sensors/result-cache.test.ts", "tests/commands/sensors/run-cache.test.ts", "tests/commands/sensors/run-slice.test.ts"],
      "covers": ["RF-1.4", "RF-1.6", "RF-2.1", "RF-2.16", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7", "RF-2.8", "RF-2.9", "RF-2.10", "RF-2.11", "RF-2.12", "RF-2.13", "RF-2.14", "RF-2.15", "RF-5.10", "RF-6.1", "RF-6.3", "RF-E.1", "RF-E.3"]
    },
    {
      "id": "CMD-RECEIPT",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/changes/receipt.test.ts", "tests/commands/change/validate-unmeasured.test.ts"],
      "covers": ["RF-4.1", "RF-4.2", "RF-4.3", "RF-4.4", "RF-4.5", "RF-4.6", "RF-4.7", "RF-4.8", "RF-E.2"]
    },
    {
      "id": "CMD-WARN",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/status-inputs.test.ts", "tests/commands/preflight/sensors-inputs.test.ts"],
      "covers": ["RF-3.4", "RF-6.2"]
    },
    {
      "id": "CMD-CLI-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/sensor-execution-optimization-docs-contract.test.ts"],
      "covers": ["RF-3.3"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-1.1", "RF-2.1", "RF-4.3"]
    },
    {
      "id": "CMD-REGISTRY",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/sensor-execution-optimization-registry-contract.test.ts"],
      "covers": ["RF-1.9", "RF-3.1", "RF-3.2", "RF-3.5", "RF-3.6", "RF-5.1", "RF-5.2", "RF-5.3", "RF-5.4", "RF-5.5", "RF-5.6", "RF-5.7", "RF-5.8", "RF-5.9", "RF-7.1", "RF-7.2", "RF-7.3"]
    },
    {
      "id": "CMD-DECISION",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/sensor-slice-decision-contract.test.ts"],
      "covers": ["RF-5.1", "RF-5.6"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Parse inputs and closureOnly on packs and manifests",
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.5", "RF-1.7", "RF-1.8"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN", "SRC-MANIFEST", "SRC-PACK-CONTRACT"],
      "redCommands": ["CMD-SCHEMA", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-SCHEMA", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S2",
      "title": "Digest, fingerprint cache, useCache, --slice, --no-cache",
      "requirements": ["RF-1.4", "RF-1.6", "RF-2.1", "RF-2.16", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7", "RF-2.8", "RF-2.9", "RF-2.10", "RF-2.11", "RF-2.12", "RF-2.13", "RF-2.14", "RF-2.15", "RF-5.10", "RF-6.1", "RF-6.3", "RF-E.1", "RF-E.3"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN", "SRC-RUN", "SRC-INDEX", "SRC-TYPES", "SRC-PKG", "SRC-RECEIPT"],
      "redCommands": ["CMD-CACHE", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-CACHE", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S3",
      "title": "Receipt schema 2 and Change Record unmeasured paths",
      "requirements": ["RF-4.1", "RF-4.2", "RF-4.3", "RF-4.4", "RF-4.5", "RF-4.6", "RF-4.7", "RF-4.8", "RF-E.2"],
      "dependsOn": ["S2"],
      "sectionAnchor": "slice-s3",
      "sources": ["SRC-DESIGN", "SRC-RECEIPT", "SRC-CHANGE"],
      "redCommands": ["CMD-RECEIPT", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-RECEIPT", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S4",
      "title": "Status and preflight non-cacheable warnings",
      "requirements": ["RF-3.4", "RF-6.2"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s4",
      "sources": ["SRC-DESIGN", "SRC-STATUS", "SRC-PREFLIGHT"],
      "redCommands": ["CMD-WARN", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-WARN", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S5",
      "title": "CLI reference for inputs, cache, and --slice",
      "requirements": ["RF-3.3"],
      "dependsOn": ["S2", "S3"],
      "sectionAnchor": "slice-s5",
      "sources": ["SRC-DESIGN", "SRC-CLI-DOCS"],
      "redCommands": ["CMD-CLI-DOCS"],
      "greenCommands": ["CMD-CLI-DOCS"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S6",
      "title": "Baseline packs, skills, D-0xx, schema, minCliVersion rollout",
      "requirements": ["RF-1.9", "RF-3.1", "RF-3.2", "RF-3.5", "RF-3.6", "RF-5.1", "RF-5.2", "RF-5.3", "RF-5.4", "RF-5.5", "RF-5.6", "RF-5.7", "RF-5.8", "RF-5.9", "RF-7.1", "RF-7.2", "RF-7.3"],
      "dependsOn": ["S2", "S5"],
      "sectionAnchor": "slice-s6",
      "sources": ["SRC-DESIGN"],
      "redCommands": ["CMD-REGISTRY", "CMD-DECISION"],
      "greenCommands": ["CMD-REGISTRY", "CMD-DECISION"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-SCHEMA", "CMD-CACHE", "CMD-RECEIPT", "CMD-WARN", "CMD-CLI-DOCS", "CMD-DECISION", "CMD-TYPECHECK", "CMD-REGISTRY"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Parse inputs and closureOnly on packs and manifests

#### Surfaces
Own RF-1.1–1.3, 1.5, 1.7–1.8 in `manifest.ts`, `contract.ts`, tests `manifest.test.ts`, `contract.test.ts`. Parsing `closureOnly` is under RF-1.7 allowlist; runtime `--slice` selection is S2 (RF-5.10). Grouping: schema only.

#### Implementation
1. RED — accept `inputs` string arrays and boolean `closureOnly` on variants and project/pack-bound entries; reject empty/absolute/`..`/brace/`!` globs per RF-1.5; reject unknown fields still; omit → undefined (RF-1.8). Run CMD-SCHEMA; RED.
2. Extend allowlists + types; validate glob subset without resolving filesystem yet (syntax only). Document that path normalization to repo root happens in S2 digest.
3. GREEN — CMD-SCHEMA + CMD-TYPECHECK.

#### Edge cases
Soft-isolation: one bad `inputs` entry does not invalidate siblings. `closureOnly` default false when omitted.

#### Evidence
CMD-SCHEMA, CMD-TYPECHECK.

#### Fallback
Public-contract: amend RF-1.5 if picomatch edge cases need explicit rejects.

<a id="slice-s2"></a>
### Slice S2: Digest, fingerprint cache, useCache, --slice, --no-cache

#### Surfaces
Own RF-1.4, 1.6, RF-2.*, RF-5.10 runtime, RF-6.1/6.3, RF-E.1/E.3 in new `inputs-digest.ts`, `result-cache.ts`, plus `run.ts`, `index.ts`, `types.ts`, `receipt.isFullSelection`, tests including `run-slice.test.ts` and cross-platform digest cases. Add pinned `picomatch` to `cli/package.json`. Grouping: runtime cache + selection.

#### Implementation
1. RED (tmp repos, HOME/AWM_HOME overridden):
   - Digest via git enumeration; README not matching globs ignored; `node_modules` ignored; symlink not followed; content/delete changes digest; CRLF/path separators covered on win+posix where CI runs.
   - Fingerprint change (args/cliVersion) → miss; always-measured lockfile/sensors.json change → miss.
   - Cache stores raw pre-baseline pass; baseline applied on hit; changing baseline flips reported status without re-exec if raw still pass suppressed differently — assert applyBaseline called.
   - `ignoreBaseline` / `readOnly` / missing `useCache` → no read/write; CLI run sets `useCache: true`.
   - `--changed` pass then full gate → must execute (no write from changed).
   - `--no-cache` forces execute; `--slice` skips `closureOnly: true`, runs test; `isFullSelection({slice:true})===false`.
   - Tampered cache → miss; mixed hit+fail → overall not pass; post-exec digest change → no write (RF-2.16); `originDirty` when dirty.
   Run CMD-CACHE; RED.
2. Implement digest (git ls-files -co --exclude-standard + picomatch filter + RF-1.1 normalization), fingerprint, cache IO (0600, size/symlink bounds), wire `runSensors` / `index.ts` options `--slice` `--no-cache`.
3. GREEN — CMD-CACHE + CMD-TYPECHECK.

#### Edge cases
Concurrency: read before pool; write after raw pass. Never cache skipped/inconclusive/fail. Selection: `--slice` with `--fast` — define as AND of filters (document in code): only fast non-closureOnly if both set; prefer test asserting documented behavior.

#### Evidence
CMD-CACHE, CMD-TYPECHECK. Multiplatform via existing CI matrix when tests land.

#### Fallback
Security path escape → fail closed. If picomatch pin conflicts with policy, amend design before swapping matcher.

<a id="slice-s3"></a>
### Slice S3: Receipt schema 2 and Change Record unmeasured paths

#### Surfaces
Own RF-4.* and RF-E.2 in `receipt.ts`, `change/index.ts`, tests `receipt.test.ts`, `validate-unmeasured.test.ts` (include monorepo `packageRoot: cli` case). Grouping: certification.

#### Implementation
1. RED — schema 2 write with digests; full-gate all-cached clean tree writes HEAD receipt (RF-4.4 digest authority); validate allows README-only after schema 2; fails on src change and on sensors.json/lockfile (always-measured); schema 1 unchanged; git fail → git-failed; remedy text RF-4.7; monorepo path `cli/src/x.ts` matches measured union.
2. Implement schema 2; extend `isFullSelection` for `--slice`; lateFiles filter for schema 2.
3. GREEN — CMD-RECEIPT + CMD-TYPECHECK.

#### Edge cases
RF-4.6: sensor without authored inputs does not open the world; always-measured still apply.

#### Evidence
CMD-RECEIPT, CMD-TYPECHECK.

#### Fallback
Security: never empty late set on git failure.

<a id="slice-s4"></a>
### Slice S4: Status and preflight non-cacheable warnings

#### Surfaces
Own RF-3.4, RF-6.2 in status/preflight + tests. Grouping: advisory.

#### Implementation
1. RED — enabled sensor without inputs → non-blocking warning; with inputs → no warning; verify-sensors path still executes (no cache) — assert via existing or new spy if needed in S2 coverage.
2. GREEN — CMD-WARN + CMD-TYPECHECK.

#### Edge cases
opt-out/native-gate: no spurious warnings.

#### Evidence
CMD-WARN, CMD-TYPECHECK.

#### Fallback
Extend PreflightCheck id union explicitly if required.

<a id="slice-s5"></a>
### Slice S5: CLI reference for inputs, cache, and --slice

#### Surfaces
Own RF-3.3 in `docs/cli-reference.md` and `cli/tests/structural/sensor-execution-optimization-docs-contract.test.ts`. Grouping: operator CLI docs only (D-0xx lives in S6 with RF-5).

#### Implementation
1. RED — docs contract requires inputs, closureOnly, --slice, --no-cache, schema 2, always-measured, originDirty, useCache boundary, fingerprint. Section-scoped asserts (no vacuous whole-file matches).
2. Edit `docs/cli-reference.md`.
3. GREEN — CMD-CLI-DOCS.

#### Edge cases
Vacuous regex lesson — mutate-delete check mentally before commit.

#### Evidence
CMD-CLI-DOCS.

#### Fallback
Public docs contract.

<a id="slice-s6"></a>
### Slice S6: Baseline packs, skills, D-0xx, schema, minCliVersion rollout

#### Surfaces
Own RF-1.9, RF-3.1–3.2, 3.5–3.6, RF-5.1–5.9, RF-7.* in sibling `../awm-baseline-registry` (packs, `pack.schema.json`, `awm-registry.json` minCliVersion, `cli-certification.json`, lifecycle skills, **new** `tests/r18-sensor-execution-optimization-contract.test.mjs`) plus CLI-repo `docs/decisions.md` D-0xx and `tests/structural/sensor-slice-decision-contract.test.ts`. Bump skill/bundle/catalog versions; run `./scripts/check-skill-version-bumps.sh origin/main` before DONE. Grouping: content + cycle policy decision + rollout.

#### Implementation
1. Add CLI structural test `cli/tests/structural/sensor-execution-optimization-registry-contract.test.ts` that resolves sibling `path.join(repoRoot, '..', 'awm-baseline-registry')` (must exist in this workspace) and asserts pack/skill/schema/minCliVersion contracts; optionally mirror the same asserts in registry `tests/r18-…` for registry-native CI. RED — CMD-REGISTRY fails until: packs omit inputs on format/test/mutation/security (boundable lint/typecheck only); mutation `closureOnly: true`; setup-sensors teaches inputs/mutation override/closureOnly; skills require `--slice` for slice DONE and full for QA/docs/finish; forbid `--slice`/`--fast` as closure; schema/minCliVersion/certification fields updated. CMD-DECISION fails until `docs/decisions.md` has D-0xx for `--slice`/`closureOnly` and forbidding partial closure evidence.
2. Author content; **Handoff order (RF-7.2):** merge CLI PR → npm publish of parsing CLI → then registry PR with matching `minCliVersion`. Do not publish pack fields before that CLI exists on npm.
3. GREEN — CMD-REGISTRY + CMD-DECISION. Run skill-version bump script before DONE.

#### Edge cases
Portable skills / version bumps per CONSTITUTION. Skills naming new flags declare min CLI version in prose like writing-plans.

#### Evidence
CMD-REGISTRY, CMD-DECISION, version-bump script. Spec + quality on registry PR.

#### Fallback
If the sibling registry checkout is absent, the structural test fails closed with an actionable message; do not skip. If registry-native `rNN` collides, pick the next free id without changing CMD-REGISTRY.

## Coverage matrix (self-review)

| Requirement | Slice | Command |
|---|---|---|
| RF-1.1–1.3, 1.5, 1.7–1.8, RF-5.10 parse | S1 | CMD-SCHEMA |
| RF-1.4, 1.6, RF-2.*, RF-5.10 runtime, RF-6.1/6.3, RF-E.1/E.3 | S2 | CMD-CACHE |
| RF-4.*, RF-E.2 | S3 | CMD-RECEIPT |
| RF-3.4, RF-6.2 | S4 | CMD-WARN |
| RF-3.3, RF-5.1/5.6/5.10 decision docs | S5 | CMD-CLI-DOCS, CMD-DECISION |
| RF-1.9, RF-3.1–3.2/3.5–3.6, RF-5.*, RF-7.* | S6 | CMD-REGISTRY |

## Handoff

1. `awm plan validate` (this file) → valid; then `awm plan admit` before dispatch.
2. Implement CLI slices S1–S5; release CLI to npm.
3. Implement S6 registry **after** that CLI version is published; set `minCliVersion` accordingly.
4. Change Record slug `sensor-execution-optimization` on the CLI integration branch at finishing.

## Amendment log

- **2026-10-27:** Reworked after PR #237 audit — fingerprint/always-measured/raw cache/useCache/--slice/closureOnly/conservative defaults/schema2/rollout; S6 evidence is r18 contract not version-bumps/change-record; picomatch pinned; `--since` subsumed in design non-goals.
