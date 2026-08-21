# Sensor Gate Honesty and Execution Readiness Design

**Issues:** [#95](https://github.com/Kodria/agentic-workflow/issues/95), [#96](https://github.com/Kodria/agentic-workflow/issues/96), [#97](https://github.com/Kodria/agentic-workflow/issues/97), [#98](https://github.com/Kodria/agentic-workflow/issues/98)

**Scope:** coordinated changes in `agentic-workflow` and `awm-baseline-registry`

**Execution mode after planning:** unattended, gated by empirical sensor verification

## Requirements

- **R1 — Common execution pipeline:** WHEN AWM prepares a legacy or schema-v2 sensor run, THE CLI SHALL adapt every selected sensor to one common execution representation before process dispatch and SHALL use the same execution, result interpretation, baseline, scope, and overall-reduction stages for both manifest kinds.
- **R1.1 — Live v2 authority:** WHEN AWM prepares a schema-v2 sensor, THE CLI SHALL execute only the command re-resolved from the live registry variant and SHALL NOT authorize a replacement command stored in the project manifest.
- **R1.2 — Shared context:** WHEN a sensor run starts, THE CLI SHALL resolve the manifest root, baseline, changed-file set, and comparison base at most once for that run.
- **R1.3 — Invalid baseline scope:** IF a caller combines changed-file scoping with baseline capture, THEN THE CLI SHALL fail before resolving or executing any sensor process.

- **R2 — Baseline parity:** WHEN a schema-v2 sensor emits attributable findings, THE CLI SHALL apply the committed project baseline with the same suppression and counting semantics as a legacy sensor.
- **R2.1 — Inconclusive baseline:** IF a sensor is skipped or inconclusive, THEN THE CLI SHALL NOT convert it to `pass` through baseline suppression.

- **R3 — Per-sensor timeout override:** WHERE a schema-v2 project manifest declares `sensors.<name>.timeout`, THE CLI SHALL accept only a positive safe-integer millisecond value and SHALL preserve that operator override across subsequent `awm sensors init` runs.
- **R3.1 — Timeout precedence:** WHEN preparing a sensor, THE CLI SHALL select the effective timeout in the order project override, pack sensor recommendation, then the existing `fast`/`slow` fallback.
- **R3.2 — Timeout evidence:** WHEN a sensor result is rendered, THE CLI SHALL expose its effective timeout and whether it came from the project, pack, or fallback.
- **R3.3 — Invalid timeout:** IF any timeout value is zero, negative, fractional, non-numeric, or outside the safe-integer range, THEN THE CLI SHALL fail loudly before process execution.
- **R3.4 — Bounded execution:** THE CLI SHALL always enforce a finite positive timeout and SHALL NOT provide an unbounded-execution value.

- **R4 — Structured changed command:** WHERE a v2 registry variant declares `changedCommand`, THE CLI SHALL validate it as a shell-free structured command with exactly one standalone `{files}` argument and a non-empty allowlist of file extensions.
- **R4.1 — Literal changed argv:** WHEN `--changed` is requested and a sensor supports it, THE CLI SHALL filter the resolved changed files by the declared extensions and SHALL expand them as literal argv entries without shell interpolation.
- **R4.2 — Unsupported scoping:** WHEN `--changed` is requested and a sensor has no changed command, THE CLI SHALL execute its full command and SHALL report `scope: full` with an explicit unsupported-scope reason.
- **R4.3 — Unresolved diff:** IF Git cannot resolve the requested changed-file set, THEN THE CLI SHALL execute full commands, SHALL expose the Git error in run-level scope evidence, and SHALL NOT label any result as changed-scoped.
- **R4.4 — Empty applicable diff:** WHEN Git resolves the diff successfully and no changed file is applicable to a selected changed-capable sensor, THE CLI SHALL emit `pass` for that sensor with `scope: changed` and `files: 0` evidence.
- **R4.5 — Mixed empty/full run:** WHEN an empty changed-capable sensor coexists with a selected sensor that requires full execution, THE global reducer SHALL combine their actual results rather than short-circuiting the run to `pass`.
- **R4.6 — Scope evidence:** WHEN a sensor finishes, THE CLI SHALL report its effective scope and SHALL report the reason for every fallback from requested changed scope to full scope.

- **R5 — Process verdict:** WHEN `awm sensors run` finishes, THE CLI SHALL return process exit `0` only for global `pass` and SHALL return process exit `1` for global `fail`, `not_certified`, or `skipped`.
- **R5.1 — Machine distinction:** WHEN the process exits non-zero, THE JSON verdict SHALL continue to distinguish attributable findings, an inconclusive run, and a run in which no sensor executed.
- **R5.2 — No false certification:** IF any required selected sensor times out, crashes, overflows its output bound, emits unparseable output, or cannot execute, THEN THE global run SHALL NOT be `pass`.

- **R6 — Static status semantics:** WHEN `awm sensors status` validates a schema-v2 configuration without running the project sensor command, THE CLI SHALL report `READY` rather than `HEALTHY` or `certified`.
- **R6.1 — Status states:** THE status command SHALL distinguish `READY`, `DEGRADED`, and `NOT_CONFIGURED`, and SHALL describe compatibility evidence without implying an empirical project run.
- **R6.2 — Status cost:** THE default status command SHALL remain a bounded static readiness check and SHALL NOT execute the full project sensor suite.

- **R7 — Empirical preflight:** WHERE `awm preflight --verify-sensors` is requested, THE CLI SHALL run the complete selected sensor gate with the effective baseline, commands, and timeouts and SHALL require a global `pass`.
- **R7.1 — Blocking preflight:** IF empirical preflight observes findings, timeout, crash, invalid output, omitted execution, or any other non-pass verdict, THEN preflight SHALL fail and SHALL identify the sensor, effective timeout, elapsed duration, and actionable reason.
- **R7.2 — Read-only preflight:** THE empirical preflight SHALL NOT rewrite the sensor manifest, baseline, registry assets, project configuration, or source tree.
- **R7.3 — Attended boundary:** WHEN `writing-plans` prepares an unattended execution handoff, THE skill SHALL require a successful `awm preflight --verify-sensors` while the user is still present.

- **R8 — Unattended enforcement:** WHILE a plan is executing unattended, IF a sensor gate returns any non-pass verdict, THEN the execution workflow SHALL stop task progression, diagnose the cause, and SHALL NOT mark the task complete or advance toward QA, retro, or PR.
- **R8.1 — Timeout remediation:** IF unattended diagnosis proves that a configured timeout is insufficient for a healthy progressing process, THEN the workflow SHALL record a justified finite override and SHALL require a new conclusive sensor run before continuing.

- **R9 — ESLint 8 TypeScript safety:** WHEN the `eslint-8-eslintrc` overlay extends a project using `@typescript-eslint`, THE registry asset SHALL preserve the project's TypeScript-aware rule decisions and SHALL NOT reactivate base `no-unused-vars` or `no-undef` on TypeScript files.
- **R9.1 — JavaScript coverage:** WHEN the ESLint 8 overlay checks JavaScript files, THE registry asset SHALL retain the intended base `no-unused-vars` and `no-undef` protections for those files.
- **R9.2 — Generated output:** WHEN the ESLint 8 overlay runs on a conventional JS/TS project, THE registry asset SHALL exclude generated output directories including `dist`, `build`, and `coverage` without excluding project-owned source directories such as `scripts`.
- **R9.3 — Empirical registry certification:** THE registry SHALL certify `eslint-8-eslintrc` with a real TypeScript fixture using ESLint 8 and `@typescript-eslint`, and SHALL prove an exit code of `0` or `1`, valid JSON output, no generated-output parse noise, and active JavaScript rules.

- **R10 — Compatibility:** THE CLI SHALL preserve operational support for legacy manifests and existing schema-v2 manifests that omit the new optional fields.
- **R10.1 — Release ordering:** WHEN the registry publishes fields that require the new CLI parser, THE CLI release SHALL already be available and the registry SHALL declare the corresponding minimum CLI version.
- **R10.2 — Platform contract:** THE changed-file, timeout, exit-code, status, and preflight behavior SHALL be covered on Linux, macOS, and native Windows without introducing shell execution into the v2 path.

## Context and Problem

Schema-v2 sensor execution introduced live compatibility revalidation and shell-free commands, but it also created a second early-return pipeline in `runSensors`. That path never reaches the mature legacy stages that load baselines, resolve changed files, select configured timeouts, and attach scope evidence. The split causes #95 and makes future parity regressions likely.

The surrounding readiness signals compound the problem. `not_certified` deliberately exits zero, so CI cannot distinguish an inconclusive gate from success (#96). `sensors status` calls static compatibility evidence `certified` and renders `HEALTHY`, even though the project command may crash (#97). The published ESLint 8 eslintrc asset demonstrates that mismatch: its JavaScript-only certification fixture passes while a normal TypeScript project crashes because the overlay re-enables base rules and scans compiled output (#98).

The governing product rule is therefore: **only an empirical, conclusive sensor run may certify execution readiness.** Static checks remain useful, but their language and process exit must never imply more evidence than they collected.

## Architecture

### Common preparation model

Introduce an internal preparation boundary, conceptually `PreparedSensorExecution`, with one entry per selected sensor:

```ts
type PreparedSensorExecution = {
    name: string;
    command: LegacyCommand | StructuredCommand;
    formatter?: string;
    timeoutMs: number;
    timeoutSource: 'project' | 'pack' | 'fallback';
    requestedScope: 'full' | 'changed';
    effectiveScope: 'full' | 'changed';
    scopeReason?: string;
    baseline?: string[];
};
```

The exact type may use a discriminated union for legacy and structured commands, but downstream execution must not need to know which manifest parser produced the entry. Manifest-specific adapters own authorization and translation; shared stages own process lifecycle and verdict semantics.

### Components

| Component | Responsibility |
|---|---|
| Run-context loader | Locate and parse the manifest, load baseline once, and resolve changed files once. |
| Legacy adapter | Convert legacy string commands and existing `changedCmd` configuration into prepared entries. |
| V2 adapter | Re-resolve the live registry variant, select its authorized full/changed structured command, and merge allowed operator overrides. |
| Timeout resolver | Validate and choose project, pack, or fallback timeout with explicit provenance. |
| Scope resolver | Select full or changed execution, filter extensions, expand literal argv, and record fallback evidence. |
| Common executor | Enforce timeout/output bounds and collect stdout, stderr, exit code, signal, and elapsed duration. |
| Result interpreter | Parse formatter output, classify failure/inconclusive/pass, apply baseline, and attach execution evidence. |
| Verdict reducer | Produce the global semantic verdict and the process exit code. |
| Static status adapter | Render preparation/compatibility readiness without running project commands. |
| Empirical preflight check | Execute the real common pipeline and require a global pass at the unattended boundary. |

### Authorization boundary

Schema-v2 manifests remain records of selected variant and operator intent, not executable authority. Runtime commands come from the currently resolved registry variant. `enabled` and `timeout` are allowed project-owned overrides; command, formatter, asset, and environment fields remain registry-owned.

`awm sensors init` must merge allowed overrides from the existing valid manifest into newly materialized state. Invalid existing overrides fail loudly rather than being silently retained or discarded.

## Data Flow

```text
manifest + live registry + options
            |
            v
      load run context  ---- baseline / changed files resolved once
            |
      +-----+-----+
      |           |
 legacy adapter  v2 adapter (live command authority)
      |           |
      +-----+-----+
            v
 PreparedSensorExecution[]
            |
       bounded executor
            |
 formatter -> classification -> baseline -> evidence
            |
       verdict reducer
            |
 JSON result + process exit
```

`status` stops after preparation and compatibility rendering. `preflight --verify-sensors` and `sensors run` continue through execution and reduction. This keeps one semantic owner without making routine status checks expensive.

## Schema-v2 Extensions

### Project manifest timeout

Each v2 sensor may carry an optional positive safe-integer `timeout` in milliseconds. It is project-owned and preserved by re-initialization. Pack sensor definitions may carry their own optional recommendation. The effective value and source are emitted on every attempted result, including timeouts and crashes.

### Changed command

The existing full `command` remains executable for an unscoped run. A variant may declare a separate optional `changedCommand`, using the same closed `StructuredCommand` grammar plus the existing `fileInput` contract. This avoids overloading one argv template with incompatible full-run and changed-run meanings.

Changed filenames are expanded as distinct argv entries. They never pass through a shell or become substrings of another argument. An unsupported or unresolved scope falls back to the full authorized command and is visible in both per-sensor and run-level evidence.

## Verdict and Rendering Semantics

| Global verdict | Meaning | Exit |
|---|---|---:|
| `pass` | Every required applicable check certified, or a resolved changed scope contained zero applicable files | 0 |
| `fail` | Attributable actionable findings or a defined execution failure | 1 |
| `not_certified` | Execution was attempted but evidence is incomplete or uninterpretable | 1 |
| `skipped` | No sensor executed because of selection or configuration | 1 |

JSON remains the source for the semantic distinction; the process exit answers the binary gate question. Command wiring must use `process.exitCode` after writing output so piped JSON is not truncated.

Per-sensor output adds effective timeout and scope evidence. Existing fields remain backward compatible. New fields are additive and deterministic; paths and raw environment values must not leak through diagnostics.

## Status and Empirical Preflight

`sensors status` reports static readiness:

- `READY`: manifest, live variant, assets, tools, versions, and probes are usable.
- `DEGRADED`: missing/incompatible evidence, drift, invalid assets, or failed probes.
- `NOT_CONFIGURED`: no usable manifest.

The word `certified` may remain inside low-level compatibility evidence where it means a version range was certified by the registry, but the human status renderer must not present that as an empirical project verdict.

`awm preflight --verify-sensors` adds a blocking `sensors-execution` check. It runs the full common gate read-only and reports the semantic verdict plus actionable evidence. This mode is intentionally more expensive than default preflight. The entry preflight remains advisory and fast; the `writing-plans` handoff gate invokes empirical verification before an unattended plan can begin.

## ESLint 8 eslintrc Overlay

The CJS overlay continues to extend the project's native eslintrc. Universal rules may remain global only when they are safe under the TypeScript parser. Base `no-unused-vars` and `no-undef` move into JavaScript-only overrides. TypeScript files inherit the project's `@typescript-eslint` configuration rather than having base rules re-enabled afterward.

The overlay excludes conventional generated output (`dist`, `build`, `coverage`) while retaining legitimate project source such as `scripts` and JavaScript configuration files. The certification fixture must model a TypeScript project, not infer TypeScript compatibility from a JavaScript sample.

## Error Handling and Robustness

- Public parsers and resolvers validate every input and throw explicit actionable errors.
- Contract validation occurs before Git or process I/O whenever the invalidity is already knowable.
- V2 commands remain shell-free, with a closed executable resolution and environment allowlist.
- Every process remains bounded by timeout, output cap, and process-tree termination.
- A timeout with partial parseable findings may report those findings, but it may never become a clean pass.
- Baseline never suppresses skipped or inconclusive execution into success.
- Empirical preflight is read-only and fails closed when it cannot establish a verdict.
- Diagnostic output includes enough provenance to remediate configuration without exposing registry-local absolute paths, raw environment, or unbounded tool output.

## Testing Strategy

### CLI regressions

- Schema-v2 baseline suppresses an accepted exact finding; reverting the common baseline stage makes the test fail.
- `--ignore-baseline` exposes all v2 findings and changed capture is rejected before execution.
- V2 changed commands receive only eligible literal argv entries; unsupported and Git-error fallbacks report full scope honestly.
- A resolved empty applicable diff returns pass with zero-file evidence.
- Project timeout overrides pack timeout, pack timeout overrides fallback, and `init` preserves the project value.
- Each invalid timeout class fails before executor invocation.
- `pass` is the only exit-zero verdict; command-level tests cover all four global states and stdout flushing.
- Static status never prints `HEALTHY` or project-level `certified` and never runs the sensor command.
- Empirical preflight catches the exact exit-2/unparseable-output class that static status cannot detect.
- Preflight verification produces no project diff.

### Registry regressions

The ESLint 8 eslintrc certification fixture installs pinned ESLint and `@typescript-eslint`, runs real `.ts` and `.js` files with generated output present, and asserts:

- exit `0` or `1`, never `2`;
- valid JSON output;
- no parser noise from generated output;
- no base TypeScript false positives/crash;
- JavaScript strict rules still fire.

The regression test is proven by reverting the relevant overlay rule/ignore change while keeping the fixture, observing red, then restoring green.

### Integration and platform evidence

- CLI unit, integration, structural, typecheck, build, and sensor suites.
- Registry schema, pack-shape, semantic, real-tool certification, and mutation gates.
- Native CI on Ubuntu, macOS, and Windows.
- Published CLI acceptance before the registry raises its minimum CLI version.

## Delivery Sequence

1. Implement and publish the CLI changes for #95, #96, and #97.
2. Verify the published CLI against legacy and v2 fixtures.
3. Extend and publish the registry contract, ESLint asset, certification fixture, and `writing-plans` empirical-preflight gate for #98 and the coordinated v2 fields.
4. Re-run published acceptance using the exact CLI and registry tags.
5. Update and close each issue only with linked PRs, versions, and reproductions.

The registry must not publish new strict fields before the compatible CLI exists. If the two PRs cannot merge in order, the second remains blocked rather than weakening parser validation.

## Non-goals

- A schema-v3 migration or broad sensor-contract rewrite.
- Unbounded or disabled process timeouts.
- Arbitrary registry-controlled environment variables or shell commands.
- Making routine `sensors status` execute the full project suite.
- Automatic deletion of generated directories or source-tree mutation during run/preflight.
- Redesigning coverage, ledger, or unrelated sensor packs.
- UI screens or visual workflow changes.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Common pipeline changes legacy behavior accidentally | Characterization tests freeze legacy results before extraction; adapters are isolated and the shared reducer is table-tested. |
| Empirical preflight is too slow | It is explicit and mandatory only at the final attended-to-unattended boundary; default status and entry preflight remain fast. |
| Registry fields break older strict parsers | Publish CLI first and raise the registry minimum CLI version atomically with the new fields. |
| A timeout is increased to hide a hung process | Require finite validated values, elapsed evidence, diagnosis, and a conclusive rerun; retain process-tree killing. |
| Generated-output ignores hide legitimate source | Limit defaults to conventional generated roots and keep project-owned directories such as `scripts`; certify both TS and JS files. |
| Changed scoping claims coverage it did not achieve | Emit requested/effective scope and fallback reason; literal argv and zero-file behavior are regression-tested. |
