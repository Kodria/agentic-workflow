# Operator Environments & Registry Lifecycle Implementation Plan
<!-- awm-qa-complete: 2026-10-12 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship registry-level facts, machine-local environments, `awm env`, `awm registry scaffold`, and `awm registry doctor` so shareable registry content can declare operator/machine data without hardcoding it (#148).

**Architecture:** New `cli/src/core/facts/` (catalog + needs) and `cli/src/core/environments/` (store + resolve/inject); registry doctor/scaffold commands; one active environment under `AWM_HOME/environments/`. Handbook `REGISTRY.md` is the extensible maintainer surface; doctor is the compliance gate for any registry tree.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, Commander, existing `registries.ts` / `bundles.ts` / `frontmatter.ts` / `cli-version.ts`.

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

**Design:** `docs/plans/2026-10-12-operator-environments-design.md` (approved 2026-10-12). Dispatch: owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-148-operator-environments",
  "requirements": [
    "RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4",
    "RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5",
    "RF-3.1", "RF-3.2", "RF-3.3",
    "RF-4.1", "RF-4.2", "RF-4.3", "RF-4.4", "RF-4.5", "RF-4.6", "RF-4.7", "RF-4.8",
    "RF-5.1", "RF-5.2",
    "RNF-1", "RNF-2"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-12-operator-environments-design.md",
      "locator": "## Requirements (EARS)",
      "fact": "Approved RF-1–RF-5 and RNF: facts catalog, environments, hybrid inject, scaffold/doctor, durable default, no Cenco edits."
    },
    {
      "id": "SRC-REGISTRIES",
      "path": "cli/src/core/registries.ts",
      "locator": "export function readRegistryManifest",
      "fact": "awm-registry.json minCliVersion must match /^v?\\d+\\.\\d+\\.\\d+$/; invalid throws named Error."
    },
    {
      "id": "SRC-BUNDLES",
      "path": "cli/src/core/bundles.ts",
      "locator": "export function inspectBundles",
      "fact": "Catalog entries resolve bundle.json; version defaults to 0.0.0 when missing — doctor must compare catalog entry.version to bundle.json version explicitly."
    },
    {
      "id": "SRC-FRONTMATTER",
      "path": "cli/src/core/frontmatter.ts",
      "locator": "export function matchFrontmatterBlock",
      "fact": "Leaf frontmatter matcher; needs parsing must live beside or import this without pulling registries/git."
    },
    {
      "id": "SRC-REGISTRY-CMD",
      "path": "cli/src/commands/registry/index.ts",
      "locator": "export function registerRegistryCommand",
      "fact": "Registry commander group has add/list/remove today; scaffold and doctor wire here."
    },
    {
      "id": "SRC-CLI-INDEX",
      "path": "cli/src/index.ts",
      "locator": "registerRegistryCommand(program);",
      "fact": "Top-level command registration site; awm env registers beside registry."
    },
    {
      "id": "SRC-PATHS",
      "path": "cli/src/core/paths.ts",
      "locator": "export function awmHome",
      "fact": "AWM_HOME override; environment store must use awmHome(), never hard-coded ~/.awm."
    },
    {
      "id": "SRC-ADD",
      "path": "cli/src/commands/registry/add.ts",
      "locator": "export async function addRegistry",
      "fact": "Atomic add: validate layout then write config; on failure rm clone — scaffold must mirror atomic success contract."
    },
    {
      "id": "SRC-RUNBOOK",
      "path": "docs/runbook.md",
      "locator": "## Team registries",
      "fact": "Operator docs describe manual layout + registry add; must point to scaffold as canonical create path."
    }
  ],
  "commands": [
    {
      "id": "CMD-FACTS-DOCTOR",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/facts/", "tests/commands/registry/doctor.test.ts"],
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-4.4", "RF-4.5", "RF-4.6", "RF-4.7", "RF-4.8", "RF-5.1"]
    },
    {
      "id": "CMD-ENV",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/environments/", "tests/commands/env/"],
      "covers": ["RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-3.1", "RF-3.2", "RF-3.3", "RNF-1", "RNF-2"]
    },
    {
      "id": "CMD-SCAFFOLD-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/registry/scaffold.test.ts", "tests/structural/operator-environments-docs-contract.test.ts"],
      "covers": ["RF-4.1", "RF-4.2", "RF-4.3", "RF-5.2"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-1.1", "RF-2.1", "RF-4.1"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Facts catalog, needs, registry doctor",
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-4.4", "RF-4.5", "RF-4.6", "RF-4.7", "RF-4.8", "RF-5.1"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN", "SRC-REGISTRIES", "SRC-BUNDLES", "SRC-FRONTMATTER", "SRC-REGISTRY-CMD"],
      "redCommands": ["CMD-FACTS-DOCTOR", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-FACTS-DOCTOR", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S2",
      "title": "Environment store, awm env, resolve/inject",
      "requirements": ["RF-2.1", "RF-2.2", "RF-2.3", "RF-2.4", "RF-2.5", "RF-3.1", "RF-3.2", "RF-3.3", "RNF-1", "RNF-2"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN", "SRC-PATHS", "SRC-CLI-INDEX"],
      "redCommands": ["CMD-ENV", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-ENV", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract", "security"]
    },
    {
      "id": "S3",
      "title": "Registry scaffold, handbook template, docs",
      "requirements": ["RF-4.1", "RF-4.2", "RF-4.3", "RF-5.2"],
      "dependsOn": ["S1", "S2"],
      "sectionAnchor": "slice-s3",
      "sources": ["SRC-DESIGN", "SRC-ADD", "SRC-REGISTRY-CMD", "SRC-RUNBOOK"],
      "redCommands": ["CMD-SCAFFOLD-DOCS", "CMD-TYPECHECK"],
      "greenCommands": ["CMD-SCAFFOLD-DOCS", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-FACTS-DOCTOR", "CMD-ENV", "CMD-SCAFFOLD-DOCS", "CMD-TYPECHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Facts catalog, needs, registry doctor

#### Surfaces
Own RF-1.1–1.4, RF-4.4–4.8, and RF-5.1. RF-4.5 covers detecting environment/store files inside a registry tree (audit). Files:
- `cli/src/core/facts/types.ts` — shared types + `FACTS_MIN_CLI_VERSION = '9.18.0'` (first CLI that understands facts; bump only with intentional release).
- `cli/src/core/facts/catalog.ts` — parse/validate `facts.json`.
- `cli/src/core/facts/needs.ts` — read `needs` list from skill `SKILL.md` frontmatter via `matchFrontmatterBlock`.
- `cli/src/commands/registry/doctor.ts` — pure `doctorRegistry(root): DoctorReport` (structural + advisories).
- `cli/src/commands/registry/index.ts` — wire `awm registry doctor [name|path]`.
- Tests: `cli/tests/core/facts/catalog.test.ts`, `needs.test.ts`, `cli/tests/commands/registry/doctor.test.ts`.

Grouping: one schema + audit boundary; no env store writes in this slice. RNF-1 (CLI must not write stores into registry trees) is owned by S2.

#### Implementation
1. RED — add failing tests:
   - Valid `facts.json` schemaVersion 1 with `repos.root` path/prompt/durable/reference parses; bad schemaVersion / missing facts object / unknown valueType / `resolution: command` → named error (RF-1.1, RF-3.3 catalog side: reject command at parse).
   - Skill frontmatter `needs: [repos.root]` resolves; unknown id → orphan list (RF-1.2/1.3); no needs → empty (RF-1.4).
   - Doctor on fixture registry: missing `REGISTRY.md` or Capabilities index → structural; catalog version ≠ bundle.json version → structural (RF-4.7); `~/.awm/environments` copy under registry root → structural (RF-4.5); unknown capability id `widgets` → advisory only, exit 0 when alone (RF-4.4/4.6); facts present with `minCliVersion` below `FACTS_MIN_CLI_VERSION` → structural (RF-4.8); prose `~/Developments` → advisory.
   - Assert no API requires writing-skills (RF-5.1): doctor API is path-only.
   Run CMD-FACTS-DOCTOR; expect RED.
2. Implement types + `parseFactsCatalog(raw|path)`:
   - Require `schemaVersion === 1`, `facts` object map of non-empty ids matching `/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/` (dotted ids).
   - Defaults: `durability: durable`, `inject: reference`, `resolution: prompt`.
   - Reject `resolution: command` with message containing `resolution: command` and `v1`.
3. `readSkillNeeds(skillMdPath): string[]` — parse YAML list under `needs:`; invalid needs shape throws named error; absent → `[]`.
4. `doctorRegistry(root)`:
   - Load manifest via `readRegistryManifest`; layout via existing validators.
   - Require `REGISTRY.md` with `## Capabilities` markdown table containing `| id | status | notes |` header and ≥0 data rows; duplicate/empty id → structural.
   - If `facts.json` exists: parse; for each `skills/*/SKILL.md`, resolve needs; orphans → structural.
   - Version coherence: for each `readCatalog` entry with string `version`, compare to `bundle.json` `version` when file exists; mismatch → structural.
   - If facts.json exists OR any needs non-empty: require `minCliVersion` present and `compareSemver(min, FACTS_MIN_CLI_VERSION) >= 0`.
   - Scan registry tree for path segments `environments` + `values.json` / filenames matching env store → structural (RF-4.5).
   - Advisory: lines matching `/(^|[^\w])~(\/|\\)/` or `/Users\/[^/\s]+/` in `skills/**/*.md` (cap report length).
   - Return `{ structural: string[]; advisories: string[] }`; CLI exit `structural.length ? 1 : 0`.
5. Wire commander; commit. GREEN CMD-FACTS-DOCTOR + CMD-TYPECHECK.

#### Edge cases
- Registry with no facts.json and no needs: doctor must not require facts chapter beyond Capabilities index presence (scaffold later adds facts row; existing registries without handbook fail structural until handbook added — document in doctor message `missing REGISTRY.md`).
- Empty `facts: {}` is valid schema.
- Symlink skill path: follow same regular-file guards as discovery where practical; fail closed on unreadable.

#### Evidence
CMD-FACTS-DOCTOR and CMD-TYPECHECK. Distinct specification + code-quality reviews. Reconcile plan identity before completion.

#### Fallback
Public-contract / security: expand full relevant context under Evidence Capsule; do not weaken fail-closed orphan needs or store-in-tree detection. Insufficient fact → amend plan + revalidate.

---

<a id="slice-s2"></a>
### Slice S2: Environment store, awm env, resolve/inject

#### Surfaces
Own RF-2.1–2.5, RF-3.1–3.3, RNF-1, and RNF-2 (writes only under `awmHome()/environments`; refuse targets inside registry trees). Files:
- `cli/src/core/environments/store.ts` — active env, read/write `values.json` / `meta.json`.
- `cli/src/core/environments/resolve.ts` — status map, reference vs context inject with budget.
- `cli/src/commands/env/index.ts` — `status|set|edit|refresh|use`.
- `cli/src/index.ts` — register env command.
- Tests under `cli/tests/core/environments/` and `cli/tests/commands/env/`.

Depends on S1 catalog parse for validating fact ids on `set`.

#### Implementation
1. RED — tests with `AWM_HOME` tmpdir:
   - `set` writes only under `AWM_HOME/environments/default/values.json` (RF-2.1); active env single (RF-2.2).
   - Durable value stays `fresh` after fake clock +1y (RF-2.3).
   - Volatile with `ttl: 1` and `updatedAt` in the past → `stale`; resolve must not return value as fresh (RF-2.4/2.5).
   - Missing fact → status `missing`, no default (RF-2.5).
   - `buildInjection({ inject: reference })` returns store path + ids, no values (RF-3.1).
   - `inject: context` with two small fresh values under budget includes values; over budget (set `CONTEXT_INJECT_MAX_CHARS` low in test) degrades to reference + warning (RF-3.2).
   - Catalog `resolution: command` already rejected in S1; `set` never shells out (RF-3.3).
   - Attempting `writeEnvValue` with target inside a registry fixture path must throw (RNF-1).
   Run CMD-ENV; RED.
2. Store API:
   - `environmentsRoot() => path.join(awmHome(), 'environments')`
   - `getActiveEnvironmentName()` / `setActiveEnvironmentName(name)` via `meta.json` in root or per-env; default name `default`.
   - `readValues(name)`, `writeFact(name, id, { value, status, updatedAt, expiresAt? })` atomic write (tmp + rename pattern used elsewhere).
   - On volatile write, set `expiresAt = updatedAt + ttlSeconds`.
3. Resolve: `statusFor(catalog, store)` → per-id `fresh|missing|stale`; stale if volatile and now > expiresAt.
4. Inject: `CONTEXT_INJECT_MAX_CHARS = 2048` (constant); count only `inject: context` fresh values.
5. Commands: non-interactive `--value` for tests; `edit` prints absolute store path; `refresh` re-prompts / requires `--value` in tests.
6. GREEN CMD-ENV + CMD-TYPECHECK; commit.

#### Edge cases
- `set` unknown id (not in any installed catalog when catalogs provided): error listing consulted roots; unit tests pass explicit catalog map to core to avoid depending on real `~/.awm/registries`.
- Invalid `valueType: path` empty string → reject, store unchanged.
- Concurrent write: last atomic rename wins; no partial JSON.

#### Evidence
CMD-ENV, CMD-TYPECHECK; dual reviews; plan identity.

#### Fallback
Security fallback if inject leaks secrets patterns — keep default reference; amend rather than broaden context inject.

---

<a id="slice-s3"></a>
### Slice S3: Registry scaffold, handbook template, docs

#### Surfaces
Own RF-4.1–4.3 and RF-5.2. Files:
- `cli/src/commands/registry/scaffold.ts` — `scaffoldRegistry(dir): ScaffoldResult`.
- Wire in `registry/index.ts`.
- Docs: `docs/runbook.md` (team registries), `docs/cli-reference.md` (registry + env sections).
- Structural test `cli/tests/structural/operator-environments-docs-contract.test.ts` asserts docs mention `awm registry scaffold`, `awm registry doctor`, `awm env`, and that design/plan state RF-5.2 non-goal (no path `awm-cenco-infra-registry` modified in this branch — test checks docs claim out-of-scope, not the foreign zip).
- `cli/tests/commands/registry/scaffold.test.ts`.

#### Implementation
1. RED — scaffold test:
   - `scaffoldRegistry(tmp)` creates `awm-registry.json` with valid `minCliVersion` ≥ `FACTS_MIN_CLI_VERSION`, `catalog.json` with `version: 1` and `bundles: []`, `skills/.gitkeep` or empty `skills/`, `facts.json` with `schemaVersion: 1` and `facts: {}`, `REGISTRY.md` with Capabilities index row `facts | active | …` and `## Capability: facts` section.
   - After scaffold, `doctorRegistry(dir).structural` is `[]` (RF-4.1/4.2).
   - Mid-fail: if dir exists and is non-empty non-target, abort without writing; if failure after partial write, cleanup created dir when scaffold created it (RF-4.3) — test by injecting failing write via dependency seam or chmod.
   - Docs contract: runbook/cli-reference contain the three command strings; design path cited; phrase that Cenco migration is out of scope / RF-5.2 (RF-5.2).
   Run CMD-SCAFFOLD-DOCS; RED.
2. Implement scaffold atomicity: create temp dir under parent or write into empty target only; on success move/finalize; on error `rmSync` if we created the directory.
3. Update runbook team-registries section to lead with `awm registry scaffold <dir>` then git remote + `awm registry add`.
4. CLI reference: document `registry scaffold`, `registry doctor`, and `env` subcommands matching behavior.
5. GREEN; commit.

#### Edge cases
- Target path exists with files → error, no overwrite.
- `minCliVersion` written as `FACTS_MIN_CLI_VERSION` without `v` prefix (manifest regex allows optional v on read).

#### Evidence
CMD-SCAFFOLD-DOCS, CMD-TYPECHECK; dual reviews; full closureCommands before finish.

#### Fallback
If docs-only drift: amend docs contract tests to assert specific RF-4.2 version sentence; never skip doctor-pass assertion for scaffold.

---

## Traceability matrix

| Req | Task(s) | Test(s) |
|-----|---------|---------|
| RF-1.1 | S1 catalog parse | `tests/core/facts/catalog.test.ts` via CMD-FACTS-DOCTOR |
| RF-1.2 | S1 needs + doctor | `needs.test.ts` + `doctor.test.ts` |
| RF-1.3 | S1 doctor orphans | `doctor.test.ts` orphan case |
| RF-1.4 | S1 needs absent | `needs.test.ts` |
| RF-2.1 | S2 store path | `tests/core/environments/store.test.ts` |
| RF-2.2 | S2 active env | `store.test.ts` |
| RF-2.3 | S2 durable | `resolve.test.ts` durable clock |
| RF-2.4 | S2 volatile stale | `resolve.test.ts` ttl |
| RF-2.5 | S2 missing/stale | `resolve.test.ts` + env status |
| RF-3.1 | S2 reference inject | `resolve.test.ts` |
| RF-3.2 | S2 budget degrade | `resolve.test.ts` |
| RF-3.3 | S1 reject command + S2 no shell | catalog + env tests |
| RF-4.1 | S3 scaffold→doctor | `scaffold.test.ts` |
| RF-4.2 | S3 template files | `scaffold.test.ts` |
| RF-4.3 | S3 atomic fail | `scaffold.test.ts` |
| RF-4.4 | S1 advisory exit | `doctor.test.ts` |
| RF-4.5 | S1 store-in-tree audit | `doctor.test.ts` |
| RF-4.6 | S1 unknown capability | `doctor.test.ts` |
| RF-4.7 | S1 version skew | `doctor.test.ts` |
| RF-4.8 | S1 minCli gate | `doctor.test.ts` |
| RF-5.1 | S1 path-only doctor | `doctor.test.ts` API surface |
| RF-5.2 | S3 docs contract | `operator-environments-docs-contract.test.ts` |
| RNF-1 | S2 write guard | `store.test.ts` refuses registry-tree targets |
| RNF-2 | S2 default reference | `resolve.test.ts` |

## Self-review notes
- Placeholder scan: none intended.
- RF-4.5 owns audit of store-in-tree; RNF-1 owns CLI write refusal — unique owners.
- RF-3.3 catalog rejection in S1; runtime no-shell reinforced in S2.
- No UI screens; no baseline `writing-skills` edits in this plan (accelerator deferred; RF-5.1 satisfied without them).
