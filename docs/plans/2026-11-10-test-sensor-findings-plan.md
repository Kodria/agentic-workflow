# Test sensor findings — Implementation Plan (#248)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `test` sensor emit one stable finding per failed test (Jest `--json` / JUnit XML) so `awm sensors baseline` ratchets legacy failures and only new failures fail the gate.

**Architecture:** File-first in `interpretResult`: after a completed process, resolve an optional `resultsFile` or the defaults `.awm/sensors/test-results.json` then `.xml`, read under realpath containment + size/UTF-8 bounds, parse to `SensorError[]`, apply the exit×artifact state table, then reuse existing `applyBaseline` / `fingerprint(sensor|file|rule)`. Packs stay unchanged; stdout `parseTestOutput` remains `[]`.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, hand-rolled JUnit XML (no new deps).

**Change Record:** `test-sensor-findings`

**Criterios de aceptación:**
- En un repo con 2 tests Jest ya rotos cableados a `.awm/sensors/test-results.json`, `awm sensors baseline` acepta ambos fingerprints → un tercer test nuevo roto hace `fail`; sin el nuevo, `pass` tras baseline
- Sin artefacto usable y exit ≠ 0 → fail sintético `exit-code` (comportamiento actual)
- Artefacto usable con 0 findings y exit ≠ 0 → fail sintético `exit-code`
- `resultsFile` custom relativo al packageRoot se respeta; path escape / symlink / oversized → tratado como ausente
- Advisory no bloqueante cuando baseline `test` está vacía o solo sintética
- Docs CLI documentan paths, Jest/JUnit/pytest, tabla de estados, TS 4.x project-declared

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** `docs/plans/2026-11-10-test-sensor-findings-design.md` (approved). Issue #248.

**File map:** `formatters/test.ts` (+ jest/junit helpers); `result.ts`; `types.ts`; `prepare.ts`; `compatibility/manifest.ts` (+ project/legacy allowlists); advisory surface in `run.ts` / `index.ts` / status warnings; `docs/cli-reference.md` (+ short legacy note); Jest under `cli/tests/commands/sensors/formatters/` and `result-*.test.ts` / structural docs test.

**Dispatch decision:** owner did not select `awm-routed`; emit `compact-slices/v1` / `proveedor-nativo`.

**Out of plan:** registry pack command changes; CLI flag injection; Vitest/TAP; auto baseline migration; XML library dependency.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "test-sensor-findings-248",
  "requirements": [
    "RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8",
    "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7",
    "RF-3.1",
    "RF-4.1"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-11-10-test-sensor-findings-design.md",
      "locator": "## Requirements",
      "fact": "EARS RF-1.1–1.8, RF-2.1–2.7, RF-3.1, RF-4.1; exit×artifact table; file-first interpretResult; packs unchanged; size-cap and advisory knobs are implementation details."
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
      "fact": "fingerprint uses sensor|file|rule when rule present; partition is count-based."
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
      "fact": "Baseline docs exist; no test-results artifact / resultsFile / Jest-JUnit wiring section yet."
    },
    {
      "id": "SRC-CONTAIN",
      "path": "cli/src/commands/sensors/project.ts",
      "locator": "export function resolveContainedPackageRoot",
      "fact": "realpath containment pattern: relative must not start with .. or be absolute after realpath."
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
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8"]
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
      "covers": ["RF-1.2", "RF-2.1", "RF-3.1"]
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
      "title": "resultsFile plumbing and file-first interpretResult",
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN", "SRC-RESULT", "SRC-TYPES", "SRC-MANIFEST", "SRC-PREPARE", "SRC-CONTAIN"],
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
Own RF-2.1–2.7. Pure parsers produce `SensorError[]` with `file`, `rule`, `message` suitable for existing `fingerprint`/`partition`. Files: `cli/src/commands/sensors/formatters/test.ts` (keep `parseTestOutput` → `[]`), new helpers colocated (`test-jest.ts`, `test-junit.ts`, shared `test-identity.ts`) or same module if small. Grouping: identity/parsing only — no `interpretResult` yet.

#### Implementation
1. RED — create `cli/tests/commands/sensors/formatters/test.test.ts` covering:
   - Jest: two failed assertions → two errors; `file` relativized from absolute `testResults[].name` under mocked root; `rule` = `fullName` (or `ancestorTitles › title`); ANSI/`  ` collapsed in `rule` (RF-2.4).
   - Jest: `status:"failed"` file with `testExecError` and empty/no failed assertions → one error `rule:"<suite-failed>"` (RF-2.5).
   - Jest: skipped/pending/todo/passed ignored (RF-2.7).
   - JUnit: testcase with `<failure>` → finding; `file` from testcase else suite; empty file attrs → `file:""`; never classname inference (RF-2.2).
   - JUnit: `classname` + `name` → `rule` `"Cls › name"`; empty classname → name only (RF-2.3).
   - JUnit: suite-level failure / errors>0 with no failed cases → `<suite-failed>` (RF-2.6).
   - JUnit: `<skipped>` alone ignored; `<failure>`+`<skipped>` → failed (RF-2.7).
   - Malformed JSON/XML → `[]` (parser returns empty; usability decided in S2).
   - Outside-root absolute path kept as-is (RF-2.2).
   Run CMD-PARSERS → FAIL (exports missing).
2. Implementation facts (minimal API):
   ```ts
   // test-identity.ts
   export function normalizeRule(raw: string): string { /* strip ANSI \u001b[...m, trim, /\s+/ → ' ' */ }
   export function relativizeTestFile(root: string, runnerPath: string): string {
     // posix relpath with `/`; if outside root after path.resolve, return runnerPath as-is (normalize seps to `/` when relative)
   }
   export const SUITE_FAILED_RULE = '<suite-failed>';

   // parseJestJson(raw, root): SensorError[]
   // parseJunitXml(raw, root): SensorError[]
   // Each error: { file, rule: normalizeRule(...), message: short human text (failure message truncated ok; NOT in fingerprint) }
   ```
   JUnit: hand-rolled — match `testsuite`/`testcase` elements and child `failure|error|skipped`; do not add deps. Cap nesting defensively; refuse entity expansion / doctype if encountered (treat as unusable → `[]`).
   Keep `parseTestOutput(_raw) { return []; }`.
3. GREEN — CMD-PARSERS + CMD-TYPECHECK. Commit.

#### Edge cases
Parametrized duplicate fullNames → identical `file|rule` (count matching later). Empty `raw` → `[]`. Binary/non-UTF-8 is S2 read concern (parsers assume string).

#### Evidence
CMD-PARSERS, CMD-TYPECHECK. Spec review: every RF-2.* claim has a mutating assertion (delete suite-failed branch → RED). Quality: no XML dep; no fingerprint of message.

#### Fallback
If JUnit shapes in the wild exceed the minimal parser, amend design with fixture samples — do not add a library without amendment. Public-contract risk keeps full gates.

<a id="slice-s2"></a>
### Slice S2: resultsFile plumbing and file-first interpretResult

#### Surfaces
Own RF-1.1–1.8. Plumb optional `resultsFile` through manifest → prepare → `PreparedSensorExecution`; in `interpretResult`/`executePrepared`, after a **completed** process (not timeout/overflow/spawn), resolve artifact, parse, apply state table. Grouping: one runtime interpretation boundary.

#### Implementation
1. RED — `cli/tests/commands/sensors/compatibility/results-file.test.ts`:
   - project sensor + pack-bound sensor accept optional relative `resultsFile` (posix relative, no `..` segments, no absolute); reject escape tokens / absolute / empty.
   - omit field → undefined.
   RED — `cli/tests/commands/sensors/result-test-findings.test.ts` (tmpdir + write artifacts; pass `cwd` into interpret/execute):
   | case | expect |
   |---|---|
   | exit 0, no file | pass, [] |
   | exit 0, json with 0 fails | pass |
   | exit 0, json with ≥1 fail | fail, findings, failureKind findings |
   | exit ≠0, no file | fail synthetic, exit-code (today) |
   | exit ≠0, unusable (bad json / escape symlink / oversize) | same synthetic exit-code |
   | exit ≠0, usable, 0 findings | fail synthetic exit-code |
   | exit ≠0, usable, ≥1 findings | fail findings; applyBaseline suppresses known fps → pass |
   | `resultsFile: 'custom/out.json'` | reads that path under cwd |
   | defaults: prefer `.awm/sensors/test-results.json` over `.xml` when both usable | json wins |
   | timeout/spawn paths unchanged (no file-first substitute) | inconclusive / missing-binary |
   CMD-INTERPRET RED.
2. Implementation facts:
   - Constants: `TEST_RESULTS_MAX_BYTES = 16 * 1024 * 1024`; defaults `['.awm/sensors/test-results.json', '.awm/sensors/test-results.xml']`.
   - Types: `resultsFile?: string` on `PreparedSensorExecution`, `ProjectDeclaredSensor`, pack-bound sensor type, legacy `SensorConfig`.
   - Manifest: add `resultsFile` to allowlists; validate with existing `asset()`-style relative path helper (no `..`, no absolute).
   - prepare*: copy `resultsFile` onto prepared when present.
   - `readUsableTestArtifact(root, relPath): { kind:'json'|'xml', text:string } | null` using `lstat` (reject symlink), `realpath` containment vs `fs.realpathSync(root)` (same relative/`..` rule as `resolveContainedPackageRoot`), size ≤ cap, `TextDecoder('utf-8',{fatal:true})`. Do **not** require `secureFs` native addon here (unit-testable without addon).
   - `resolveTestArtifact(root, resultsFile?): ... | null` — if `resultsFile` set, only that path; else try defaults in order; first usable wins; extension selects parse (RF-1.4).
   - `isTestFindingsSensor(prepared)`: `prepared.formatter === 'test' || (prepared.formatter === undefined && prepared.name === 'test')`.
   - Change signature: `interpretResult(prepared, raw, opts?: { cwd?: string })` with `cwd = opts?.cwd ?? process.cwd()`. `executePrepared` passes its `cwd`.
   - Algorithm after spawn/timeout/overflow handled as today:
     ```ts
     if (isTestFindingsSensor(prepared) && !raw.timedOut && !raw.overflowed && !raw.spawnError) {
       const art = resolveTestArtifact(cwd, prepared.resultsFile);
       const findings = art
         ? (art.kind === 'json' ? parseJestJson(art.text, cwd) : parseJunitXml(art.text, cwd))
         : null; // null = not usable
       if (findings && findings.length > 0) {
         return fail findings / failureKind findings; // RF-1.1, RF-1.7
       }
       if (raw.code === 0) return pass; // RF table
       // findings empty or artifact null → existing synthetic exit-code path (RF-1.5, RF-1.6)
     }
     // non-test: existing logic
     ```
   - When artifact null and name test: keep current synthetic message `SENSOR[test] failed (exit N)`.
3. GREEN — CMD-INTERPRET + CMD-TYPECHECK. Commit.

#### Edge cases
Path with symlink leaf → unusable. UTF-8 fatal failure → unusable. `.json` that is JUnit text → unusable. Concurrent writers: read once; no retry. Cache: findings are part of raw result before baseline (existing cache stores pre-baseline); no special case required beyond current applyBaseline-on-read.

#### Evidence
CMD-INTERPRET must go RED if file-first skipped or if missing artifact returns `pass` on exit ≠0. Spec+quality reviews; security fallback for path containment.

#### Fallback
If `interpretResult` signature change breaks many call sites, add overload with optional third arg (default cwd) — do not invent globals. Amend if pack-bound schema reject forces registry change (should not: optional field on project/pack sensor entries only).

<a id="slice-s3"></a>
### Slice S3: Re-baseline advisory and operator docs

#### Surfaces
Own RF-3.1 and RF-4.1. Non-blocking advisory when baseline `test` cannot represent per-test debt; document wiring + legacy TS 4.x project-declared path in this repo’s docs.

#### Implementation
1. RED — `cli/tests/commands/sensors/test-baseline-advisory.test.ts`:
   - `needsTestBaselineRefresh(accepted)` true for `undefined`, `[]`, and for a single fingerprint equal to `fingerprint('test', { message: 'SENSOR[test] failed (exit 1)' })` (and preferably exit codes 1..255 set membership or compute-on-check).
   - false when accepted contains a fingerprint of a ruled finding `{ file:'a.test.ts', rule:'suite › case', message:'x' }`.
   - Integration: when run/status path would emit advisory, captured warning/log includes `awm sensors baseline` and does not change overall exit/pass.
   RED — `cli/tests/structural/test-sensor-findings-docs.test.ts`:
   - Load `docs/cli-reference.md`; slice the section that documents test results artifacts (heading must exist).
   - Assert (scoped to that section, not whole file): `test-results.json`, `test-results.xml`, `resultsFile`, `jest`/`--json`, `junit` or `junitxml`, exit×artifact or equivalent state wording, `awm sensors baseline`, and TypeScript 4 / `source: "project"` / `formatter: tsc` legacy guidance (may live in same section or a clearly linked subsection — assert the subsection by heading slice).
   - Mutation check in test comments / companion: deleting the `resultsFile` sentence must fail the assert (non-vacuous).
   CMD-ADVISORY-DOCS RED.
2. Implementation facts:
   - Export `needsTestBaselineRefresh(accepted: string[] | undefined): boolean` from `baseline.ts` (or small helper next to it).
   - Emit advisory on `sensors status` warnings list when configured sensors include `test` and refresh needed; and/or `log.info` once on `sensors run` human output — must be non-blocking (exit code unchanged).
   - Docs: extend `docs/cli-reference.md` under sensors baseline / new `### Test sensor results artifacts` with defaults, `resultsFile`, Jest example (`--json --outputFile .awm/sensors/test-results.json`), pytest (`--junitxml .awm/sensors/test-results.xml`), state table summary, re-baseline note, and legacy toolchain note (project-declared `formatter: tsc` for TS 4.x out of pack range).
3. GREEN — CMD-ADVISORY-DOCS + CMD-TYPECHECK. Commit.

#### Edge cases
Advisory must not fire on greenfield with no `test` sensor. Synthetic detection must not treat ruled findings as synthetic. Docs asserts must use section windows (AGENTS.md vacuous-assert lesson).

#### Evidence
CMD-ADVISORY-DOCS; closureCommands all green. Spec: RF-3.1 non-blocking; RF-4.1 phrases present under scoped headings.

#### Fallback
If status warnings plumbing is awkward, advisory-only on `sensors run` + `sensors baseline` stderr/info is enough — amend design only if both surfaces are impossible. Docs-only failures do not weaken runtime RFs.

## Traceability matrix (self-review)

| Req | Slice | Test command / focus |
|---|---|---|
| RF-1.1 | S2 | CMD-INTERPRET findings path |
| RF-1.2 | S2 | results-file parse + custom path case |
| RF-1.3 | S2 | escape/symlink/oversize → unusable |
| RF-1.4 | S2 | json vs xml by extension; bad content unusable |
| RF-1.5 | S2 | no artifact + exit≠0 synthetic |
| RF-1.6 | S2 | usable + 0 findings + exit≠0 synthetic |
| RF-1.7 | S2 | findings + applyBaseline |
| RF-1.8 | S2 | timeout/spawn unchanged |
| RF-2.1 | S1 | fingerprint basis via ruled errors (S2 baseline case also) |
| RF-2.2 | S1 | relativize / empty / outside-root |
| RF-2.3 | S1 | fullName / classname › name / suite-failed |
| RF-2.4 | S1 | ANSI/whitespace normalize |
| RF-2.5 | S1 | Jest failed + suite-failed |
| RF-2.6 | S1 | JUnit failure/error + suite-failed |
| RF-2.7 | S1 | skips + failure+skipped tie |
| RF-3.1 | S3 | needsTestBaselineRefresh + emit |
| RF-4.1 | S3 | structural docs section asserts |

## Skills for implementers
- @test-driven-development for each slice RED→GREEN
- @verification-before-completion before claiming slice done
- @requesting-code-review for specification + code-quality reviews per compact admission
