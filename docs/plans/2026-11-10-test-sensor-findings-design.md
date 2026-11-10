# Test Sensor Findings Design

**Issue:** [#248](https://github.com/Kodria/agentic-workflow/issues/248)

**Scope:** `agentic-workflow` CLI + docs in this repo. Packs in `awm-baseline-registry` unchanged.

**Approach:** File-first interpretation for the `test` sensor (brainstorming 2026-11-10; amended after PR #249 audit H1–H6). The project’s test command writes a structured results artifact under an admission-safe default path; the CLI clears candidate paths before spawn, reads only a fresh artifact after exec, emits one finding per failed test, and allows baseline-suppressed `pass` on exit ≠0 only when the artifact explains that exit as test failures alone.

**Change Record:** `test-sensor-findings`

**Design artifacts:** none (no UI screens).

**Amendments (PR #249 audit):** H1–H6 closed; re-audit N1–N4: Jest `coverageMap` explain rule (not inventing threshold fields); mandatory identity snapshot when unlink fails; contained pre-clear + `readOnly` unlink policy; docs note `coverage/` exclusion needs gitignore/no tracked files.

**Amendments (post-implementation QA):** RF-1.2 prefers findings-bearing usable candidates over vacuous all-pass peers; RF-1.10 JUnit suite-only `<suite-failed>` covers that suite's attr sum; RF-1.11 non-readOnly may unlink canonical `awm-test-results.*` basenames while readOnly stays exclusion-name-only (never reserved `.awm`/`.git`, never arbitrary files like `package.json`).

## Requirements

### Artifact discovery and parsing

- **RF-1.1 — Per-test findings:** WHEN the sensor uses formatter `test` or sensor name `test` and a usable results artifact from **this** run exists, THE CLI SHALL emit one `SensorError` per failed test or failed suite under RF-2.*, and SHALL NOT collapse the run into a single synthetic exit-code finding when those findings exist **and** RF-1.10 permits findings-mode for the exit code.
- **RF-1.2 — `resultsFile` and defaults:** WHEN the sensor declares `resultsFile`, THE CLI SHALL resolve that path relative to the sensor **execution `cwd`** (the same root passed to `executePrepared` / the package root used for the command — never a second ambiguous root). WHEN `resultsFile` is omitted, THE CLI SHALL try, in order, `coverage/awm-test-results.json` then `coverage/awm-test-results.xml` under that cwd. WHEN multiple candidates are fresh and usable, THE CLI SHALL prefer one with `findings.length > 0` over an all-pass / empty-findings usable peer; among equals, THE CLI SHALL keep that order (json before xml). Defaults live under `coverage/` so `plan admit --verify-sensors` read-only observation (which already excludes the `coverage` directory name and forbids excluding `.awm`) does not see a mutation (H3 / class #240).
- **RF-1.3 — Path and read bounds:** IF the resolved path escapes the sensor execution cwd after `realpath`, is not a regular file, is a symlink leaf, is not readable as UTF-8, or exceeds the configured size cap, THEN THE CLI SHALL treat the artifact as not usable (same path as absent).
- **RF-1.4 — Format by extension:** WHEN the usable artifact path ends with `.json`, THE CLI SHALL parse it as Jest `--json` output. WHEN it ends with `.xml`, THE CLI SHALL parse it as JUnit XML. IF the content fails that format’s parse, THEN THE CLI SHALL treat the artifact as not usable.
- **RF-1.5 — Missing artifact fallback:** IF no usable artifact exists, THEN THE CLI SHALL keep today’s exit-code behavior for the test sensor (non-zero → synthetic `fail` with `failureKind: exit-code`; never `pass` without evidence of a completed zero exit).
- **RF-1.6 — Zero findings, non-zero exit:** IF a usable artifact parses to zero findings and the process exit code is non-zero, THEN THE CLI SHALL `fail` with a synthetic error and `failureKind: exit-code`, and SHALL NOT invent per-test findings.
- **RF-1.7 — Findings drive fail (when exit is explained):** WHEN one or more findings are parsed **and** (exit is 0 **or** RF-1.10 says the artifact explains the non-zero exit), THE CLI SHALL set status `fail` with `failureKind: findings` before baseline, and SHALL run baseline `partition` / `applyBaseline` with the same semantics as other finding sensors.
- **RF-1.8 — Completed process only:** WHEN the process times out, overflows the output buffer, or fails to spawn, THE CLI SHALL keep the existing inconclusive / missing-binary / partial-output paths and SHALL NOT substitute file-first interpretation for those outcomes.
- **RF-1.9 — Freshness (this run only):** BEFORE spawning a test-findings sensor, for every candidate path (configured `resultsFile` or both defaults) the CLI SHALL: (1) if a regular file exists, snapshot `{mtimeMs, size, ino?}`; (2) attempt a **contained** unlink per RF-1.11 (never unlink a symlink leaf; `realpath` the parent directory and refuse if it escapes execution cwd). AFTER the process completes, THE CLI SHALL treat an artifact as usable only if it is a regular contained non-symlink file that either did not exist in the pre-spawn snapshot or differs in `mtimeMs`/`size`/`ino` from that snapshot. IF unlink failed and the file identity is unchanged, OR the file is absent, THEN THE CLI SHALL treat it as not usable (RF-1.5). THE CLI SHALL NOT `pass` on exit ≠0 solely because a pre-existing baselined artifact was left behind.
- **RF-1.10 — Exit explained by artifact:** WHEN exit ≠ 0 and findings were parsed, THE CLI SHALL enter findings-mode (RF-1.7) only if the artifact **explains** the non-zero exit as test/suite failures alone:
  - **Jest:** `numRuntimeErrorTestSuites === 0`, not `wasInterrupted`, failure counts accounted for by emitted failed assertions/suites (`numFailedTests` / failed suites align with emitted findings). IF the JSON object has a truthy `coverageMap` property (coverage was collected), THEN THE CLI SHALL treat the exit as **not** explained (fail-closed: coverage thresholds affect exit without a portable threshold field). IF `coverageMap` is absent, coverage cannot be the cause; the exit is explained when the runtime/interrupt/count checks above hold. Operators who want the ratchet MUST NOT pass `--coverage` (with thresholds) on the test sensor command — coverage belongs on a separate sensor.
  - **JUnit:** WHEN a suite emits one `<suite-failed>` finding with no failed testcases, THAT single finding accounts for that suite's `errors` + `failures` attribute sum (`suiteAttr` covered). Overall, the artifact explains the exit WHEN every suite's attrs are accounted for by emitted findings: each failed-testcase finding counts 1:1 toward its suite attrs; a suite-failed row covers its suite's full `suiteAttr` when there were no failed testcases. (A bare `attrSum === findings.length` equality is insufficient when suite-only attrs exceed 1.)
  IF the artifact does **not** explain the exit, THEN THE CLI SHALL `fail` with `failureKind: exit-code` (synthetic evidence), even when findings were also parsed (baseline MUST NOT convert this outcome to `pass`).
- **RF-1.11 — Contained clear and readOnly:** WHEN unlinking a candidate, THE CLI SHALL resolve the parent directory with `realpath`, require it stays under execution cwd, and SHALL NOT unlink if the leaf is a symlink. THE CLI SHALL NEVER unlink a candidate whose relative path has a reserved `.awm` / `.git` segment, and SHALL NEVER unlink arbitrary project files (e.g. `package.json`). WHEN `runSensors({ readOnly: true })`, THE CLI SHALL unlink only candidates whose relative path is under a default admission exclusion **name** segment (today: `coverage`, matching `DEFAULT_EXCLUSION_NAMES`) — canonical `awm-test-results.json` / `.xml` basenames alone do **not** authorize unlink under readOnly; for other candidates THE CLI SHALL skip unlink and still apply RF-1.9 identity-snapshot freshness. WHEN not readOnly, THE CLI MAY also unlink candidates whose basename is `awm-test-results.json` or `awm-test-results.xml` (case-insensitive), in addition to exclusion-name paths. THE CLI SHALL NOT introduce `.awm` mutations via pre-clear.

### Finding identity and failure set

- **RF-2.1 — Fingerprint basis:** THE CLI SHALL fingerprint each test finding as `sensor|file|rule` using the existing `fingerprint` / count-based `partition` in `baseline.ts`. THE basis SHALL exclude message, stack, duration, line, column, and retry attempt.
- **RF-2.2 — `file` field:** THE CLI SHALL set `file` to an execution-cwd-relative path using `/` separators: Jest from `testResults[].name` (absolute paths relativized); JUnit from the testcase `file` attribute, else the testsuite `file` attribute; if neither is present, `file` SHALL be `""` (SHALL NOT infer from `classname`). IF relativization fails because the path lies outside the execution cwd, THE CLI SHALL keep the path as returned by the runner.
- **RF-2.3 — `rule` field:** THE CLI SHALL set `rule` to the full test name: Jest `assertionResults[].fullName`, or `ancestorTitles` joined with ` › ` plus `title`; JUnit `"<classname> › <name>"`, or only `<name>` when `classname` is empty; for suite-level failures with no failed assertions/testcases, `rule` SHALL be the fixed string `<suite-failed>`.
- **RF-2.4 — `rule` normalization:** BEFORE fingerprinting, THE CLI SHALL strip ANSI codes from `rule`, trim it, and collapse internal whitespace to a single space.
- **RF-2.5 — Jest failures that produce findings:** THE CLI SHALL emit a finding for each `assertionResults[]` entry with `status` `"failed"` (including timeouts). WHEN a `testResults[]` entry has `status` `"failed"` and `testExecError` or `failureMessage` and no failed assertion entries, THE CLI SHALL emit one finding for that file with `rule` `<suite-failed>`.
- **RF-2.6 — JUnit failures that produce findings:** THE CLI SHALL emit a finding for each `testcase` that contains a `<failure>` or `<error>` child. WHEN a `testsuite` has its own `<error>`/`<failure>` outside testcases, or reports `errors`/`failures` &gt; 0 with no failed testcase children, THE CLI SHALL emit one finding with `rule` `<suite-failed>`.
- **RF-2.7 — Exclusions and ties:** THE CLI SHALL NOT emit findings for passed, skipped, pending, todo, or disabled Jest statuses, nor for JUnit `<skipped>`. WHEN a runner retried a test and the final status is passed, THE CLI SHALL use the final status only. IF a testcase has both `<failure>` and `<skipped>`, THEN THE CLI SHALL treat it as failed.

### Baseline advisory and documentation

- **RF-3.1 — Re-baseline advisory:** WHEN the accepted baseline entry for `test` is empty or only reflects the synthetic exit-code failure shape, THE CLI SHALL emit a non-blocking advisory suggesting the operator re-run `awm sensors baseline` after wiring a results artifact. WHEN the advisory is emitted from `awm sensors run`, THE CLI SHALL write it to **stderr only** and SHALL NOT append it to stdout after the JSON verdict (machine consumers must keep a parseable single JSON document). Synthetic shape detection SHALL use a **single** fingerprint: `fingerprint('test', { message: 'SENSOR[test] failed (exit 1)' })`, relying on existing `maskNumbers` so all exit codes collide (H4).
- **RF-4.1 — Operator docs:** THE CLI reference (and legacy-adoption guidance in this repo) SHALL document: default paths under `coverage/`, optional `resultsFile`, Jest and JUnit wiring examples (including pytest `--junitxml`), the exit×artifact state table (including freshness and exit-explained rows), the re-baseline advisory, project-declared sensors for out-of-range toolchains (e.g. TypeScript 4.x with `formatter: tsc`), an explicit statement that **packs do not write the artifact** — pack-bound projects must override the test script/`cmd` or set `resultsFile` (with a minimal override example) (H6), that the test sensor command must not combine `--coverage`/thresholds with the ratchet (use a separate coverage sensor), and that read-only admission skips `coverage/` only when that directory is gitignored and contains no tracked files (`read-only-observation` / N4) — otherwise admit may still see mutations.

## Non-goals (v1)

- Changing `awm-baseline-registry` pack commands or formatters.
- CLI injection of runner flags (`--json`, `--junitxml`, etc.).
- Vitest JSON, TAP, or other result formats.
- Automatic baseline migration.
- Adding an XML library dependency.
- Inferring JUnit `file` from `classname`.
- Writing defaults under `.awm/` (rejected: read-only admission mutation).

## Context and problem

`awm sensors baseline` ratchets finding sensors (`tsc`, `eslint`, `mypy`, `ruff`, `semgrep`). The `test` formatter always returns `[]`; the sensor fails only by exit code, so `.awm/sensors.baseline.json` never gains stable per-test fingerprints. On a legacy suite with pre-existing failures, every run fails and a newly broken test is indistinguishable from old debt.

## Architecture

### File-first interpretation

```text
prepare → clearCandidateArtifacts → execute → interpretResult → applyBaseline
                                      │
                                      ├─ non-test → existing stdout formatters
                                      └─ test:
                                           1. resolveResultsPath(resultsFile? | coverage defaults)
                                           2. readContainedFile (realpath, regular, UTF-8, size cap)
                                           3. parseJestJson | parseJunitXml → findings + exitExplained?
                                           4. apply exit×artifact table (RF-1.9 / RF-1.10)
```

`parseTestOutput(raw)` remains `[]`. Optional `resultsFile` is plumbed on sensor config into `PreparedSensorExecution`. Resolution root is solely the execution `cwd`.

### Exit × artifact state table

| Exit | Usable fresh artifact | Findings | Exit explained? | Result | `failureKind` |
|---|---|---|---|---|---|
| 0 | no | — | — | `pass` | — |
| 0 | yes | 0 | — | `pass` | — |
| 0 | yes | ≥1 | — | `fail` | `findings` |
| ≠0 | no / unusable / stale | — | — | synthetic `fail` | `exit-code` |
| ≠0 | yes | 0 | — | synthetic `fail` | `exit-code` |
| ≠0 | yes | ≥1 | no | synthetic `fail` (do not baseline to pass) | `exit-code` |
| ≠0 | yes | ≥1 | yes | `fail` → baseline | `findings` |

### Baseline

No schema change. RF-3.1 uses one masked synthetic fingerprint. Packs unchanged: operators must wire the writer themselves (RF-4.1 / H6).

## Component touch list

| Area | Change |
|---|---|
| `formatters/test*.ts` | Jest/JUnit parse + exit-explained helpers |
| `result.ts` / `executePrepared` | Pre-spawn clear; file-first; RF-1.9/1.10 table |
| types / prepare / manifest | `resultsFile?` |
| baseline / status / run | RF-3.1 advisory (single fp) |
| `docs/cli-reference.md` | RF-4.1 incl. pack override example |
| tests | freshness RED, exit-explained RED, readOnly non-mutation under defaults, parsers, docs |

## Acceptance mapping

| Requirement | Verified by |
|---|---|
| RF-1.1–RF-1.11 | `interpretResult` / execute tests for every state-table cell; stale RED; unlink-fail+unchanged identity RED; Jest with/without `coverageMap` RED/GREEN; contained clear; mandatory `readOnly` RED under `coverage/`; timeout/spawn non-interference |
| RF-2.1–RF-2.7 | Parser unit tests with Jest/JUnit fixtures |
| RF-3.1 | Advisory helper + exit-1 ≡ exit-2 synthetic fingerprint equivalence |
| RF-4.1 | Section-scoped structural docs asserts (defaults under `coverage/`, override example, TS 4.x) |

## Open implementation knobs (non-ambiguous defaults)

- **Size cap:** `16 * 1024 * 1024` bytes unless plan picks another multi-MB constant; fail closed as unusable when exceeded.
- **Advisory surface:** existing non-blocking status warnings / run info channels.
- **Pre-clear failures:** identity snapshot is mandatory (RF-1.9); unlink is best-effort but never sufficient alone for freshness.
