# Issue #231 packSelection status + doctor needs Implementation Plan
<!-- awm-qa-complete: 2026-10-19 -->
<!-- awm-docs-complete: 2026-10-19 -->
<!-- awm-retro-complete: 2026-10-19 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop false `compatibility drift` on `awm sensors status`/`preflight` when `packSelection: "explicit"` is set, and unblock `published-doctor-evidence` by aligning the wait-npm visibility guard with the three-job release gate.

**Architecture:** Two independent serial slices sharing one release train. S1 makes `packBoundOnly` preserve `packSelection: 'explicit'` and adds a status regression with an `explicit-opt-in` sensor. S2 replaces the stale two-job `needs` regex in `wait-npm-publication.test.cjs` with set equality against `{test, windows-arm-hot, windows-arm-changes}` (same contract as `native-release-artifacts`). No production workflow YAML change; `release.yml` already declares the three jobs.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, Node test runner (`.github/scripts/*.cjs`).

**Change Record:** `issue-231-packselection-doctor`

**Criterios de aceptación:**
- Con un manifiesto v2/`schemaVersion` 3 pack path que tiene `packSelection: "explicit"` y un sensor `explicit-opt-in` inicializado (prettier/format), `computeSensorStatus` reporta ese sensor `ok: true` (no `compatibility drift` / `not-applicable`)
- `node --test .github/scripts/wait-npm-publication.test.cjs` pasa contra el `release.yml` actual (`needs: [test, windows-arm-hot, windows-arm-changes]`)

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

**Modo de despacho:** proveedor-nativo

**Origen:** owner confirmed A+B; diagnosis-only (no brainstorm). Issue #231 + comment on release doctor. Dispatch: owner did not select AWM routing → `compact-slices/v1`. Out of scope: re-firing `published-doctor-evidence` for already-published 9.20.2/9.20.3 (post-merge ops).

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-231-packselection-doctor",
  "requirements": ["RF-231.1", "RF-231.2", "RF-231.3"],
  "sources": [
    {
      "id": "SRC-STATUS",
      "path": "cli/src/commands/sensors/status.ts",
      "locator": "function packBoundOnly",
      "fact": "packBoundOnly returns { schemaVersion: 2, pack, sensors } only — drops packSelection. resolveStaticV2Compatibility adds packSelection to evidence only when manifest.packSelection === 'explicit'. computeSensorStatus uses packBoundOnly(parsedPack) before static resolve."
    },
    {
      "id": "SRC-APPLIES",
      "path": "cli/src/commands/sensors/compatibility/resolve.ts",
      "locator": "function applies",
      "fact": "For applicability kind explicit-opt-in or explicit-or-supported-language, applies returns evidence.applicable === true || evidence.packSelection === 'explicit'. Without packSelection, status resolves not-applicable and staticCompatibilityCheck reports drift vs initialized variantId."
    },
    {
      "id": "SRC-STATUS-TEST",
      "path": "cli/tests/commands/sensors/status.test.ts",
      "locator": "describe('computeSensorStatus'",
      "fact": "Existing monorepo test installs a fake AWM_HOME registry pack js-ts, writes .awm/sensors.json schemaVersion 2, and asserts computeSensorStatus READY. No test currently sets packSelection or explicit-opt-in."
    },
    {
      "id": "SRC-WAIT",
      "path": ".github/scripts/wait-npm-publication.test.cjs",
      "locator": "test('release checks visibility before acceptance",
      "fact": "Test 7 asserts assert.match(workflow, /release:\\s*\\n\\s*needs: \\[test, windows-arm-hot\\]/). That two-job list is stale after PR #228. cli/package.json script test:wait-npm-publication runs this file via node --test for plan command admission."
    },
    {
      "id": "SRC-RELEASE-GATE",
      "path": "cli/tests/structural/native-release-artifacts.test.ts",
      "locator": "const RELEASE_GATE",
      "fact": "RELEASE_GATE = ['test', 'windows-arm-changes', 'windows-arm-hot'] (sorted compare). assertReleaseGate expects needs length and sorted equality. release.yml line has needs: [test, windows-arm-hot, windows-arm-changes]. Diagnosis confirmed B-H1: wait-npm test 7 still asserts the pre-#228 two-job list."
    },
    {
      "id": "SRC-RELEASE-YML",
      "path": ".github/workflows/release.yml",
      "locator": "needs: [test, windows-arm-hot, windows-arm-changes]",
      "fact": "release job needs exactly three gating jobs. published-doctor-evidence needs release and runs wait-npm-publication.test.cjs before Wait/Accept steps."
    }
  ],
  "commands": [
    {
      "id": "CMD-STATUS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/status.test.ts"],
      "covers": ["RF-231.1", "RF-231.2"]
    },
    {
      "id": "CMD-WAIT",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "test:wait-npm-publication"],
      "covers": ["RF-231.3"]
    },
    {
      "id": "CMD-STRUCT",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/native-release-artifacts.test.ts"],
      "covers": ["RF-231.3"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-231.1", "RF-231.2"]
    },
    {
      "id": "CMD-LINT",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "lint"],
      "covers": ["RF-231.1", "RF-231.2", "RF-231.3"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Preserve packSelection through packBoundOnly",
      "requirements": ["RF-231.1", "RF-231.2"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-STATUS", "SRC-APPLIES", "SRC-STATUS-TEST"],
      "redCommands": ["CMD-STATUS"],
      "greenCommands": ["CMD-STATUS", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S2",
      "title": "Align wait-npm release needs with three-job gate",
      "requirements": ["RF-231.3"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-WAIT", "SRC-RELEASE-GATE", "SRC-RELEASE-YML"],
      "redCommands": ["CMD-WAIT"],
      "greenCommands": ["CMD-WAIT", "CMD-STRUCT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-STATUS", "CMD-WAIT", "CMD-STRUCT", "CMD-TYPECHECK", "CMD-LINT"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Preserve packSelection through packBoundOnly

#### Surfaces

Owns RF-231.1 and RF-231.2 in `cli/src/commands/sensors/status.ts` (`packBoundOnly`) and a new regression in `cli/tests/commands/sensors/status.test.ts`. Grouping: one helper field drop causes both status and preflight false drift (preflight only imports `computeSensorStatus`). Do not change `resolve.ts` or `run.ts`.

#### Implementation

1. **RED — add regression in `status.test.ts`** (mirror the monorepo AWM_HOME fixture pattern):
   - Fake registry pack `js-ts` with sensor `format`: `applicability: { kind: 'explicit-opt-in' }`, one variant `prettier` with tool `prettier` path resolution, certifiedRange covering installed version, probe `package-script-present` with script `format` (or `config-present` / no probe so status stays static).
   - Project: `package.json` with `devDependencies.prettier` and `scripts.format`, `node_modules/prettier/package.json` version in range, prettier bin under `.bin` or PATH.
   - Manifest `.awm/sensors.json`: `schemaVersion: 2`, `pack: 'js-ts'`, `packSelection: 'explicit'`, sensor `format` enabled with `variantId: 'prettier'`, matching command/assets, `initializedCompatibility` certified for that variant.
   - Assert: `computeSensorStatus` → `result.checks.format.ok === true` and `result.overall` is `READY` (or at least format detail does **not** match `/compatibility drift/`).
   - Control note in comment: without the fix, detail is `compatibility drift: initialized prettier, resolved not-applicable`.
2. Run CMD-STATUS → RED (format drift / DEGRADED).
3. **GREEN — `packBoundOnly`:** after building `sensors`/`pack`, if `manifest.packSelection === 'explicit'`, include `packSelection: 'explicit'` on the returned `SensorManifestV2`. Do not invent other values; omit the key when absent.
4. Run CMD-STATUS, CMD-TYPECHECK, CMD-LINT → GREEN.
5. Commit: `fix(sensors): preserve packSelection in packBoundOnly for status`.

#### Edge cases

- Manifest without `packSelection`: behavior unchanged (opt-in sensors stay not-applicable).
- Project-declared sensors still stripped; only pack-bound entries + optional `packSelection` remain.
- v3 project-sensors path that still uses `packBoundOnly` for the pack slice inherits the same preservation (same helper).

#### Evidence

SRC-STATUS, SRC-APPLIES, SRC-STATUS-TEST. RED/GREEN: CMD-STATUS (+ typecheck/lint). Independent specification and code-quality reviews before S2.

#### Fallback

If the fixture cannot resolve the tool via discovery, amend to pin exact variant requirements used in `resolve.test.ts` / bootstrap fixtures and revalidate; do not weaken `applies()` to always-true. Full-context retains gates.

<a id="slice-s2"></a>
### Slice S2: Align wait-npm release needs with three-job gate

#### Surfaces

Owns RF-231.3 in `.github/scripts/wait-npm-publication.test.cjs` and the npm script `test:wait-npm-publication` in `cli/package.json` (plan admission cannot name bare `node` as a command program). Do not edit `release.yml` or weaken `native-release-artifacts` RELEASE_GATE. Grouping: dual structural contracts on the same field; this slice updates the stale consumer.

#### Implementation

1. Ensure `cli/package.json` scripts include `"test:wait-npm-publication": "node --test ../.github/scripts/wait-npm-publication.test.cjs"` (add in the plan/S2 commit if missing; no other package.json changes).
2. **RED:** CMD-WAIT fails on line 88 (`needs: [test, windows-arm-hot]`).
3. **GREEN — replace the brittle regex** with set-style assertion:
   - Parse the `release:` job `needs` array from the workflow text (slice from `\n  release:` to the next top-level job, or from the known `needs: [` line under release).
   - `assert.deepEqual([...parsed].sort(), ['test', 'windows-arm-changes', 'windows-arm-hot'])` (same membership as `RELEASE_GATE`).
   - Keep the Wait-before-Accept ordering asserts and `cancel-in-progress: false` unchanged.
4. Run CMD-WAIT and CMD-STRUCT → GREEN.
5. Commit: `fix(ci): align wait-npm release needs with three-job gate`.

#### Edge cases

- Order of jobs in YAML must not matter (set/sort).
- Extra or missing job names must fail.
- Do not assert a second copy of needs under `published-doctor-evidence` (that job needs `release` only).

#### Evidence

SRC-WAIT, SRC-RELEASE-GATE, SRC-RELEASE-YML. RED/GREEN: CMD-WAIT; CMD-STRUCT confirms the workflow contract still matches.

#### Fallback

If YAML parse in CJS is awkward, a single updated regex that requires all three names is acceptable only if order-independent (e.g. extract bracket contents then sort); prefer explicit set compare. Full-context retains gates.

## Traceability

| Req | Slice | Tests |
|-----|-------|-------|
| RF-231.1 | S1 | status regression: packSelection preserved → format ok |
| RF-231.2 | S1 | same fixture: no compatibility drift detail |
| RF-231.3 | S2 | wait-npm test 7 three-job set; structural RELEASE_GATE still green |

## Self-review

- Forward/backward coverage complete.
- No TBD placeholders.
- Re-fire of doctor for past npm versions explicitly out of scope.
- Dispatch `proveedor-nativo` / v1; execution `desatendido` per owner “solo necesito que funcione”.
