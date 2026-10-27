# Sensor execution optimization (#236) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `awm sensors run` reuse `pass` results when a sensor's declared `inputs` are unchanged, keep Change Record receipts honest for unmeasured-only HEAD advances, and teach the AWM lifecycle to use `--fast` on slice DONE while keeping a full gate for QA/docs/finishing — without false greens.

**Architecture:** Additive `inputs` on pack variants and project manifests; a local input-digest cache consulted inside `runSensors`; receipt schema 2 carrying measured digests so `change validate` generalizes the `docs/changes/` carve-out; skill/pack updates in the sibling `awm-baseline-registry` checkout. Contract: `docs/plans/2026-10-27-sensor-execution-optimization-design.md`.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, existing sensors/change pipelines; baseline registry packs + skills + Node contract tests.

**Change Record:** `sensor-execution-optimization`

**Criterios de aceptación:**
- Tras un `pass` full-gate, un commit que solo toca README/`AGENTS.md`/plan y un nuevo `awm sensors run` termina en segundos con sensores cacheables en `cached: true` y escribe recibo para el nuevo HEAD
- Un cambio bajo un glob de `inputs` de un sensor invalida solo ese sensor (y los que lo listan); el resto puede seguir cacheado
- DONE de slice acepta `awm sensors run --fast` con `overall: pass`; QA/docs/finishing exigen full-gate; `--fast` no sirve de evidencia de cierre
- `awm change validate --strict` no emite `code-changed-after-verification` solo por paths fuera de los `inputs` del recibo schema 2
- `setup-sensors` y packs baseline documentan/declaran `inputs` para que un agente no improvise globs

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** owner-approved design 2026-10-27 (#236). Dispatch: owner did not select AWM routing → `compact-slices/v1`. Force-execute flag fixed as `--no-cache` (design RF-2.9).

**File map (decomposition):**
- `cli/src/commands/sensors/compatibility/manifest.ts` + `contract.ts` — parse/allowlist `inputs`
- `cli/src/commands/sensors/inputs-digest.ts` (new) — glob resolve + stable content digest
- `cli/src/commands/sensors/result-cache.ts` (new) — read/write usable prior passes under `.awm/sensors/runs/`
- `cli/src/commands/sensors/run.ts` + `index.ts` + `types.ts` — cache decision, `--no-cache`, JSON provenance
- `cli/src/core/changes/receipt.ts` — schema 2 + digests
- `cli/src/commands/change/index.ts` — unmeasured-path validate
- `cli/src/commands/sensors/status.ts` + `cli/src/commands/preflight/checks.ts` — non-cacheable warning
- `docs/cli-reference.md` — operator docs
- Sibling `../awm-baseline-registry`: `sensor-packs/*/pack.json`, lifecycle skills, `setup-sensors`

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "sensor-execution-optimization",
  "requirements": [
    "RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7", "RF-1.8",
    "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7", "RF-2.8", "RF-2.9",
    "RF-3.1", "RF-3.2", "RF-3.3", "RF-3.4", "RF-3.5",
    "RF-4.1", "RF-4.2", "RF-4.3", "RF-4.4", "RF-4.5", "RF-4.6", "RF-4.7",
    "RF-5.1", "RF-5.2", "RF-5.3", "RF-5.4", "RF-5.5", "RF-5.6", "RF-5.7", "RF-5.8", "RF-5.9",
    "RF-6.1", "RF-6.2", "RF-6.3",
    "RF-E.1", "RF-E.2", "RF-E.3"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-27-sensor-execution-optimization-design.md",
      "locator": "## Requirements",
      "fact": "Approved RF-1..RF-6 and RF-E: inputs+cache, receipts schema 2, lifecycle fast vs full, authoring rules, --no-cache, no inferred inputs, no false green."
    },
    {
      "id": "SRC-MANIFEST",
      "path": "cli/src/commands/sensors/compatibility/manifest.ts",
      "locator": "function parseV3SensorEntry",
      "fact": "Strict fields() allowlists omit inputs today on legacy/v2/v3 project and pack-bound entries; unknown field inputs would invalidate."
    },
    {
      "id": "SRC-PACK-CONTRACT",
      "path": "cli/src/commands/sensors/compatibility/contract.ts",
      "locator": "function parseVariant",
      "fact": "Pack variant allowlist is id/priority/requirements/certifiedRange/command/changedCommand/assets/formatter/probe/policyRef — no inputs yet."
    },
    {
      "id": "SRC-RUN",
      "path": "cli/src/commands/sensors/run.ts",
      "locator": "export async function runSensors",
      "fact": "runSensors prepares then executePrepared for every selected sensor; shouldRun filters fast/slow; no result reuse."
    },
    {
      "id": "SRC-INDEX",
      "path": "cli/src/commands/sensors/index.ts",
      "locator": ".command('run')",
      "fact": "run options: --fast --slow --all --changed --base; isFullSelection gates receipt; no --no-cache."
    },
    {
      "id": "SRC-RECEIPT",
      "path": "cli/src/core/changes/receipt.ts",
      "locator": "export interface SensorReceipt",
      "fact": "Receipt schema 1 keys: schema,commit,ranAt,cliVersion,overall,sensors,digest. isFullSelection treats changed or fast-xor-slow as partial."
    },
    {
      "id": "SRC-CHANGE",
      "path": "cli/src/commands/change/index.ts",
      "locator": "function checkVerifiedCommit",
      "fact": "lateFiles filters only docs/changes/; any other path after verification.commit yields code-changed-after-verification."
    },
    {
      "id": "SRC-STATUS",
      "path": "cli/src/commands/sensors/status.ts",
      "locator": "export async function computeSensorStatus",
      "fact": "Static readiness only; no non-cacheable inputs warning today."
    },
    {
      "id": "SRC-PREFLIGHT",
      "path": "cli/src/commands/preflight/checks.ts",
      "locator": "function checkManifest",
      "fact": "PreflightCheck union + sensor checks; no inputs/cacheability advisory yet."
    },
    {
      "id": "SRC-CLI-DOCS",
      "path": "docs/cli-reference.md",
      "locator": "## Sensors (per-project computational checks)",
      "fact": "Operator sensors docs; must gain inputs, cache, --no-cache, receipt schema 2 / unmeasured paths."
    },
    {
      "id": "SRC-TYPES",
      "path": "cli/src/commands/sensors/types.ts",
      "locator": "export type SensorResult",
      "fact": "SensorResult has status/errors/certification/scope/execution; no cached or provenance fields yet."
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
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/inputs-digest.test.ts", "tests/commands/sensors/result-cache.test.ts", "tests/commands/sensors/run-cache.test.ts"],
      "covers": ["RF-1.4", "RF-1.6", "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7", "RF-2.8", "RF-2.9", "RF-6.1", "RF-6.3", "RF-E.1", "RF-E.3"]
    },
    {
      "id": "CMD-RECEIPT",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/changes/receipt.test.ts", "tests/commands/change/validate-unmeasured.test.ts"],
      "covers": ["RF-4.1", "RF-4.2", "RF-4.3", "RF-4.4", "RF-4.5", "RF-4.6", "RF-4.7", "RF-E.2"]
    },
    {
      "id": "CMD-WARN",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/status-inputs.test.ts", "tests/commands/preflight/sensors-inputs.test.ts"],
      "covers": ["RF-3.4", "RF-6.2"]
    },
    {
      "id": "CMD-CLI-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/sensor-execution-optimization-docs-contract.test.ts"],
      "covers": ["RF-3.3"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-1.1", "RF-2.1", "RF-4.3"]
    },
    {
      "id": "CMD-REGISTRY-PACKS",
      "program": "npm",
      "args": ["--prefix", "../awm-baseline-registry", "run", "test:version-bumps"],
      "covers": ["RF-3.1"]
    },
    {
      "id": "CMD-REGISTRY-SKILLS",
      "program": "npm",
      "args": ["--prefix", "../awm-baseline-registry", "run", "test:change-record"],
      "covers": ["RF-3.2", "RF-3.5", "RF-5.1", "RF-5.2", "RF-5.3", "RF-5.4", "RF-5.5", "RF-5.6", "RF-5.7", "RF-5.8", "RF-5.9"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Parse inputs on packs and manifests",
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
      "title": "Input digest, result cache, run wiring, --no-cache",
      "requirements": ["RF-1.4", "RF-1.6", "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-2.6", "RF-2.7", "RF-2.8", "RF-2.9", "RF-6.1", "RF-6.3", "RF-E.1", "RF-E.3"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN", "SRC-RUN", "SRC-INDEX", "SRC-TYPES"],
      "redCommands": ["CMD-CACHE", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-CACHE", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S3",
      "title": "Receipt schema 2 and Change Record unmeasured paths",
      "requirements": ["RF-4.1", "RF-4.2", "RF-4.3", "RF-4.4", "RF-4.5", "RF-4.6", "RF-4.7", "RF-E.2"],
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
      "requirements": ["RF-3.4", "RF-6.2"],
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
      "title": "CLI reference contract for inputs and cache",
      "requirements": ["RF-3.3"],
      "dependsOn": ["S2", "S3"],
      "sectionAnchor": "slice-s5",
      "sources": ["SRC-DESIGN", "SRC-CLI-DOCS"],
      "redCommands": ["CMD-CLI-DOCS"],
      "greenCommands": ["CMD-CLI-DOCS"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S6",
      "title": "Baseline packs inputs and lifecycle skill gates",
      "requirements": ["RF-3.1", "RF-3.2", "RF-3.5", "RF-5.1", "RF-5.2", "RF-5.3", "RF-5.4", "RF-5.5", "RF-5.6", "RF-5.7", "RF-5.8", "RF-5.9"],
      "dependsOn": ["S2", "S5"],
      "sectionAnchor": "slice-s6",
      "sources": ["SRC-DESIGN"],
      "redCommands": ["CMD-REGISTRY-PACKS", "CMD-REGISTRY-SKILLS"],
      "greenCommands": ["CMD-REGISTRY-PACKS", "CMD-REGISTRY-SKILLS"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-SCHEMA", "CMD-CACHE", "CMD-RECEIPT", "CMD-WARN", "CMD-CLI-DOCS", "CMD-TYPECHECK", "CMD-REGISTRY-PACKS", "CMD-REGISTRY-SKILLS"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Parse inputs on packs and manifests

#### Surfaces
Own RF-1.1, RF-1.2, RF-1.3, RF-1.5, RF-1.7, RF-1.8 in `cli/src/commands/sensors/compatibility/manifest.ts`, `cli/src/commands/sensors/compatibility/contract.ts`, and tests `cli/tests/commands/sensors/compatibility/manifest.test.ts`, `cli/tests/commands/sensors/compatibility/contract.test.ts`. Grouping: schema/allowlist boundary only — no digest or run behavior.

#### Implementation
1. RED — assertions that fail today:
   - Pack variant JSON with `"inputs": ["src/**/*.ts", "tsconfig.json"]` parses; values available on the variant object.
   - Project-declared and pack-bound v3 entries accepting optional `inputs` string array.
   - Project override `inputs` on a pack-bound manifest entry is retained on the parsed sensor config (RF-1.3 surface at parse).
   - Invalid: `inputs: []`, `inputs: ["/abs"]`, `inputs: ["../escape"]`, non-string element, absolute Windows-style path → entry/variant invalid naming `inputs`.
   - Unknown sibling fields still rejected (RF-1.7).
   - No code path invents inputs when omitted (RF-1.8) — omit field → parsed object has no inputs / undefined.
   Run CMD-SCHEMA; observe RED.
2. Extend allowlists: variant `inputs`; legacy sensor fields; v2 sensor fields; v3 project entry; v3 pack-bound entry. Validate each glob: non-empty string, no NUL/controls, not absolute, no `..` segment that escapes root when joined (reuse existing path-safety helpers if present; otherwise add a shared `assertSafeInputGlob` next to manifest parse).
3. Types: `inputs?: string[]` on the relevant parsed shapes; preserve order as declared.
4. GREEN — CMD-SCHEMA + CMD-TYPECHECK.

#### Edge cases
Empty array invalid (RF-1.5). Symlink packageRoot escape already covered by project containment — inputs resolution in S2 must use same root; S1 only rejects unsafe glob syntax. Soft-isolation: one sensor with bad `inputs` must not invalidate siblings (existing RF soft path).

#### Evidence
CMD-SCHEMA, CMD-TYPECHECK. Distinct specification + code-quality verdicts. Reconcile plan identity before DONE.

#### Fallback
Public-contract risk → full relevant context under Evidence Capsule; amend design if glob safety rules need a new SHALL. No delegated discovery of “what tools read.”

<a id="slice-s2"></a>
### Slice S2: Input digest, result cache, run wiring, --no-cache

#### Surfaces
Own RF-1.4, RF-1.6, RF-2.*, RF-6.1, RF-6.3, RF-E.1, RF-E.3 in new `cli/src/commands/sensors/inputs-digest.ts`, `cli/src/commands/sensors/result-cache.ts`, plus `run.ts`, `index.ts`, `types.ts`, and tests `inputs-digest.test.ts`, `result-cache.test.ts`, `run-cache.test.ts`. Grouping: runtime cache behavior as one pipeline change.

#### Implementation
1. RED — new tests (tmp dirs, HOME/AWM_HOME overridden):
   - Digest: two files matching globs → stable sha256; reorder files on disk same digest; content change changes digest; delete matched file changes digest (absence marker); unmatched README ignored.
   - No effective inputs → always execute path (spy/prepare count) even if a prior pass file exists (RF-1.4).
   - After pass with inputs, second run same tree → `cached: true`, provenance includes origin commit + inputDigest; command not spawned.
   - Change inputs list fingerprint → miss (RF-1.6).
   - Prior fail stored → not reused (RF-2.4).
   - `--fast` selection: only fast sensors considered; cache still applies inside set (RF-2.6).
   - `--changed` still scopes argv; cache may hit independently (RF-2.7).
   - `--no-cache` forces execute despite matching digest (RF-2.9); `isFullSelection` still true when only `--no-cache` is set.
   - Mixed: one cache hit + one executed fail → overall not pass (RF-E.3 / RF-6.1).
   - Tampered cache file → miss / execute (RF-E.1).
   Run CMD-CACHE; observe RED.
2. Implement `computeInputDigest(root, inputs): { digest: string; inputsFingerprint: string }` — expand globs with a bounded, deterministic matcher (prefer existing dependency if the repo already uses one for ignore/globs; otherwise Node `fs` walk + minimatch-compatible matching already in tree — verify before adding a package). Hash `sha256:` over sorted `relPath + '\\0' + content` or `relPath + '\\0' + ABSENT`.
3. Cache store under `.awm/sensors/runs/` (covered by existing runs `.gitignore`): e.g. `cache/<sensorId>.json` with `{ schema, sensorId, inputs, inputsFingerprint, inputDigest, status:'pass', originCommit, savedAt, cliVersion }` mode 0600. Only write on executed `pass`.
4. In `runSensors`, after prepare selection, for each sensor: resolve effective inputs (project override ?? pack variant ?? none); unless `opts.noCache`, try cache hit; on hit push SensorResult with `cached: true`, `cache?: { originCommit, inputDigest }`; on miss execute and on pass save cache.
5. Wire `--no-cache` on `sensors run`; pass through `RunOptions`; do not treat as partial for receipts.
6. GREEN — CMD-CACHE + CMD-TYPECHECK.

#### Edge cases
Concurrency: cache read before pool; write after each pass. Binary files hashed as raw bytes. Huge trees: digest walks only matching globs (authoring must keep globs tight — RF-6.2). Never cache `skipped`/`inconclusive`.

#### Evidence
CMD-CACHE, CMD-TYPECHECK. Spec + quality reviews. Sensors on this repo may still lack inputs until S6 — that is expected.

#### Fallback
Security risk if path escape in glob expansion → fail closed, amend RF-1.5. Do not infer inputs from `--changed`.

<a id="slice-s3"></a>
### Slice S3: Receipt schema 2 and Change Record unmeasured paths

#### Surfaces
Own RF-4.* and RF-E.2 in `cli/src/core/changes/receipt.ts`, `cli/src/commands/change/index.ts`, `cli/tests/core/changes/receipt.test.ts`, new `cli/tests/commands/change/validate-unmeasured.test.ts`. Grouping: certification contract for unmeasured HEAD advances.

#### Implementation
1. RED:
   - `buildReceipt` / `finalizeRunReceipt` with cached passes writes schema `2` including per-sensor `inputDigest` + `inputs` fingerprint (or equivalent documented map) for cacheable sensors; schema 1 still readable.
   - Full-gate all-cached pass on clean tree writes receipt for HEAD (RF-4.2, RF-4.4).
   - `change validate`: schema 2 receipt; commit README-only after verification.commit → no `code-changed-after-verification`; change `src/x.ts` listed in inputs → diagnostic fires.
   - Legacy schema 1: non-`docs/changes/` path still fails as today (RF-4.6).
   - Git failure listing late files → `git-failed` (RF-E.2).
   - Remedy text for missing HEAD receipt mentions `awm sensors run` without claiming every tool binary must re-exec (RF-4.7).
   Run CMD-RECEIPT; RED.
2. Extend `SensorReceipt` to schema 2 (discriminated): keep digest integrity over canonical JSON including new fields. `readReceipt` accepts 1 and 2; tamper → `receipt-invalid`.
3. `checkVerifiedCommit` / `lateFiles`: when receipt is schema 2, filter out paths outside union of recorded sensor inputs (and existing runtime excludes + `docs/changes/`). Schema 1 keeps prior filter (only `docs/changes/`).
4. Ensure `isFullSelection` unchanged regarding `--no-cache`. Cached-only full gate still withholds receipt on dirty tree / invalidEntries / packDrift / not_certified per existing R2.
5. GREEN — CMD-RECEIPT + CMD-TYPECHECK.

#### Edge cases
Sensor without inputs on a schema 2 receipt: that receipt cannot use broad unmeasured reuse (RF-4.6) — either omit schema 2 measured map for that sensor and fall back to strict late-path, or require execute-on-HEAD for no-inputs sensors before rewrite (design RF-4.4). Implement the design literally: no-inputs sensors must have been executed on this HEAD for RF-4.4 rewrite; validate still treats absence of measured digests for those sensors as blocking broad reuse.

#### Evidence
CMD-RECEIPT, CMD-TYPECHECK. Spec + quality. Amend Change Record design docs only if plan review finds R2/R4 text must cite schema 2 (optional doc touch inside this slice if a test demands it).

#### Fallback
Security: never treat git failure as empty late set. Public contract: keep schema 1 readers working.

<a id="slice-s4"></a>
### Slice S4: Status and preflight non-cacheable warnings

#### Surfaces
Own RF-3.4, RF-6.2 in `status.ts`, `preflight/checks.ts`, tests `status-inputs.test.ts`, `sensors-inputs.test.ts`. Grouping: advisory surfaces for missing inputs.

#### Implementation
1. RED — configured enabled sensor without effective inputs → status output and preflight check include non-blocking warning text that the sensor is not cacheable / always executes. Sensors with inputs do not warn. Run CMD-WARN; RED.
2. Resolve effective inputs the same way as run (project ?? pack). Advisory only (`advisory: true` / warn status) — must not fail ready gates alone.
3. GREEN — CMD-WARN + CMD-TYPECHECK.

#### Edge cases
Opt-out / native-gate manifests: no spurious inputs warnings. Soft-isolated invalid entries: do not claim cacheable.

#### Evidence
CMD-WARN, CMD-TYPECHECK.

#### Fallback
If preflight Check id union must expand, extend it explicitly; do not overload unrelated check ids.

<a id="slice-s5"></a>
### Slice S5: CLI reference contract for inputs and cache

#### Surfaces
Own RF-3.3 in `docs/cli-reference.md` and `cli/tests/structural/sensor-execution-optimization-docs-contract.test.ts`. Grouping: operator documentation closure for the CLI half.

#### Implementation
1. RED — structural test requires cli-reference to document: `inputs` globs, cache hit / `cached`, `--no-cache`, receipt schema 2 / unmeasured paths vs Change Record, and that missing inputs means always execute. Scope assertions to the Sensors section body (not frontmatter-wide vacuous matches). Run CMD-CLI-DOCS; RED.
2. Edit `docs/cli-reference.md` Sensors section accordingly.
3. GREEN — CMD-CLI-DOCS.

#### Edge cases
Vacuous regex lesson (AGENTS.md): slice section windows; mutate-delete check in the test author's mind before commit.

#### Evidence
CMD-CLI-DOCS. Spec + quality.

#### Fallback
Public docs contract — amend design if wording conflicts with RF-5 skill commands.

<a id="slice-s6"></a>
### Slice S6: Baseline packs inputs and lifecycle skill gates

#### Surfaces
Own RF-3.1, RF-3.2, RF-3.5, RF-5.1–RF-5.9 in sibling repo `../awm-baseline-registry`: `sensor-packs/{js-ts,python,shell,generic}/pack.json` (and variants), `skills/setup-sensors/SKILL.md`, `skills/subagent-driven-development/**`, `skills/executing-plans/SKILL.md`, `skills/verification-before-completion/SKILL.md`, `skills/post-implementation-qa/SKILL.md`, `skills/post-implementation-docs/SKILL.md`, `skills/finishing-a-development-branch/SKILL.md`, `skills/development-process/SKILL.md` (carve-out preserved), plus new/updated registry contract tests under `tests/` that pin the gate wording. Grouping: one content PR for agent-facing behavior; bump skill/bundle/catalog versions per registry CONSTITUTION; run `./scripts/check-skill-version-bumps.sh origin/main` before DONE.

#### Implementation
1. RED — add registry contract tests (non-vacuous, section-scoped):
   - Each shipped pack sensor variant that is enabled by default has non-empty `inputs` excluding README*, docs/plans, docs/changes, AGENTS.md, CLAUDE.md, .awm/sensors/runs (RF-3.1).
   - `setup-sensors` body teaches belongs/does-not-belong, always-execute without inputs, override rules, forbids inventing `**/*` (RF-3.2).
   - Slice DONE skills require `awm sensors run --fast` / forbid full-gate-as-slice-DONE (RF-5.1, RF-5.9).
   - QA/docs/finishing require full `awm sensors run` and forbid `--fast` as closure evidence (RF-5.3–RF-5.6).
   - verification-before-completion distinguishes implementation-loop fast gate vs closure (RF-5.2).
   - Skills say invoke the command; CLI owns reuse — no “skip sensors if only docs” agent protocol (RF-3.5).
   - development-process proportional carve-out text still present (RF-5.8); constitutions-may-harden note (RF-5.7).
   Run CMD-REGISTRY-SKILLS / CMD-REGISTRY-PACKS; RED on missing content.
2. Author `inputs` defaults per sensor (examples, adjust to real pack layout): js-ts lint → eslint configs + `*.{ts,tsx,js,jsx}` trees; typecheck → tsconfig + src; test → package scripts inputs; python mutation → measured source/tests only — never markdown. Same discipline for shell/generic.
3. Edit skills; bump versions; conventional commit on registry branch `cursor/sensor-execution-optimization-4e13` (or session branch); open registry PR titled `feat:`/`fix:` appropriately.
4. GREEN — CMD-REGISTRY-PACKS + CMD-REGISTRY-SKILLS.

#### Edge cases
Portable skills: if a skill is `portable: true`, keep body self-contained or use existing port override rules. Do not weaken finishing receipt obligations.

#### Evidence
Registry commands above + skill-version bump script. Spec + quality on registry PR. CLI plan slice DONE only when registry PR exists and contracts pass against the sibling checkout path used by CMD-*.

#### Fallback
If `npm --prefix ../awm-baseline-registry` scripts do not cover new contracts, add a dedicated `tests/rN-sensor-execution-optimization-contract.test.mjs` and point CMD-REGISTRY-SKILLS at `node --test` that file — amend plan commands via `awm plan validate` after edit. Never leave RF-5 owned without an executable contract.

## Coverage matrix (self-review)

| Requirement | Slice | Command |
|---|---|---|
| RF-1.1–1.3, 1.5, 1.7–1.8 | S1 | CMD-SCHEMA |
| RF-1.4, 1.6, RF-2.*, RF-6.1/6.3, RF-E.1/E.3 | S2 | CMD-CACHE |
| RF-4.*, RF-E.2 | S3 | CMD-RECEIPT |
| RF-3.4, RF-6.2 | S4 | CMD-WARN |
| RF-3.3 | S5 | CMD-CLI-DOCS |
| RF-3.1–3.2, 3.5, RF-5.* | S6 | CMD-REGISTRY-* |

## Handoff

After `awm plan validate` is valid: admit before dispatch. Implementation uses `subagent-driven-development` or `executing-plans`. Worktrees via `using-git-worktrees` at execution time. CLI and registry may land as coordinated PRs; Change Record slug `sensor-execution-optimization` is produced on the CLI integration branch at finishing.
