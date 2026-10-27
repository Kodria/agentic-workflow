# Sensor execution optimization — CLI plan (#236)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement CLI-side inputs digest cache, `--slice`/`closureOnly` selection, receipt schema 2, and D-0xx — without depending on sibling-registry jest paths that break CI.

**Architecture:** Additive parse + picomatch digests + opt-in `useCache` + raw pre-baseline cache (`pass` or `failureKind===findings`) + schema 2 validate. Pack/skill/rollout content is a **separate registry plan** after this CLI publishes (design RF-7 / audit [B]). Contract: `docs/plans/2026-10-27-sensor-execution-optimization-design.md` (amended audit r3).

**Tech Stack:** TypeScript CLI (`cli/`), Jest, pinned `picomatch`.

**Change Record:** `sensor-execution-optimization`

**Criterios de aceptación:**
- Full-gate run with project overrides giving every sensor `inputs` can, after a docs-only commit, reuse cacheable sensors and rewrite a schema 2 receipt on a clean tree
- Without those overrides (stock RF-1.9), `change validate` stays on schema-1 late-path rules (RF-4.6) — documented honestly
- Fingerprint uses live tool/runtime versions; no live version ⇒ no cache; `--changed` does not write cache; baseline/readOnly/verify-sensors do not use cache
- Only `pass` and `fail`+`failureKind=findings` cache; exit-code and missing-binary fails never cache; baseline re-apply without re-exec; baseline file not in cache digest
- `--slice` skips sensor-level `closureOnly`; rejects `--slice`+`--all`/`--slow`; RF-D.1 / D-0xx in `docs/decisions.md`
- This plan's tests pass in CI without a sibling `../awm-baseline-registry` checkout

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** design + PR #237 audits r1–r3. Companion: `awm-baseline-registry` plan (content slices after CLI npm publish).

**File map:** `compatibility/{manifest,contract}.ts`; `inputs-digest.ts`; `result-cache.ts`; `run.ts`/`index.ts`/`types.ts`; `receipt.ts`; `change/index.ts`; `status.ts`; `preflight/checks.ts`; `docs/cli-reference.md`; `docs/decisions.md`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "sensor-execution-optimization-cli",
  "requirements": [
    "RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8",
    "RF-2.1", "RF-2.16", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7", "RF-2.8", "RF-2.9",
    "RF-2.10", "RF-2.11", "RF-2.12", "RF-2.13", "RF-2.14", "RF-2.15",
    "RF-3.3", "RF-3.4",
    "RF-4.1", "RF-4.2", "RF-4.3", "RF-4.4", "RF-4.5", "RF-4.6", "RF-4.7", "RF-4.8",
    "RF-5.10",
    "RF-6.1", "RF-6.2", "RF-6.3",
    "RF-E.1", "RF-E.2", "RF-E.3",
    "RF-D.1"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-27-sensor-execution-optimization-design.md",
      "locator": "## Requirements",
      "fact": "Design amended audit r3: failureKind for RF-2.4, RF-D.1, no-live-version no-cache, RF-1.9 extension-bound defaults, RF-7.1 re-cert / RF-7.4 mirror validator, single normative source for registry IDs."
    },
    {
      "id": "SRC-MANIFEST",
      "path": "cli/src/commands/sensors/compatibility/manifest.ts",
      "locator": "function parseV3SensorEntry",
      "fact": "Strict fields() omit inputs and closureOnly today."
    },
    {
      "id": "SRC-PACK-CONTRACT",
      "path": "cli/src/commands/sensors/compatibility/contract.ts",
      "locator": "function parseVariant",
      "fact": "Variant allowlist has no inputs; sensor-level fields parse separately — closureOnly belongs on sensor object."
    },
    {
      "id": "SRC-RUN",
      "path": "cli/src/commands/sensors/run.ts",
      "locator": "export async function runSensors",
      "fact": "applyBaseline after execute; live resolve exists; readOnly/ignoreBaseline options; no useCache."
    },
    {
      "id": "SRC-INDEX",
      "path": "cli/src/commands/sensors/index.ts",
      "locator": ".command('run')",
      "fact": "run options today: --fast --slow --all --changed --base; baseline uses ignoreBaseline."
    },
    {
      "id": "SRC-RECEIPT",
      "path": "cli/src/core/changes/receipt.ts",
      "locator": "export interface SensorReceipt",
      "fact": "schema 1; isFullSelection; receipts under git-root runs/."
    },
    {
      "id": "SRC-CHANGE",
      "path": "cli/src/commands/change/index.ts",
      "locator": "function checkVerifiedCommit",
      "fact": "lateFiles excludes only docs/changes/ today."
    },
    {
      "id": "SRC-STATUS",
      "path": "cli/src/commands/sensors/status.ts",
      "locator": "export async function computeSensorStatus",
      "fact": "No non-cacheable inputs warning."
    },
    {
      "id": "SRC-PREFLIGHT",
      "path": "cli/src/commands/preflight/checks.ts",
      "locator": "function checkManifest",
      "fact": "verify-sensors executes runSensors; must not useCache."
    },
    {
      "id": "SRC-CLI-DOCS",
      "path": "docs/cli-reference.md",
      "locator": "## Sensors (per-project computational checks)",
      "fact": "Operator docs for sensors."
    },
    {
      "id": "SRC-DECISIONS",
      "path": "docs/decisions.md",
      "locator": "# Decisiones",
      "fact": "D-NNN table; add D-0xx for --slice/closureOnly cycle policy."
    },
    {
      "id": "SRC-PKG",
      "path": "cli/package.json",
      "locator": "\"dependencies\"",
      "fact": "No glob matcher; pin picomatch."
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
      "covers": ["RF-1.4", "RF-1.6", "RF-2.1", "RF-2.16", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7", "RF-2.8", "RF-2.9", "RF-2.10", "RF-2.11", "RF-2.12", "RF-2.13", "RF-2.14", "RF-2.15", "RF-5.10", "RF-6.1", "RF-6.2", "RF-6.3", "RF-E.1", "RF-E.3"]
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
      "covers": ["RF-3.4"]
    },
    {
      "id": "CMD-CLI-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/sensor-execution-optimization-docs-contract.test.ts"],
      "covers": ["RF-3.3"]
    },
    {
      "id": "CMD-DECISION",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/sensor-slice-decision-contract.test.ts"],
      "covers": ["RF-D.1"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-1.1", "RF-2.1", "RF-4.3"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Parse inputs and sensor-level closureOnly",
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
      "requirements": ["RF-1.4", "RF-1.6", "RF-2.1", "RF-2.16", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7", "RF-2.8", "RF-2.9", "RF-2.10", "RF-2.11", "RF-2.12", "RF-2.13", "RF-2.14", "RF-2.15", "RF-5.10", "RF-6.1", "RF-6.2", "RF-6.3", "RF-E.1", "RF-E.3"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN", "SRC-RUN", "SRC-INDEX", "SRC-PKG", "SRC-RECEIPT"],
      "redCommands": ["CMD-CACHE", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-CACHE", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S3",
      "title": "Receipt schema 2 and Change Record late paths",
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
      "requirements": ["RF-3.4"],
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
      "title": "CLI reference and D-0xx slice decision",
      "requirements": ["RF-3.3", "RF-D.1"],
      "dependsOn": ["S2", "S3"],
      "sectionAnchor": "slice-s5",
      "sources": ["SRC-DESIGN", "SRC-CLI-DOCS", "SRC-DECISIONS"],
      "redCommands": ["CMD-CLI-DOCS", "CMD-DECISION"],
      "greenCommands": ["CMD-CLI-DOCS", "CMD-DECISION"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-SCHEMA", "CMD-CACHE", "CMD-RECEIPT", "CMD-WARN", "CMD-CLI-DOCS", "CMD-DECISION", "CMD-TYPECHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Parse inputs and sensor-level closureOnly

#### Surfaces
Own RF-1.1–1.3, 1.5, 1.7–1.8 in `manifest.ts`, `contract.ts`, tests. `closureOnly` on **sensor** objects (pack + project), not variants. `inputs` on variants and project/pack-bound entries. Grouping: schema only.

#### Implementation
1. RED — accept inputs arrays; accept sensor-level closureOnly; reject brace/`!`/absolute/`..`; reject closureOnly on variant if placed there; picomatch options documented in code comments matching RF-1.5. CMD-SCHEMA RED.
2. Extend allowlists + types.
3. GREEN — CMD-SCHEMA + CMD-TYPECHECK.

#### Edge cases
Soft-isolation for bad inputs. Omitted closureOnly → false.

#### Evidence
CMD-SCHEMA, CMD-TYPECHECK.

#### Fallback
Public-contract amend RF-1.5 if needed.

<a id="slice-s2"></a>
### Slice S2: Digest, fingerprint cache, useCache, --slice, --no-cache

#### Surfaces
Own RF-1.4, 1.6, RF-2.*, RF-5.10, RF-6.*, RF-E.1/E.3. New modules + run/index/types; pin picomatch. Cache under **git-root** `.awm/sensors/runs/`. Grouping: runtime.

#### Implementation
1. RED (RF-2.10 fixed policy: no live tool/runtime version ⇒ neither read nor write cache for that sensor):
   - Digest: git enum + picomatch `{dot:true,posix:true}`; readlink hash; ABSENT marker; configFiles/package.json/lockfiles in cache digest; baseline.json NOT in cache digest.
   - `failureKind` on raw fail; store only `pass` or `fail`+`findings` with `errors.length > 0`; RED: exit-code fail and missing-binary fail never written; findings fail may be.
   - Baseline re-apply: findings-fail hit→pass then remove baseline entry→hit→fail without re-exec; `awm sensors baseline` / ignoreBaseline / readOnly / no useCache → no cache IO.
   - liveState in fingerprint; change PATH tool version → miss; project-declared without live version → never cache.
   - `--changed` no write; `--no-cache` forces exec; `--slice` skips closureOnly; `--slice --all` and `--slice --slow` throw; `--slice --fast` = intersection; `isFullSelection({slice:true})===false`.
   - Cache files beside receipts at git root; originDirty; tamper→miss; post-exec digest change→no write.
2. Implement; wire flags.
3. GREEN — CMD-CACHE + CMD-TYPECHECK.

#### Edge cases
Never cache inconclusive/timeout/`exit-code`/`missing-binary` fails. Multiplatform path/CRLF tests in digest suite.

#### Evidence
CMD-CACHE, CMD-TYPECHECK.

#### Fallback
Security: no symlink follow. Amend design if liveState API shape differs — read prepare.ts.

<a id="slice-s3"></a>
### Slice S3: Receipt schema 2 and Change Record late paths

#### Surfaces
Own RF-4.*, RF-E.2. Grouping: certification.

#### Implementation
1. RED — schema 2 write; all-cached clean full gate writes HEAD receipt; RF-4.6: any sensor without authored inputs → schema-1 late rules (README after verify fails without carve-out beyond docs/changes); all sensors with inputs + README-only → OK; sensors.json/lockfile/baseline.json late → fail validate; monorepo packageRoot paths; E2E with mutation-like sensor that has project `inputs` override showing cache+validate path; RF-4.7 remedy text.
2. Implement.
3. GREEN — CMD-RECEIPT + CMD-TYPECHECK.

#### Edge cases
Git fail → git-failed. Schema 1 unchanged.

#### Evidence
CMD-RECEIPT, CMD-TYPECHECK.

#### Fallback
Security fail-closed on git.

<a id="slice-s4"></a>
### Slice S4: Status and preflight non-cacheable warnings

#### Surfaces
Own RF-3.4.

#### Implementation
1. RED — warning when enabled sensor lacks inputs; none when present.
2. GREEN — CMD-WARN + CMD-TYPECHECK.

#### Edge cases
opt-out/native-gate: no spurious warnings.

#### Evidence
CMD-WARN, CMD-TYPECHECK.

#### Fallback
Extend PreflightCheck id if needed.

<a id="slice-s5"></a>
### Slice S5: CLI reference and D-0xx slice decision

#### Surfaces
Own RF-3.3 and **RF-D.1** (record D-0xx in `docs/decisions.md`: `--slice`+`closureOnly` cycle policy; forbid `--slice`/`--fast` as closure evidence; points to companion registry plan for skill text). CLI reference docs. No registry file reads in jest.

#### Implementation
1. RED — docs contract (section-scoped) for inputs, closureOnly, --slice, --no-cache, schema 2, RF-4.6 honesty, live fingerprint, cache location; decision contract for D-0xx.
2. Write docs + decision.
3. GREEN — CMD-CLI-DOCS + CMD-DECISION.

#### Edge cases
Vacuous regex lesson.

#### Evidence
CMD-CLI-DOCS, CMD-DECISION.

#### Fallback
Public docs.

## Coverage matrix

| Requirement | Slice | Command |
|---|---|---|
| RF-1.1–1.3, 1.5, 1.7–1.8 | S1 | CMD-SCHEMA |
| RF-1.4, 1.6, RF-2.*, RF-5.10, RF-6.*, RF-E.1/E.3 | S2 | CMD-CACHE |
| RF-4.*, RF-E.2 | S3 | CMD-RECEIPT |
| RF-3.4 | S4 | CMD-WARN |
| RF-3.3, RF-D.1 | S5 | CMD-CLI-DOCS, CMD-DECISION |

## Handoff

1. `awm plan validate` this file → admit → implement → merge → **npm publish**.
2. Then execute the registry companion plan with `minCliVersion` = published version.
3. Change Record `sensor-execution-optimization` on this CLI branch at finishing.

## Amendment log

- **2026-10-27 r2:** Split off registry work ([B]); absorbed [C][C2][D][E][F][G][H][I][J]; D-0xx moved to S5 as RF-D.1; removed CMD-REGISTRY from CLI closure.
- **2026-10-27 r3:** `failureKind` ([N1]); RF-D.1 defined in design ([N2]); no-live ⇒ no-cache ([N3]); RF-1.9 extension note owned by design (registry executes).
