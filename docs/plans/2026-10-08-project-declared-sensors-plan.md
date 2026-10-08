# Project-Declared Sensors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let projects declare `source: "project"` sensors in schemaVersion 3 manifests (with or without a pack) that share the pack execution pipeline, with honest `project-declared` provenance that never blocks unattended gates, plus JSON-vs-schema diagnostics and docs.

**Architecture:** Extend v3 `project-sensors` parsing with a discriminated sensor entry and optional `pack`; soft-validate per entry; prepare/run/baseline/status/preflight reuse the common pipeline with a provenance tag; `exit-code` formatter; init merge preserves project entries. Coordinated `setup-sensors` docs in the sibling baseline registry checkout.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, existing sensor prepare/run/status/preflight, `awm-baseline-registry` skill docs.

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Design:** `docs/plans/2026-10-08-project-declared-sensors-design.md` (approved 2026-10-08). Dispatch: owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-209-project-declared-sensors",
  "requirements": [
    "RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8",
    "RF-1.9", "RF-1.10", "RF-1.11", "RF-1.12",
    "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7", "RF-2.8", "RF-2.9",
    "RF-3.1", "RF-3.2", "RF-3.3",
    "RF-4.1", "RF-4.2", "RF-4.3",
    "RF-5.1", "RF-5.2"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-08-project-declared-sensors-design.md",
      "locator": "## Requirements",
      "fact": "Approved RF-1.1–RF-5.2: project-declared sensors, optional pack, shared pipeline, provenance non-gating, soft isolation, diagnostics, docs."
    },
    {
      "id": "SRC-MANIFEST",
      "path": "cli/src/commands/sensors/compatibility/manifest.ts",
      "locator": "function parseV3ProjectManifest",
      "fact": "Today v3 project-sensors requires pack id, source.registry, and every sensor via parseV2Sensor (variantId + initializedCompatibility)."
    },
    {
      "id": "SRC-PREPARE",
      "path": "cli/src/commands/sensors/prepare.ts",
      "locator": "export function prepareV2Sensor",
      "fact": "Pack path re-resolves live variant command; project overrides for timeout/formatter exist for pack-bound entries only today."
    },
    {
      "id": "SRC-RESULT",
      "path": "cli/src/commands/sensors/result.ts",
      "locator": "function formatterFor",
      "fact": "Registered formatters are tsc/eslint-llm/semgrep/test/mypy/ruff/shellcheck/generic; no exit-code case yet."
    },
    {
      "id": "SRC-STATUS",
      "path": "cli/src/commands/sensors/status.ts",
      "locator": "function invalidStatus",
      "fact": "Parse/project failures collapse to manifest-malformed / schema-unsupported with repair-sensor-manifest remedy."
    },
    {
      "id": "SRC-PREFLIGHT",
      "path": "cli/src/commands/preflight/checks.ts",
      "locator": "function checkManifest",
      "fact": "invalid mode maps detail to '.awm/sensors.json is not valid JSON' unless schema-unsupported."
    },
    {
      "id": "SRC-INIT",
      "path": "cli/src/commands/sensors/init.ts",
      "locator": "const existingSensors = existing?.sensors ?? {};",
      "fact": "Per-field merge overlays pack defaults with existing sensors; must preserve source:project entries and allow pack-less manifests."
    },
    {
      "id": "SRC-CLI-DOCS",
      "path": "docs/cli-reference.md",
      "locator": "## Sensors (per-project computational checks)",
      "fact": "Operator-facing sensors documentation lives in cli-reference and must describe project-declared sensors."
    }
  ],
  "commands": [
    {
      "id": "CMD-MANIFEST",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/compatibility/manifest.test.ts"],
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.8", "RF-1.9", "RF-1.10", "RF-1.11", "RF-1.12"]
    },
    {
      "id": "CMD-RUNTIME",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/prepare.test.ts", "tests/commands/sensors/run.test.ts"],
      "covers": ["RF-1.7", "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7"]
    },
    {
      "id": "CMD-DIAG-INIT",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/status.test.ts", "tests/commands/preflight/preflight.test.ts", "tests/commands/sensors/init.test.ts", "tests/commands/sensors/bootstrap.test.ts"],
      "covers": ["RF-2.8", "RF-2.9", "RF-3.1", "RF-3.2", "RF-3.3", "RF-4.1", "RF-4.2", "RF-4.3"]
    },
    {
      "id": "CMD-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/project-declared-sensors-docs-contract.test.ts"],
      "covers": ["RF-5.1", "RF-5.2"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-1.1", "RF-2.1", "RF-3.1"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Manifest union, optional pack, soft isolation",
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.8", "RF-1.9", "RF-1.10", "RF-1.11", "RF-1.12"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN", "SRC-MANIFEST"],
      "redCommands": ["CMD-MANIFEST", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-MANIFEST", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S2",
      "title": "Prepare, exit-code formatter, run parity, provenance",
      "requirements": ["RF-1.7", "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN", "SRC-PREPARE", "SRC-RESULT"],
      "redCommands": ["CMD-RUNTIME", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-RUNTIME", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S3",
      "title": "Status, preflight diagnostics, init preserve",
      "requirements": ["RF-2.8", "RF-2.9", "RF-3.1", "RF-3.2", "RF-3.3", "RF-4.1", "RF-4.2", "RF-4.3"],
      "dependsOn": ["S1", "S2"],
      "sectionAnchor": "slice-s3",
      "sources": ["SRC-STATUS", "SRC-PREFLIGHT", "SRC-INIT", "SRC-DESIGN"],
      "redCommands": ["CMD-DIAG-INIT", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-DIAG-INIT", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S4",
      "title": "CLI reference and setup-sensors docs",
      "requirements": ["RF-5.1", "RF-5.2"],
      "dependsOn": ["S1", "S2", "S3"],
      "sectionAnchor": "slice-s4",
      "sources": ["SRC-CLI-DOCS", "SRC-DESIGN"],
      "redCommands": ["CMD-DOCS"],
      "greenCommands": ["CMD-DOCS"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-MANIFEST", "CMD-RUNTIME", "CMD-DIAG-INIT", "CMD-DOCS", "CMD-TYPECHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Manifest union, optional pack, soft isolation

#### Surfaces
Own RF-1.1–RF-1.6 and RF-1.8–RF-1.12 in `cli/src/commands/sensors/compatibility/manifest.ts` (types + parse) and `cli/tests/commands/sensors/compatibility/manifest.test.ts`. Introduce a discriminated project sensor entry and optional pack while keeping pack-bound parse rules. RF-1.7 (live pack id collision) is owned by S2 when the pack sensor map is available. Grouping: one cohesive schema boundary; no runtime execution in this slice.

#### Implementation
1. RED — extend `manifest.test.ts` with cases that fail on current code:
   - v3 with `"source":"project"` entry (enabled, structured command, no variantId) accepted alongside pack-bound lint.
   - only-project manifest: no `pack` key, one project sensor → accepted; `pack: null` accepted equivalently.
   - project entry with `variantId` or `initializedCompatibility` → entry invalid reason names the field.
   - project entry without `source:"project"` but with only a custom command shape that is not pack-parseable → invalid naming missing `source` (RF-1.2): assert via the soft-parse result API below, not a whole-document throw that pretends non-JSON.
   - unknown formatter `not-a-formatter` on project entry → invalid; omit formatter → defaults to `exit-code` in parsed form.
   - applicability omitted → present as always-applicable / absent field meaning always applicable; invalid applicability shape → field-named invalid.
   - v2 manifest containing `source:"project"` → throws/rejects with migrate-to-v3 reason.
   - one broken project field + one valid pack sensor → soft result keeps pack sensor executable and lists invalid project entry (RF-1.12).
   Run CMD-MANIFEST; observe RED.
2. Change the public parse API so entry-level failures do not use a single throw that callers map to “not valid JSON”:
   - Keep `parseSensorManifest` for strict whole-document success when every entry is valid (existing callers).
   - Add `parseSensorManifestWithIssues` (name may match repo style) returning `{ kind, pack|manifest, invalidEntries: { name, reason }[] }` for v3 project-sensors, validating each sensor independently after JSON-level/`fields` root checks.
   - Document-level errors (root not object, bad schemaVersion, mode) still throw.
   - Soft path: root accepted; per-sensor invalid collected; valid sensors populated.
3. Types: extend `SensorManifestV3ProjectSensors`:
   - `pack?: string | null`
   - `source?: { registry: string }` required only when `pack` is a nonempty string
   - `sensors` values = pack-bound (existing) | project `{ source: 'project'; enabled; command; formatter?: string; fast?; timeout?; assets?; applicability?; description? }` without variantId/initializedCompatibility
4. `parseV3ProjectManifest` / sensor parse: branch on `value.source === 'project'`; reuse `parseStructuredCommand` for RF-1.10; formatter allowlist = registered CLI formatter ids including `exit-code`; default formatter `exit-code` when omitted.
5. GREEN — CMD-MANIFEST + CMD-TYPECHECK.

#### Edge cases
- Empty `sensors` object with no pack → valid only-project empty manifest (enabled count 0) is allowed at parse; preflight opt-out rules unchanged.
- `description` optional string, single-line, no NUL — unknown fields on project entries rejected like pack entries.
- Physical path rule for v3 serialization still applies to project commands (RF portable copy).

#### Evidence
CMD-MANIFEST proves schema; CMD-TYPECHECK for union types. Distinct specification and code-quality reviews; reconcile plan digest.

#### Fallback
Public-contract: if soft-parse breaks migrate/serialize callers, amend to keep strict `parseSensorManifest` throwing on any invalid entry for serialize-only paths while status/run use WithIssues. Do not weaken pack-bound validation.

---

<a id="slice-s2"></a>
### Slice S2: Prepare, exit-code formatter, run parity, provenance

#### Surfaces
Own RF-1.7 and RF-2.1–RF-2.7 in `prepare.ts`, `result.ts`, `run.ts`, and tests `prepare.test.ts` / `run.test.ts` (add `exit-code` / interpret cases in `run.test.ts` or a new `result.test.ts` included in CMD-RUNTIME if created). Project sensors enter the same PreparedSensorExecution pipeline with provenance `project-declared`. Live pack id collision (`project-sensor-name-collision`) is enforced when the pack sensor map is loaded. Grouping: one runtime behavior boundary after schema exists.

#### Implementation
1. RED — add/extend tests:
   - `formatterFor` / interpretResult (via `run.test.ts` or new `result.test.ts` wired into CMD-RUNTIME): `exit-code` + code 0 → pass; code 1 → fail with truncated combined output evidence; no per-file errors required.
   - prepare project entry: builds structured command from manifest entry, formatter default exit-code, timeoutSource `project` when timeout set, certification/provenance `project-declared` (never `certified`).
   - run fixture: pack lint + project `iac-format` with executable `node` script exiting 0 → both in results; project row provenance project-declared; overall pass.
   - same with project script exiting 1 → overall fail (RF-2.5).
   - schema-invalid project sibling + valid pack → pack still runs; invalid listed; not empty sensors-only malformed (RF-2.6) — may need run.ts wired to WithIssues from S1.
   - baseline: project fail suppressed when baselined as known sensor-level debt (same baseline API as pack) (RF-2.7).
   - RF-2.3: status/overall helpers do not treat `project-declared` as DEGRADED/fail by itself — assert a passing project-only run yields overall pass.
   - RF-1.7 live collision: pack `python`/`js-ts` fixture with project name equal to a pack sensor id → that project entry invalid, pack sensor remains.
   Run CMD-RUNTIME RED.
2. Implement `exit-code` in `formatterFor`; wire interpretResult so non-zero + exit-code → fail with truncated stdout/stderr (reuse existing truncation helpers if any; else cap message length consistently with generic fail path).
3. Prepare branch for project entries: skip live variant re-resolution; use entry.command; set provenance; apply applicability from entry.
4. Run/status consumption of invalidEntries from soft parse.
5. GREEN — CMD-RUNTIME + CMD-TYPECHECK.

#### Edge cases
- Unknown formatter already invalid at parse — prepare must not see it.
- Spawn errors still fail the project sensor like pack (RF-2.1).
- Write-unsafe command rejection: reuse pack structured-command validation only (no second denylist).

#### Evidence
CMD-RUNTIME empirical fixture runs; CMD-TYPECHECK. Spec + quality reviews.

#### Fallback
Security: never introduce shell execution for project commands. If baseline API cannot express sensor-level exit-code debt, amend design with durable note — do not skip RF-2.7 silently.

---

<a id="slice-s3"></a>
### Slice S3: Status, preflight diagnostics, init preserve

#### Surfaces
Own RF-2.8, RF-2.9, RF-3.1–RF-3.3, RF-4.1–RF-4.3 in `status.ts`, `run.ts` JSON reasons, `preflight/checks.ts`, `init.ts` / bootstrap materialize paths, and matching tests (`status.test.ts`, `preflight.test.ts`, `init.test.ts`, `bootstrap.test.ts`). Grouping: operator-facing diagnosis + non-destructive regen.

#### Implementation
1. RED — tests that fail today:
   - Preflight (`preflight.test.ts` covering `checkManifest`): given sensors.json that `JSON.parse`s but fails schema on one project field, detail MUST NOT be `.awm/sensors.json is not valid JSON`; MUST name sensor/field; mode/reason schema-invalid family (RF-4.1, RF-4.2).
   - Truly broken JSON still gets not-valid-JSON.
   - `sensors status` only-project: lists each project sensor with project-declared; not empty Pack none with zero checks (RF-2.8).
   - coverage only-project: inconclusive / no pack reference, not certified coverage (RF-2.9).
   - `sensors run` JSON with one invalid project entry includes named invalid reason; sensors array not forced empty when pack siblings valid (RF-4.3).
   - init: existing project entry preserved after regenerating pack sensors (RF-3.1); only-project write path does not force `pack: "generic"` (RF-3.2); remedy for project schema error is not first-line `awm sensors init` (RF-3.3).
   Run CMD-DIAG-INIT RED.
2. Fix `checkManifest` mapping: distinguish parse failure vs schema invalid from status.reason.
3. Status rendering for pack null + project sensors.
4. Init/bootstrap merge: if `existingSensors[name].source === 'project'`, keep entry as-is (do not overlay pack defaults onto it); when writing only-project, omit pack.
5. GREEN — CMD-DIAG-INIT + CMD-TYPECHECK.

#### Edge cases
- native-gate / opt-out modes unchanged.
- Honest empty pack (no pack.json) behavior unchanged when pack is set and project entries absent.

#### Evidence
CMD-DIAG-INIT. Spec + quality reviews.

#### Fallback
If bootstrap planner cannot omit pack without a new mode flag, amend with explicit `packSelection` / planner field — do not lie with `generic`.

---

<a id="slice-s4"></a>
### Slice S4: CLI reference and setup-sensors docs

#### Surfaces
Own RF-5.1–RF-5.2 in `docs/cli-reference.md`, sibling `awm-baseline-registry/skills/setup-sensors/SKILL.md` (version bump per registry CONSTITUTION), and `cli/tests/structural/project-declared-sensors-docs-contract.test.ts`. Grouping: one documentation closure for operators.

#### Implementation
1. RED — add `cli/tests/structural/project-declared-sensors-docs-contract.test.ts`:
   - `docs/cli-reference.md` must contain `source: "project"` or `source": "project"`, `project-declared`, `exit-code`, and a sentence that provenance does not block unattended/gates (RF-5.2).
   - Resolve `path.join(repoRoot, '..', 'awm-baseline-registry', 'skills', 'setup-sensors', 'SKILL.md')`; file must exist in this workspace; must document when to use project sensors vs packs, include a minimal JSON example with `"source": "project"`, and state that `project-declared` does not block unattended gates (RF-5.1).
   Run CMD-DOCS RED.
2. Update `docs/cli-reference.md` sensors section accordingly.
3. In sibling registry on branch `cursor/project-sensors-docs-0bbc` (or same agent session): edit `skills/setup-sensors/SKILL.md`, bump skill/bundle/catalog versions, run registry skill-version check script, commit/push registry PR.
4. GREEN — CMD-DOCS.

#### Edge cases
- Contract test fails loudly if sibling registry checkout is missing (do not silent-skip).
- Do not mark project sensors as certified in any doc example.

#### Evidence
CMD-DOCS. Spec review reads both doc surfaces; quality review checks version bumps on registry side.

#### Fallback
Public-contract: if registry PR must land after CLI release, keep docs examples accurate to shipped CLI flags; do not document APIs not in the CLI PR.

---

## Traceability matrix

| Req | Task(s) | Test(s) |
|------|---------|---------|
| RF-1.1 | S1 | CMD-MANIFEST project entry accepted |
| RF-1.2 | S1 | CMD-MANIFEST missing source invalid |
| RF-1.3 | S1 | CMD-MANIFEST pack-bound still requires variantId |
| RF-1.4 | S1 | CMD-MANIFEST forbidden fields on project |
| RF-1.5 | S1 | CMD-MANIFEST pack omitted/null |
| RF-1.6 | S1 | CMD-MANIFEST pack + project map |
| RF-1.7 | S2 | CMD-RUNTIME live pack name collision (`project-sensor-name-collision`) |
| RF-1.8 | S1 | CMD-MANIFEST v2 rejects source project |
| RF-1.9 | S1 | CMD-MANIFEST formatter default/allowlist |
| RF-1.10 | S1 | CMD-MANIFEST structured command reuse |
| RF-1.11 | S1 | CMD-MANIFEST applicability optional/invalid |
| RF-1.12 | S1 | CMD-MANIFEST soft isolation |
| RF-2.1 | S2 | CMD-RUNTIME shared pipeline fixture |
| RF-2.2 | S2 | CMD-RUNTIME provenance label |
| RF-2.3 | S2 | CMD-RUNTIME pass overall with project-declared |
| RF-2.4 | S2 | CMD-RUNTIME exit-code formatter |
| RF-2.5 | S2 | CMD-RUNTIME overall fail on project exit 1 |
| RF-2.6 | S2 | CMD-RUNTIME invalid sibling isolation |
| RF-2.7 | S2 | CMD-RUNTIME baseline parity |
| RF-2.8 | S3 | CMD-DIAG-INIT status detail only-project |
| RF-2.9 | S3 | CMD-DIAG-INIT coverage inconclusive |
| RF-3.1 | S3 | CMD-DIAG-INIT init preserve |
| RF-3.2 | S3 | CMD-DIAG-INIT only-project write |
| RF-3.3 | S3 | CMD-DIAG-INIT remedy not init-first |
| RF-4.1 | S3 | CMD-DIAG-INIT preflight JSON vs schema |
| RF-4.2 | S3 | CMD-DIAG-INIT named field errors |
| RF-4.3 | S3 | CMD-DIAG-INIT run JSON invalid entries |
| RF-5.1 | S4 | CMD-DOCS setup-sensors contract |
| RF-5.2 | S4 | CMD-DOCS cli-reference contract |

## File structure (locked)

| File | Responsibility |
|---|---|
| `cli/src/commands/sensors/compatibility/manifest.ts` | Schema union, soft parse, optional pack |
| `cli/src/commands/sensors/prepare.ts` | Project prepare + collision vs live pack |
| `cli/src/commands/sensors/result.ts` | `exit-code` formatter |
| `cli/src/commands/sensors/run.ts` | Consume invalidEntries; overall parity |
| `cli/src/commands/sensors/status.ts` | Provenance + only-project detail |
| `cli/src/commands/preflight/checks.ts` | JSON vs schema detail |
| `cli/src/commands/sensors/init.ts` (+ bootstrap/materialize as needed) | Preserve project; pack-less write |
| `docs/cli-reference.md` | Operator docs |
| `../awm-baseline-registry/skills/setup-sensors/SKILL.md` | Skill guidance + version bump |
| Matching `cli/tests/**` + structural docs contract | RED/GREEN evidence |
