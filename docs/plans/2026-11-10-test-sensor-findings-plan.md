# Test sensor findings — Implementation Plan (#248)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `test` sensor emit one stable finding per failed test (Jest `--json` / JUnit XML) so `awm sensors baseline` ratchets legacy failures and only new failures fail the gate — without false greens from stale artifacts or unexplained non-zero exits, and without breaking read-only admission.

**Architecture:** File-first: snapshot+contained pre-clear of candidates, spawn, accept only identity-changed artifacts under execution `cwd`, parse findings, allow findings-mode on exit ≠0 only when the artifact explains the exit (RF-1.10: Jest `coverageMap` ⇒ unexplained). Defaults: `coverage/awm-test-results.json` then `.xml`. Packs unchanged; `parseTestOutput` stays `[]`.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, hand-rolled JUnit XML (no new deps).

**Change Record:** `test-sensor-findings`

**Criterios de aceptación:**
- Repo con 2 tests Jest rotos escribiendo `coverage/awm-test-results.json` → baseline acepta ambos → tercer test nuevo → `fail`; sin el nuevo → `pass`
- Artefacto viejo baselined + comando exit ≠0 que no lo reescribe → `fail` `exit-code`, never `pass` (H1/N2)
- Unlink falla + identidad sin cambio → `exit-code`, never `pass` (N2)
- Jest sin `coverageMap` + fallos baselined → puede `pass`; con `coverageMap` → `exit-code` (N1)
- Defaults bajo `coverage/`; `readOnly` RED obligatorio: pre-clear+write bajo `coverage/` no muta `.awm` (H3/N3)
- `coverage/` debe estar gitignored y sin tracked files para que admit la excluya (N4 docs)
- Sin artefacto usable + exit ≠0 → fail sintético actual
- Advisory RF-3.1 con un solo fingerprint enmascarado (exit 1 ≡ exit 2)
- Docs: paths `coverage/`, override pack-bound, TS 4.x project-declared

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** `docs/plans/2026-11-10-test-sensor-findings-design.md` (approved; amended PR #249 audit H1–H6). Issue #248.

**File map:** `formatters/test.ts` (+ jest/junit/identity/exit-explained helpers); `result.ts` / execute pre-clear; `types.ts`; `prepare.ts`; `compatibility/manifest.ts`; advisory in baseline/status/run; `docs/cli-reference.md`; Jest under `cli/tests/commands/sensors/` + structural docs test.

**Dispatch decision:** owner did not select `awm-routed`; emit `compact-slices/v1` / `proveedor-nativo`.

**Out of plan:** registry pack command changes; CLI flag injection; Vitest/TAP; auto baseline migration; XML library; defaults under `.awm/`.

**Amendment note:** closes H1–H6 and re-audit N1–N4 before execution. RFs: RF-1.9 freshness+identity snapshot, RF-1.10 exit explained (`coverageMap` rule), RF-1.11 contained clear + readOnly unlink policy.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "test-sensor-findings-248",
  "requirements": [
    "RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8", "RF-1.9", "RF-1.10", "RF-1.11",
    "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7",
    "RF-3.1",
    "RF-4.1"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-11-10-test-sensor-findings-design.md",
      "locator": "## Requirements",
      "fact": "Amended EARS RF-1.1–1.11, RF-2.*, RF-3.1, RF-4.1; coverage/ defaults; identity-snapshot freshness; Jest coverageMap explain rule; contained/readOnly clear; pack override + gitignore coverage docs."
    },
    {
      "id": "SRC-TEST-FMT",
      "path": "cli/src/commands/sensors/formatters/test.ts",
      "locator": "export function parseTestOutput",
      "fact": "parseTestOutput always returns []; comment says exit-code path owns failures."
    },
    {
      "id": "SRC-RESULT",
      "path": "cli/src/commands/sensors/result.ts",
      "locator": "export function interpretResult",
      "fact": "On non-zero exit with no formatter findings, name==='test' returns synthetic fail failureKind exit-code; formatter test uses parseTestOutput ([])."
    },
    {
      "id": "SRC-BASELINE",
      "path": "cli/src/commands/sensors/baseline.ts",
      "locator": "export function fingerprint",
      "fact": "fingerprint uses sensor|file|rule when rule present; without rule uses maskNumbers(message) so exit N collapses."
    },
    {
      "id": "SRC-TYPES",
      "path": "cli/src/commands/sensors/types.ts",
      "locator": "export type PreparedSensorExecution",
      "fact": "PreparedSensorExecution has formatter? and no resultsFile today; SensorError has file?/rule?/message."
    },
    {
      "id": "SRC-MANIFEST",
      "path": "cli/src/commands/sensors/compatibility/manifest.ts",
      "locator": "function parseProjectSensor",
      "fact": "ProjectDeclaredSensor allowlist lacks resultsFile; pack-bound parseV2Sensor likewise."
    },
    {
      "id": "SRC-PREPARE",
      "path": "cli/src/commands/sensors/prepare.ts",
      "locator": "function prepareProjectSensor",
      "fact": "prepareProjectSensor / prepareV2Sensor build PreparedSensorExecution with formatter; no resultsFile plumb."
    },
    {
      "id": "SRC-STATUS-WARN",
      "path": "cli/src/commands/sensors/index.ts",
      "locator": "for (const warning of status.warnings",
      "fact": "sensors status already prints non-blocking warnings; baseline command logs info after save."
    },
    {
      "id": "SRC-CLI-DOCS",
      "path": "docs/cli-reference.md",
      "locator": "### `awm sensors baseline`",
      "fact": "Baseline docs exist; no coverage/awm-test-results / resultsFile / Jest-JUnit wiring section yet."
    },
    {
      "id": "SRC-CONTAIN",
      "path": "cli/src/commands/sensors/project.ts",
      "locator": "export function resolveContainedPackageRoot",
      "fact": "realpath containment pattern: relative must not start with .. or be absolute after realpath."
    },
    {
      "id": "SRC-READONLY",
      "path": "cli/src/commands/sensors/read-only-observation.ts",
      "locator": "export const DEFAULT_EXCLUSION_NAMES",
      "fact": "Read-only observation excludes coverage by name; .awm is reserved and cannot be excluded — writing under .awm during verify-sensors fails admission."
    },
    {
      "id": "SRC-RUNTIME-EXCL",
      "path": "cli/src/core/changes/worktree.ts",
      "locator": "export const RUNTIME_STATE_EXCLUDES",
      "fact": "RUNTIME_STATE_EXCLUDES lists .awm/sensors/runs and peers; does not list coverage/awm-test-results (coverage is typically gitignored)."
    }
  ],
  "commands": [
    {
      "id": "CMD-PARSERS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/formatters/test.test.ts"],
      "covers": ["RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7"]
    },
    {
      "id": "CMD-INTERPRET",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/result-test-findings.test.ts", "tests/commands/sensors/compatibility/results-file.test.ts"],
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8", "RF-1.9", "RF-1.10", "RF-1.11"]
    },
    {
      "id": "CMD-ADVISORY-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/test-baseline-advisory.test.ts", "tests/structural/test-sensor-findings-docs.test.ts"],
      "covers": ["RF-3.1", "RF-4.1"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-1.2", "RF-1.9", "RF-2.1", "RF-3.1"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Jest JSON and JUnit parsers",
      "requirements": ["RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN", "SRC-TEST-FMT", "SRC-BASELINE"],
      "redCommands": ["CMD-PARSERS", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-PARSERS", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S2",
      "title": "resultsFile plumbing, pre-clear, and file-first interpretResult",
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8", "RF-1.9", "RF-1.10", "RF-1.11"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN", "SRC-RESULT", "SRC-TYPES", "SRC-MANIFEST", "SRC-PREPARE", "SRC-CONTAIN", "SRC-READONLY", "SRC-RUNTIME-EXCL"],
      "redCommands": ["CMD-INTERPRET", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-INTERPRET", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S3",
      "title": "Re-baseline advisory and operator docs",
      "requirements": ["RF-3.1", "RF-4.1"],
      "dependsOn": ["S2"],
      "sectionAnchor": "slice-s3",
      "sources": ["SRC-DESIGN", "SRC-STATUS-WARN", "SRC-CLI-DOCS", "SRC-BASELINE"],
      "redCommands": ["CMD-ADVISORY-DOCS", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-ADVISORY-DOCS", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-PARSERS", "CMD-INTERPRET", "CMD-ADVISORY-DOCS", "CMD-TYPECHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Jest JSON and JUnit parsers

#### Surfaces
Own RF-2.1–2.7. Produce `TestParseResult` (`findings` + `explainsNonZeroExit` flag consumed by S2 / RF-1.10 — S1 does **not** own RF-1.10). Files: keep `parseTestOutput` → `[]`; add `test-identity.ts`, `test-jest.ts`, `test-junit.ts` (or equivalent). No I/O / interpretResult yet.

#### Implementation
1. RED — `cli/tests/commands/sensors/formatters/test.test.ts`:
   - Jest/JUnit findings, suite-failed, skips, failure+skipped, relativize, normalize, malformed → empty findings (RF-2.*).
   - Parsers return `explainsNonZeroExit` (plumbing for S2 / RF-1.10):
     - Jest failed-only, **no** `coverageMap`, runtimeError=0, !interrupted, counts match → **true** (N1 GREEN).
     - Same failures **with** truthy `coverageMap` → **false** (N1 RED).
     - failed + `numRuntimeErrorTestSuites>0` or `wasInterrupted` → false.
     - JUnit sum match → true; sum mismatch → false.
   CMD-PARSERS RED.
2. Implementation facts:
   ```ts
   export function normalizeRule(raw: string): string { /* ANSI strip, trim, collapse \s+ */ }
   export function relativizeTestFile(root: string, runnerPath: string): string { /* posix /; outside → as-is */ }
   export const SUITE_FAILED_RULE = '<suite-failed>';
   export type TestParseResult = { findings: SensorError[]; explainsNonZeroExit: boolean };
   export function parseJestJson(raw: string, root: string): TestParseResult;
   export function parseJunitXml(raw: string, root: string): TestParseResult;
   // Malformed → { findings: [], explainsNonZeroExit: false }
   // Jest: if (obj.coverageMap) explainsNonZeroExit = false; else runtime/interrupt/count checks.
   ```
   JUnit: sum of suite `errors`+`failures` attrs === `findings.length`. Hand-rolled XML; refuse doctype/entity expansion → malformed. Keep `parseTestOutput` → `[]`.
3. GREEN — CMD-PARSERS + CMD-TYPECHECK. Commit.

#### Edge cases
Duplicate fullNames OK (count matching later). Empty raw → empty + not explained. Empty object `coverageMap: {}` is still truthy → unexplained (fail-closed).

#### Evidence
CMD-PARSERS. Spec+quality. RF-1.10 runtime ownership remains S2.

#### Fallback
Do **not** invent a portable coverage-threshold field. The `coverageMap` presence rule is the approved N1 contract; amending it requires design change.

<a id="slice-s2"></a>
### Slice S2: resultsFile plumbing, pre-clear, and file-first interpretResult

#### Surfaces
Own RF-1.1–1.11 (runtime). Plumb `resultsFile`; contained pre-clear + identity snapshot; file-first interpret; readOnly unlink policy. Defaults under `coverage/`. Grouping: one execution boundary.

#### Implementation
1. RED — `cli/tests/commands/sensors/compatibility/results-file.test.ts`: accept/reject relative `resultsFile` on project + pack-bound; omit → undefined.
   RED — `cli/tests/commands/sensors/result-test-findings.test.ts`:
   | case | expect |
   |---|---|
   | exit 0, no file | pass |
   | exit 0, fresh json 0 fails | pass |
   | exit 0, fresh json ≥1 fail | fail findings |
   | exit ≠0, no file | synthetic exit-code |
   | exit ≠0, bad/escape/oversize | synthetic exit-code |
   | exit ≠0, fresh, 0 findings | synthetic exit-code |
   | exit ≠0, fresh, ≥1 findings, explained (no `coverageMap`) | findings → applyBaseline may pass |
   | exit ≠0, fresh, ≥1 findings, **`coverageMap` present** | **exit-code; baseline must not pass** (N1) |
   | exit ≠0, fresh, ≥1 findings, runtimeError/interrupted | exit-code (H2) |
   | **stale**: pre-seed artifact, exit ≠0 without rewrite after successful clear | exit-code, never pass (H1) |
   | **unlink fails** (mock `unlinkSync` throw), identity unchanged, exit ≠0 | exit-code, never pass (N2) |
   | symlink intermediate parent for candidate | clear refused / unusable; no escape unlink (N3) |
   | `resultsFile: 'custom/out.json'` under cwd | honored (non-readOnly) |
   | defaults prefer `coverage/awm-test-results.json` over `.xml` | json wins |
   | timeout/spawn unchanged | inconclusive / missing-binary |
   | **`readOnly: true`** + default under gitignored `coverage/` + writer | no `.awm` mutation; observation does not fail for `.awm` (N3 mandatory) |
   | `readOnly: true` + `resultsFile` outside exclusion names | no unlink of that path; freshness via identity only (N3) |
   CMD-INTERPRET RED.
2. Implementation facts:
   - `TEST_RESULTS_MAX_BYTES = 16 * 1024 * 1024`.
   - Defaults: `['coverage/awm-test-results.json', 'coverage/awm-test-results.xml']`.
   - Types/manifest/prepare: optional `resultsFile` (relative, no `..`, no absolute).
   - Resolution root = execution `cwd` only.
   - `candidateResultsPaths(prepared)`.
   - Before spawn (`isTestFindingsSensor`): for each candidate, if regular file exists snapshot `{mtimeMs,size,ino?}`; then `clearTestResultCandidates(cwd, paths, { readOnly })`:
     - resolve parent via `realpath`; refuse if parent escapes cwd; never unlink symlink leaf;
     - if `readOnly`, unlink only when a path segment matches `DEFAULT_EXCLUSION_NAMES` (e.g. `coverage`); otherwise skip unlink.
   - After run: usable iff regular contained non-symlink file and (no prior snapshot OR identity differs).
   - `interpretResult(prepared, raw, opts?: { cwd?: string })`; `executePrepared` passes `cwd` + `readOnly` into clear.
   - Unexplained exit ≠0 → authoritative `failureKind: 'exit-code'` (baseline cannot pass).
3. GREEN — CMD-INTERPRET + CMD-TYPECHECK. Commit.

#### Edge cases
Symlink leaf → unusable. Parent symlink escaping cwd → no unlink. `readOnly` + custom path outside exclusions → no CLI delete; runner write may still trip observation — docs (S3/N4) warn; prefer defaults under `coverage/`.

#### Evidence
Stale, unlink-fail, coverageMap, contained-clear, and mandatory readOnly cases must RED if omitted. Spec+quality; security fallback.

#### Fallback
Changing readOnly unlink allowlist beyond `DEFAULT_EXCLUSION_NAMES` requires design amendment.

<a id="slice-s3"></a>
### Slice S3: Re-baseline advisory and operator docs

#### Surfaces
Own RF-3.1 and RF-4.1. Single masked synthetic fingerprint (H4). Docs: `coverage/` defaults, pack override (H6), no `--coverage` on test sensor (N1), gitignore/no-tracked requirement for `coverage/` exclusion (N4), TS 4.x, freshness/explain table.

#### Implementation
1. RED — `cli/tests/commands/sensors/test-baseline-advisory.test.ts`:
   - `needsTestBaselineRefresh(undefined|[])` true.
   - `needsTestBaselineRefresh([fingerprint('test',{message:'SENSOR[test] failed (exit 1)'})])` true.
   - Assert exit 1 ≡ exit 2 synthetic fingerprints (H4).
   - Ruled finding fingerprint only → false.
   - Emit path non-blocking.
   RED — `cli/tests/structural/test-sensor-findings-docs.test.ts` section-scoped asserts for: `coverage/awm-test-results`, `resultsFile`, jest/`--json`, junit/junitxml, baseline refresh, TypeScript 4 / `source: "project"` / `formatter: tsc`, pack-override wording, **no `--coverage`/threshold on test sensor**, and **`coverage/` must be gitignored without tracked files** for admit exclusion (N4). Non-vacuous: deleting the gitignore/`--coverage` sentences fails the test.
   CMD-ADVISORY-DOCS RED.
2. Implementation: `needsTestBaselineRefresh` using one synthetic fp; wire advisory; update `docs/cli-reference.md`.
3. GREEN — CMD-ADVISORY-DOCS + CMD-TYPECHECK. Commit.

#### Edge cases
No advisory when `test` sensor absent. Docs asserts use heading windows.

#### Evidence
CMD-ADVISORY-DOCS; full closureCommands.

#### Fallback
Advisory on run info alone is enough if status warnings are awkward — keep non-blocking.

## Traceability matrix (self-review)

| Req | Slice | Test focus |
|---|---|---|
| RF-1.1 | S2 | findings path when explained |
| RF-1.2 | S2 | resultsFile + coverage defaults |
| RF-1.3 | S2 | escape/symlink/oversize |
| RF-1.4 | S2 | extension parse / bad content |
| RF-1.5 | S2 | missing/stale → exit-code |
| RF-1.6 | S2 | 0 findings + exit≠0 |
| RF-1.7 | S2 | explained findings + baseline |
| RF-1.8 | S2 | timeout/spawn |
| RF-1.9 | S2 | identity snapshot + stale/unlink-fail RED |
| RF-1.10 | S2 | coverageMap / runtime unexplained RED |
| RF-1.11 | S2 | contained clear + mandatory readOnly RED |
| RF-2.1–2.7 | S1 | parser fixtures + coverageMap explain plumbing |
| RF-3.1 | S3 | single masked fp + advisory |
| RF-4.1 | S3 | docs: H6 override, N1 no-coverage, N4 gitignore |

## Skills for implementers
- @test-driven-development for each slice RED→GREEN
- @verification-before-completion before claiming slice done
- @requesting-code-review for specification + code-quality reviews per compact admission
