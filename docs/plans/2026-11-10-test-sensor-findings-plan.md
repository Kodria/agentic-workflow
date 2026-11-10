# Test sensor findings — Implementation Plan (#248)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `test` sensor emit one stable finding per failed test (Jest `--json` / JUnit XML) so `awm sensors baseline` ratchets legacy failures and only new failures fail the gate — without false greens from stale artifacts or unexplained non-zero exits, and without breaking read-only admission.

**Architecture:** File-first: pre-clear candidate artifact paths, spawn, read only a fresh artifact under execution `cwd`, parse findings, allow findings-mode on exit ≠0 only when the artifact explains the exit (RF-1.10). Defaults: `coverage/awm-test-results.json` then `.xml` (admission-safe). Packs unchanged; `parseTestOutput` stays `[]`.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, hand-rolled JUnit XML (no new deps).

**Change Record:** `test-sensor-findings`

**Criterios de aceptación:**
- Repo con 2 tests Jest rotos escribiendo `coverage/awm-test-results.json` → baseline acepta ambos → tercer test nuevo → `fail`; sin el nuevo → `pass`
- Artefacto viejo baselined + comando exit ≠0 que no lo reescribe → `fail` `exit-code`, nunca `pass` (H1)
- Exit ≠0 por cobertura/runtime no explicado + findings baselined → `fail` `exit-code`, no `pass` vía baseline (H2)
- Defaults bajo `coverage/`; `runSensors({ readOnly: true })` con writer al default no dispara mutación bajo `.awm` (H3)
- Sin artefacto usable + exit ≠0 → fail sintético actual
- Advisory RF-3.1 con un solo fingerprint enmascarado (exit 1 ≡ exit 2)
- Docs: paths `coverage/`, override pack-bound, TS 4.x project-declared

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** `docs/plans/2026-11-10-test-sensor-findings-design.md` (approved; amended PR #249 audit H1–H6). Issue #248.

**File map:** `formatters/test.ts` (+ jest/junit/identity/exit-explained helpers); `result.ts` / execute pre-clear; `types.ts`; `prepare.ts`; `compatibility/manifest.ts`; advisory in baseline/status/run; `docs/cli-reference.md`; Jest under `cli/tests/commands/sensors/` + structural docs test.

**Dispatch decision:** owner did not select `awm-routed`; emit `compact-slices/v1` / `proveedor-nativo`.

**Out of plan:** registry pack command changes; CLI flag injection; Vitest/TAP; auto baseline migration; XML library; defaults under `.awm/`.

**Amendment note:** closes audit H1–H6 before execution. New RFs: RF-1.9 (freshness), RF-1.10 (exit explained).

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "test-sensor-findings-248",
  "requirements": [
    "RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8", "RF-1.9", "RF-1.10",
    "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7",
    "RF-3.1",
    "RF-4.1"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-11-10-test-sensor-findings-design.md",
      "locator": "## Requirements",
      "fact": "Amended EARS RF-1.1–1.10, RF-2.1–2.7, RF-3.1, RF-4.1; coverage/ defaults; pre-clear freshness; exit-explained gate; single masked synthetic fp; execution cwd only; pack override docs."
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
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8", "RF-1.9", "RF-1.10"]
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
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8", "RF-1.9", "RF-1.10"],
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
   - Parsers also return `explainsNonZeroExit` for fixtures S2 will rely on: clean failed-only Jest → true; failed + runtimeError/interrupt/coverage-threshold → false; JUnit sum match → true; sum mismatch → false. (Flag plumbing only; RF-1.10 ownership stays on S2.)
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
   ```
   Jest explain rules per design RF-1.10 text (fail-closed when unsure). JUnit: sum of suite `errors`+`failures` attrs === `findings.length`. Hand-rolled XML; refuse doctype/entity expansion → malformed. Keep `parseTestOutput` → `[]`.
3. GREEN — CMD-PARSERS + CMD-TYPECHECK. Commit.

#### Edge cases
Duplicate fullNames OK (count matching later). Empty raw → empty + not explained.

#### Evidence
CMD-PARSERS. Spec+quality reviews. RF-1.10 runtime RED lives in S2.

#### Fallback
If Jest JSON lacks a portable coverage-threshold field across versions, fail-closed (`explainsNonZeroExit = false`) and amend design with the concrete fields once known.

<a id="slice-s2"></a>
### Slice S2: resultsFile plumbing, pre-clear, and file-first interpretResult

#### Surfaces
Own RF-1.1–1.10 (runtime). Plumb `resultsFile`; pre-clear candidates; file-first interpret with state table including freshness and exit-explained. Defaults under `coverage/`. Grouping: one execution boundary.

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
   | exit ≠0, fresh, ≥1 findings, explained | findings → applyBaseline may pass |
   | exit ≠0, fresh, ≥1 findings, **unexplained** (coverage/runtime) | **exit-code fail; baseline must not pass** (H2) |
   | **stale**: pre-seed baselined artifact, command exit ≠0 **without rewrite** (pre-clear removes it; no rewrite) | synthetic exit-code, never pass (H1) |
   | `resultsFile: 'custom/out.json'` under cwd | honored |
   | defaults prefer `coverage/awm-test-results.json` over `.xml` | json wins |
   | timeout/spawn unchanged | inconclusive / missing-binary |
   | optional: `readOnly` observation with default path writer under `coverage/` does not classify `.awm` mutation (H3) | no read-only-mutation on `.awm` |
   CMD-INTERPRET RED.
2. Implementation facts:
   - `TEST_RESULTS_MAX_BYTES = 16 * 1024 * 1024`.
   - Defaults: `['coverage/awm-test-results.json', 'coverage/awm-test-results.xml']`.
   - Types/manifest/prepare: optional `resultsFile` (relative, no `..`, no absolute) on project, pack-bound, legacy `SensorConfig`, `PreparedSensorExecution`.
   - Resolution root = execution `cwd` only (H5).
   - `candidateResultsPaths(prepared): string[]` — `[resultsFile]` or both defaults.
   - `clearTestResultCandidates(cwd, paths)` — best-effort unlink regular files only (ignore missing); call from `executePrepared` **before** spawn when `isTestFindingsSensor(prepared)`.
   - After completed process: resolve first usable fresh artifact (exists post-clear ⇒ rewritten this run); parse via S1; apply design state table.
   - `interpretResult(prepared, raw, opts?: { cwd?: string })`; `executePrepared` passes cwd + performs clear.
   - Unexplained exit ≠0 with findings → `failureKind: 'exit-code'` (do not let applyBaseline turn into pass). Prefer returning synthetic exit-code errors as the authoritative `errors` for status, or mark so baseline skip applies only in findings-mode.
3. GREEN — CMD-INTERPRET + CMD-TYPECHECK. Commit.

#### Edge cases
Unlink fails + file remains without rewrite → treat as unusable if implementer snapshots mtime/size pre-spawn and requires change; minimum acceptable: clear then require presence (stale cleared ⇒ absent ⇒ RF-1.5). Symlink leaf → unusable. Do not write under `.awm` by default.

#### Evidence
Stale-artifact and unexplained-exit cases must RED if omitted. Spec+quality; security fallback for containment.

#### Fallback
If pre-clear is judged too aggressive for custom `resultsFile` shared with humans, amend to clear defaults always and custom path only when `resultsFile` starts with `coverage/` — requires design amendment before coding that carve-out. Default stance: clear all candidates for the sensor run.

<a id="slice-s3"></a>
### Slice S3: Re-baseline advisory and operator docs

#### Surfaces
Own RF-3.1 and RF-4.1. Single masked synthetic fingerprint (H4). Docs include `coverage/` defaults, pack non-write + override example (H6), TS 4.x, state table incl. freshness/explain.

#### Implementation
1. RED — `cli/tests/commands/sensors/test-baseline-advisory.test.ts`:
   - `needsTestBaselineRefresh(undefined|[])` true.
   - `needsTestBaselineRefresh([fingerprint('test',{message:'SENSOR[test] failed (exit 1)'})])` true.
   - Assert `fingerprint('test',{message:'SENSOR[test] failed (exit 1)'}) === fingerprint('test',{message:'SENSOR[test] failed (exit 2)'})` (H4).
   - Ruled finding fingerprint only → false.
   - Emit path non-blocking.
   RED — `cli/tests/structural/test-sensor-findings-docs.test.ts` section-scoped asserts for: `coverage/awm-test-results`, `resultsFile`, jest/`--json`, junit/junitxml, baseline refresh, TypeScript 4 / `source: "project"` / `formatter: tsc`, and explicit pack-override wording (e.g. that pack `test` does not write the artifact / example override). Non-vacuous: deleting the override sentence fails the test.
   CMD-ADVISORY-DOCS RED.
2. Implementation: `needsTestBaselineRefresh` using one synthetic fp via `fingerprint`+`maskNumbers`; wire advisory; update `docs/cli-reference.md`.
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
| RF-1.9 | S2 | pre-clear + stale RED |
| RF-1.10 | S2 | unexplained RED (uses S1 `explainsNonZeroExit`) |
| RF-2.1–2.7 | S1 | parser fixtures |
| RF-3.1 | S3 | single masked fp + advisory |
| RF-4.1 | S3 | docs section asserts + H6 override |

## Skills for implementers
- @test-driven-development for each slice RED→GREEN
- @verification-before-completion before claiming slice done
- @requesting-code-review for specification + code-quality reviews per compact admission
