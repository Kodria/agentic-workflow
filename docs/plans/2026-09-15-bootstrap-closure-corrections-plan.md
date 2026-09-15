# Bootstrap Closure Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> to execute one serial compact slice at a time with TDD, specification review,
> code-quality review, and all declared closure gates.

**Goal:** Repair the harness faults discovered by bootstrap S1 so its full Jest,
dependency, sensor-coverage, and retro gates can be evaluated without touching R1.

**Architecture:** Keep each correction isolated: relocate only Jest's suite root
outside the operator home, extract shared watch state helpers into a dependency-neutral
module, and migrate the committed v2 sensor declaration through the existing safe
bootstrap command to its logical v3 source. No product behavior, registry content, or
R1 plan is introduced.

**Tech Stack:** Node.js 24, TypeScript 5.9, Jest 30, dependency-cruiser, AWM CLI 9.7.1.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

---

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-126-bootstrap-closure-corrections",
  "requirements": ["FIX-1.1", "FIX-1.2", "FIX-2.1", "FIX-3.1"],
  "sources": [
    {"id":"SRC-JEST-SETUP","path":"cli/jest.global-setup.js","locator":"module.exports = async () =>","fact":"Current suite root is created under os.homedir()/.cache before AWM_HOME isolation."},
    {"id":"SRC-JEST-TEST","path":"cli/tests/structural/jest-environment-is-isolated.test.ts","locator":"describe('Jest environment isolation'","fact":"Existing structural suite asserts the global setup's isolation contract."},
    {"id":"SRC-WATCH-DRIVER","path":"cli/src/commands/watch/teardown-driver.ts","locator":"export async function runBeginTeardown(","fact":"Teardown driver imports four state helpers from tracks.ts, creating the reverse edge."},
    {"id":"SRC-WATCH-TRACKS","path":"cli/src/commands/watch/tracks.ts","locator":"export function applyProtocolToState(","fact":"tracks.ts owns shared state helpers and imports runBeginTeardown, closing the circular dependency."},
    {"id":"SRC-SENSOR-BOOTSTRAP","path":"cli/src/commands/sensors/bootstrap.ts","locator":"export async function planSensorBootstrap(","fact":"Existing bootstrap command safely plans and applies an equivalent v2-to-v3 logical-source migration."},
    {"id":"SRC-SENSOR-MANIFEST","path":".awm/sensors.json","locator":"\"schemaVersion\": 2","fact":"Committed project manifest records a stale machine-specific registryRoot and must become v3 logical-source configuration."}
  ],
  "commands": [
    {"id":"CMD-JEST-RED","program":"npm","args":["--prefix","cli","test","--","--runInBand","tests/structural/jest-environment-is-isolated.test.ts"],"covers":["FIX-1.1","FIX-1.2"]},
    {"id":"CMD-WATCH-TEST","program":"npm","args":["--prefix","cli","test","--","--runInBand","tests/commands/watch/track-teardown-crash.test.ts","tests/commands/watch/track-bootstrap-crash.test.ts"],"covers":["FIX-2.1"]},
    {"id":"CMD-DEPCHECK","program":"npm","args":["--prefix","cli","run","depcheck"],"covers":["FIX-2.1"]},
    {"id":"CMD-SENSOR-DRY","program":"awm","args":["sensors","bootstrap","--dry-run"],"covers":["FIX-3.1"]},
    {"id":"CMD-SENSOR-COVERAGE","program":"awm","args":["sensors","coverage","--json"],"covers":["FIX-3.1"]},
    {"id":"CMD-FULL","program":"npm","args":["--prefix","cli","test","--","--runInBand"],"covers":[]},
    {"id":"CMD-SENSORS","program":"awm","args":["sensors","run"],"covers":[]},
    {"id":"CMD-DIFF","program":"git","args":["diff","--check"],"covers":[]}
  ],
  "slices": [
    {"id":"S1","title":"Isolate Jest from operator home","requirements":["FIX-1.1","FIX-1.2"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SRC-JEST-SETUP","SRC-JEST-TEST"],"redCommands":["CMD-JEST-RED"],"greenCommands":["CMD-JEST-RED"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["If Node temporary-root semantics are uncertain, request full context and preserve all HOME/AWM_HOME assertions."]},
    {"id":"S2","title":"Break the watch import cycle","requirements":["FIX-2.1"],"dependsOn":["S1"],"sectionAnchor":"slice-s2","sources":["SRC-WATCH-DRIVER","SRC-WATCH-TRACKS"],"redCommands":["CMD-DEPCHECK"],"greenCommands":["CMD-WATCH-TEST","CMD-DEPCHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["If helper ownership cannot be extracted without behavior change, stop for amendment rather than suppressing no-circular."]},
    {"id":"S3","title":"Migrate committed sensor provenance","requirements":["FIX-3.1"],"dependsOn":["S2"],"sectionAnchor":"slice-s3","sources":["SRC-SENSOR-BOOTSTRAP","SRC-SENSOR-MANIFEST"],"redCommands":["CMD-SENSOR-DRY"],"greenCommands":["CMD-SENSOR-COVERAGE"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["If the dry-run is not an equivalent v2-to-v3 migration, stop and retain the committed manifest unchanged."]}
  ],
  "closureCommands": ["CMD-FULL", "CMD-DEPCHECK", "CMD-SENSORS", "CMD-SENSOR-COVERAGE", "CMD-DIFF"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Isolate Jest from operator home

#### Surfaces

Modify `cli/jest.global-setup.js` and `cli/tests/structural/jest-environment-is-isolated.test.ts` only.

#### Implementation

- [ ] Add a failing structural assertion that the suite root is outside `os.homedir()`, and that `HOME`, `AWM_HOME`, and `AWM_JEST_TMPDIR` identify suite-owned paths.
- [ ] Run `CMD-JEST-RED`; it must fail because the current setup creates under `os.homedir()/.cache` and leaves `HOME` inherited.
- [ ] Create the suite root directly below the system temporary directory, create a suite-owned home beneath it, then set `HOME`, `AWM_HOME`, and temporary-directory variables before tests load. Preserve deletion of `CODEX_HOME` and global teardown cleanup.
- [ ] Run `CMD-JEST-RED` GREEN. The test must prove an unscoped project-root walk cannot ascend into the operator home; do not delete or alter `/Users/cencosud/.awm/*`.

#### Edge cases

The setup must work when the original home is read-only because it no longer writes there. The real Jest process must have a suite-owned home, while the test that invokes setup in-process restores every environment variable. TDD RED then GREEN evidence is required.

#### Evidence

The focused structural suite fails before the relocation and passes after it. The
post-change suite root and all AWM paths are asserted not to be descendants of the
operator home, so a future `findProjectRoot` walk cannot select its `.git` marker.

#### Fallback

If a dependency uses an immutable `os.homedir()` rather than `HOME`, retain the system-temporary physical root and add a direct regression for that path; do not recreate a cache in the real home.

<a id="slice-s2"></a>
### Slice S2: Break the watch import cycle

#### Surfaces

Create `cli/src/commands/watch/track-state.ts`; modify `cli/src/commands/watch/tracks.ts`, `cli/src/commands/watch/teardown-driver.ts`, and focused watch tests only as needed.

#### Implementation

- [ ] Add a failing structural/dependency regression proving `teardown-driver.ts` no longer imports runtime state from `tracks.ts`, while existing crash tests still exercise begin-teardown transitions.
- [ ] Run `CMD-DEPCHECK` RED and record the exact `teardown-driver.ts → tracks.ts → teardown-driver.ts` cycle.
- [ ] Move only `EffectRunResult`, `applyProtocolToState`, `persist`, `refOf`, and `withRef` into `track-state.ts`; keep the production runtime interface in `tracks.ts` only if moving it would create a second architectural change. Make both modules import the neutral state module and retain `runBeginTeardown` behavior byte-for-byte at its public boundary.
- [ ] Run `CMD-WATCH-TEST` and `CMD-DEPCHECK` GREEN. Do not relax dependency-cruiser rules, add ignores, or alter teardown protocol decisions.

#### Edge cases

The extracted helpers preserve journal persistence, missing-track errors, immutable state transforms, and `JOIN_STRATEGY_NO_FF` behavior. The direct dependency checker is the decisive proof; passing sensors with a baseline is insufficient.

#### Evidence

The red dependency report names the exact two-module cycle. Green evidence is the
same direct checker with no cycle and both real crash suites preserving their existing
begin-teardown transitions.

#### Fallback

If `TrackRuntime` must move to avoid a remaining type/runtime edge, amend the slice with its exact consumers and regressions before moving it; do not introduce a duplicate interface.

<a id="slice-s3"></a>
### Slice S3: Migrate committed sensor provenance

#### Surfaces

Modify `.awm/sensors.json` only through the existing compiled `awm sensors bootstrap` migration; no production TypeScript changes.

#### Implementation

- [ ] Run `CMD-SENSOR-DRY`; require a single replacement of `.awm/sensors.json`, semantic equivalence, and a unique `baseline` logical source. This is the configuration equivalent of RED: the committed manifest remains v2 and coverage cannot resolve its stale physical source.
- [ ] Apply `awm sensors bootstrap` only when the dry-run evidence is equivalent and unique. Commit the generated v3 declaration; it must contain `source.registry: baseline` and no `registryRoot` or host path.
- [ ] Run `CMD-SENSOR-COVERAGE` GREEN; require parseable JSON with a non-error coverage result. Run sensors and diff checks; do not reinitialize a pack, alter registries, or rewrite baseline findings.

#### Edge cases

If the local registry inventory is ambiguous, unavailable, or source compatibility differs, the command must make no write and the slice is blocked. The migration's secure stale-byte/identity guard remains the only writer.

#### Evidence

The dry-run names a single replacement and logical baseline source before the write.
After migration, coverage emits parseable JSON from v3 configuration and the committed
manifest contains neither `registryRoot` nor a machine filesystem path.

#### Fallback

Keep the v2 file intact and stop if the CLI does not report a safe equivalent migration.

## Traceability matrix

| Requirement | Owner | Direct verification |
|---|---|---|
| `FIX-1.1` | S1 | suite root is outside operator home |
| `FIX-1.2` | S1 | HOME and AWM_HOME are suite-owned |
| `FIX-2.1` | S2 | watch crash tests plus direct depcheck |
| `FIX-3.1` | S3 | safe dry-run, v3 logical source, coverage JSON |

Forward coverage: each requirement has one slice and behavioral verification. Backward coverage: every changed source, test, and configuration file belongs to a named correction; R1 is excluded.

## Closure gates

After all three slices and their two reviews are clean, run every closure command. Then route through QA, docs, retro, and finishing only if the results are genuinely green. A pre-existing failure reproduced before its owning slice remains a blocker, never an accepted baseline for this plan.
