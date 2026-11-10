# Test Sensor Findings Design

**Issue:** [#248](https://github.com/Kodria/agentic-workflow/issues/248)

**Scope:** `agentic-workflow` CLI + docs in this repo. Packs in `awm-baseline-registry` unchanged.

**Approach:** File-first in `interpretResult` (brainstorming 2026-11-10). The project’s test command writes a structured results artifact; the CLI reads it after exec and emits one finding per failed test so `awm sensors baseline` can ratchet legacy failures.

**Change Record:** `test-sensor-findings`

**Design artifacts:** none (no UI screens).

## Requirements

### Artifact discovery and parsing

- **RF-1.1 — Per-test findings:** WHEN the sensor uses formatter `test` or sensor name `test` and a usable results artifact exists, THE CLI SHALL emit one `SensorError` per failed test or failed suite under RF-2.*, and SHALL NOT collapse the run into a single synthetic exit-code finding when those findings exist.
- **RF-1.2 — `resultsFile` and defaults:** WHEN the sensor declares `resultsFile`, THE CLI SHALL resolve that path relative to the sensor cwd / `packageRoot`. WHEN `resultsFile` is omitted, THE CLI SHALL try, in order, `.awm/sensors/test-results.json` then `.awm/sensors/test-results.xml` under that root. THE first usable artifact SHALL win.
- **RF-1.3 — Path and read bounds:** IF the resolved path escapes the sensor root after `realpath`, is not a regular file, is not readable as UTF-8, or exceeds the configured size cap, THEN THE CLI SHALL treat the artifact as not usable (same path as absent).
- **RF-1.4 — Format by extension:** WHEN the usable artifact path ends with `.json`, THE CLI SHALL parse it as Jest `--json` output. WHEN it ends with `.xml`, THE CLI SHALL parse it as JUnit XML. IF the content fails that format’s parse, THEN THE CLI SHALL treat the artifact as not usable.
- **RF-1.5 — Missing artifact fallback:** IF no usable artifact exists, THEN THE CLI SHALL keep today’s exit-code behavior for the test sensor (non-zero → synthetic `fail` with `failureKind: exit-code`; never `pass` without evidence of a completed zero exit).
- **RF-1.6 — Zero findings, non-zero exit:** IF a usable artifact parses to zero findings and the process exit code is non-zero, THEN THE CLI SHALL `fail` with a synthetic error and `failureKind: exit-code`, and SHALL NOT invent per-test findings.
- **RF-1.7 — Findings drive fail:** WHEN one or more findings are parsed, THE CLI SHALL set status `fail` with `failureKind: findings` and SHALL run baseline `partition` / `applyBaseline` with the same semantics as other finding sensors.
- **RF-1.8 — Completed process only:** WHEN the process times out, overflows the output buffer, or fails to spawn, THE CLI SHALL keep the existing inconclusive / missing-binary / partial-output paths and SHALL NOT substitute file-first interpretation for those outcomes.

### Finding identity and failure set

- **RF-2.1 — Fingerprint basis:** THE CLI SHALL fingerprint each test finding as `sensor|file|rule` using the existing `fingerprint` / count-based `partition` in `baseline.ts`. THE basis SHALL exclude message, stack, duration, line, column, and retry attempt.
- **RF-2.2 — `file` field:** THE CLI SHALL set `file` to a project-root-relative path using `/` separators: Jest from `testResults[].name` (absolute paths relativized); JUnit from the testcase `file` attribute, else the testsuite `file` attribute; if neither is present, `file` SHALL be `""` (SHALL NOT infer from `classname`). IF relativization fails because the path lies outside the sensor root, THE CLI SHALL keep the path as returned by the runner.
- **RF-2.3 — `rule` field:** THE CLI SHALL set `rule` to the full test name: Jest `assertionResults[].fullName`, or `ancestorTitles` joined with ` › ` plus `title`; JUnit `"<classname> › <name>"`, or only `<name>` when `classname` is empty; for suite-level failures with no failed assertions/testcases, `rule` SHALL be the fixed string `<suite-failed>`.
- **RF-2.4 — `rule` normalization:** BEFORE fingerprinting, THE CLI SHALL strip ANSI codes from `rule`, trim it, and collapse internal whitespace to a single space.
- **RF-2.5 — Jest failures that produce findings:** THE CLI SHALL emit a finding for each `assertionResults[]` entry with `status` `"failed"` (including timeouts). WHEN a `testResults[]` entry has `status` `"failed"` and `testExecError` or `failureMessage` and no failed assertion entries, THE CLI SHALL emit one finding for that file with `rule` `<suite-failed>`.
- **RF-2.6 — JUnit failures that produce findings:** THE CLI SHALL emit a finding for each `testcase` that contains a `<failure>` or `<error>` child. WHEN a `testsuite` has its own `<error>`/`<failure>` outside testcases, or reports `errors`/`failures` &gt; 0 with no failed testcase children, THE CLI SHALL emit one finding with `rule` `<suite-failed>`.
- **RF-2.7 — Exclusions and ties:** THE CLI SHALL NOT emit findings for passed, skipped, pending, todo, or disabled Jest statuses, nor for JUnit `<skipped>`. WHEN a runner retried a test and the final status is passed, THE CLI SHALL use the final status only. IF a testcase has both `<failure>` and `<skipped>`, THEN THE CLI SHALL treat it as failed.

### Baseline advisory and documentation

- **RF-3.1 — Re-baseline advisory:** WHEN the accepted baseline entry for `test` is empty or only reflects the synthetic exit-code failure shape, THE CLI SHALL emit a non-blocking advisory suggesting the operator re-run `awm sensors baseline` after wiring a results artifact.
- **RF-4.1 — Operator docs:** THE CLI reference (and legacy-adoption guidance in this repo) SHALL document default paths, optional `resultsFile`, Jest and JUnit wiring examples (including pytest `--junitxml`), the exit×artifact state table, the re-baseline advisory, and project-declared sensors as the path for out-of-range toolchains (e.g. TypeScript 4.x with `formatter: tsc`).

## Non-goals (v1)

- Changing `awm-baseline-registry` pack commands or formatters.
- CLI injection of runner flags (`--json`, `--junitxml`, etc.).
- Vitest JSON, TAP, or other result formats.
- Automatic baseline migration.
- Adding an XML library dependency.
- Inferring JUnit `file` from `classname`.

## Context and problem

`awm sensors baseline` ratchets finding sensors (`tsc`, `eslint`, `mypy`, `ruff`, `semgrep`). The `test` formatter always returns `[]`; the sensor fails only by exit code, so `.awm/sensors.baseline.json` never gains stable per-test fingerprints. On a legacy suite with pre-existing failures, every run fails and a newly broken test is indistinguishable from old debt.

## Architecture

### File-first interpretation

```text
prepare → execute → interpretResult → applyBaseline
                         │
                         ├─ non-test → existing stdout formatters
                         └─ test:
                              1. resolveResultsPath(resultsFile? | defaults)
                              2. readContainedFile (realpath, regular, UTF-8, size cap)
                              3. parseJestJson | parseJunitXml → SensorError[]
                              4. apply exit×artifact table
```

`parseTestOutput(raw)` remains `[]`: runner stdout is not the source of truth. Pure parsers live under `cli/src/commands/sensors/formatters/` (Jest JSON via `JSON.parse`; JUnit via a minimal hand-rolled parser — no new dependency). Optional `resultsFile` is plumbed on sensor config into `PreparedSensorExecution`.

### Exit × artifact state table

| Exit | Usable artifact | Parsed findings | Result | `failureKind` |
|---|---|---|---|---|
| 0 | no | — | `pass` | — |
| 0 | yes | 0 | `pass` | — |
| 0 | yes | ≥1 | `fail` | `findings` |
| ≠0 | no / unusable | — | synthetic `fail` (current behavior) | `exit-code` |
| ≠0 | yes | 0 | synthetic `fail` | `exit-code` |
| ≠0 | yes | ≥1 | `fail` → baseline | `findings` |

### Baseline

No schema change. Once findings exist, `buildBaseline` / `partition` behave as for other sensors. RF-3.1 advises re-baseline when the stored `test` entry cannot represent per-test debt.

## Component touch list

| Area | Change |
|---|---|
| `cli/src/commands/sensors/formatters/test.ts` (+ Jest/JUnit helpers) | Parse artifacts → `SensorError[]` |
| `cli/src/commands/sensors/result.ts` | File-first branch + state table |
| types / prepare / manifest compatibility | Optional `resultsFile`; validation |
| baseline / run / status surfaces | RF-3.1 advisory |
| `docs/cli-reference.md` (+ legacy adoption note) | RF-4.1 |
| tests | Parsers, containment, state table, baseline partition, advisory |

## Acceptance mapping

| Requirement | Verified by |
|---|---|
| RF-1.1–RF-1.8 | `interpretResult` unit tests covering each state-table cell and timeout/spawn non-interference |
| RF-2.1–RF-2.7 | Parser unit tests with Jest/JUnit fixtures (including suite-failed, skip exclusions, failure+skipped tie, path relativization) |
| RF-3.1 | Advisory unit/integration when baseline `test` is empty or synthetic-only |
| RF-4.1 | Docs present; structural asserts if the repo already contracts cli-reference sections |

## Open implementation knobs (non-ambiguous defaults)

- **Size cap:** concrete byte limit chosen in the plan/implementation (multi-megabyte order; fail closed as unusable when exceeded). Not a product fork.
- **Advisory surface:** prefer the same human/machine channels already used for sensor advisories; exact string is an implementation detail as long as it is non-blocking and names re-baseline.
