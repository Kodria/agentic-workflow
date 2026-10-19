# Frontmatter Hardening (#225 / #226) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make registry frontmatter parsing linear-time and YAML-aligned: no quadratic comment strip, no premature `---x` close, process-model slugs typed via js-yaml, and bounded process-model diagnostics.

**Architecture:** Two serial slices. S1 edits the leaf module `cli/src/core/frontmatter.ts` only (no new imports): replace `\s+#.*$` with a linear space/tab scan, and close frontmatter only on a line that is exactly `---` with optional trailing spaces/tabs. S2 edits `cli/src/core/process/model.ts`: resolve `name`/`terminates_to` through js-yaml string scalars before `PROCESS_NAME`, refuse oversized process-model blocks before `readPairs`, and cap problem count / unknown-field key length. Contract: `docs/plans/2026-10-19-frontmatter-hardening-design.md`.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, js-yaml (already a dependency of `process/model.ts`).

**Change Record:** `frontmatter-hardening`

**Criterios de aceptación:**
- Con la versión publicada, un `SKILL.md` cuyo `description` plano tiene 80 000 espacios sin `#` se resuelve en discovery en menos de 50 ms (no segundos)
- Con la versión publicada, un frontmatter que contiene una línea `---x: 1` antes del cierre real `---` conserva las claves posteriores al `---x` en `matchFrontmatterBlock`
- Con la versión publicada, `awm process` rechaza un modelo con `name: null` (o `0x1f` / `1e5`) y acepta `name: "demo-ok"` / `name: "null"` cuando el string cumple el slug

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

**Origen:** owner-approved design 2026-10-19 (Package A, Approach 1, H3=1a, H4=both). Issues #225 #226. Dispatch: owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "frontmatter-hardening",
  "requirements": ["FH-1", "FH-2", "FH-3", "FH-4", "FH-5", "FH-6"],
  "sources": [
    {
      "id": "SRC-FM",
      "path": "cli/src/core/frontmatter.ts",
      "locator": "export function matchFrontmatterBlock",
      "fact": "matchFrontmatterBlock uses raw.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---/) and returns capture group 1 or null. findFrontmatterDescription ends plain scalars with value.replace(/\\s+#.*$/, '').trim(). The file is a leaf module: zero imports. soft/hard path comments document space-before-# YAML comment rule; \\s today also matches NBSP."
    },
    {
      "id": "SRC-MODEL",
      "path": "cli/src/core/process/model.ts",
      "locator": "export function parseProcessFrontmatter",
      "fact": "FRONTMATTER_MAX=65536 gates only loadBlock/yaml.load for description. parseProcessFrontmatter always calls readPairs(block) first. name/terminates_to are validated with PROCESS_NAME.test on the raw readPairs string. problems are joined with '; ' into one diagnostic with no count cap. unknown field messages use JSON.stringify(key) of the full key."
    },
    {
      "id": "SRC-MODEL-TEST",
      "path": "cli/tests/core/process/model.test.ts",
      "locator": "describe('parseProcessFrontmatter'",
      "fact": "Fixture `valid` is the canonical process-model frontmatter; tests mutate with String.replace. Path-traversal name test uses name: ../../etc/passwd. Unknown-field test inserts api_token before created."
    },
    {
      "id": "SRC-FM-YAML",
      "path": "cli/tests/core/frontmatter-description-vs-yaml.test.ts",
      "locator": "describe(",
      "fact": "Differential suite compares findFrontmatterDescription against js-yaml for many scalar forms; must stay green after FH-2 (NBSP before # must match js-yaml)."
    },
    {
      "id": "SRC-LINEAR",
      "path": "cli/tests/core/changes/helpers.ts",
      "locator": "export function expectLinearScaling",
      "fact": "expectLinearScaling(run, base) compares best-of-3 times for base vs base*10 and asserts large <= 40 * max(small, 1ms). Used for pure linear-time regressions without git."
    },
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-19-frontmatter-hardening-design.md",
      "locator": "## Requirements (EARS)",
      "fact": "FH-1..FH-6 and pinned constants FRONTMATTER_MAX=65536, MAX_PROCESS_PROBLEMS=20, UNKNOWN_FIELD_KEY_MAX=64; leaf-module constraint for frontmatter.ts."
    }
  ],
  "commands": [
    {
      "id": "CMD-FM",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/frontmatter-hardening.test.ts", "tests/core/frontmatter-description-vs-yaml.test.ts"],
      "covers": ["FH-1", "FH-2", "FH-3"]
    },
    {
      "id": "CMD-MODEL",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/process/model.test.ts"],
      "covers": ["FH-4", "FH-5", "FH-6"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["FH-1", "FH-2", "FH-3", "FH-4", "FH-5", "FH-6"]
    },
    {
      "id": "CMD-LINT",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "lint"],
      "covers": ["FH-1", "FH-3", "FH-4", "FH-5", "FH-6"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Leaf frontmatter: linear comment strip and exact --- closer",
      "requirements": ["FH-1", "FH-2", "FH-3"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-FM", "SRC-FM-YAML", "SRC-LINEAR", "SRC-DESIGN"],
      "redCommands": ["CMD-FM"],
      "greenCommands": ["CMD-FM", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S2",
      "title": "Process model: YAML string slugs and bounded diagnostics",
      "requirements": ["FH-4", "FH-5", "FH-6"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-MODEL", "SRC-MODEL-TEST", "SRC-DESIGN"],
      "redCommands": ["CMD-MODEL"],
      "greenCommands": ["CMD-MODEL", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-FM", "CMD-MODEL", "CMD-TYPECHECK", "CMD-LINT"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Leaf frontmatter: linear comment strip and exact --- closer

#### Surfaces

Owns FH-1, FH-2, FH-3 in `cli/src/core/frontmatter.ts` only. Grouping: both defects are in the leaf closer/description reader; one review boundary. No imports may be added to this file. New tests in `cli/tests/core/frontmatter-hardening.test.ts`; keep `frontmatter-description-vs-yaml.test.ts` green.

#### Implementation

1. **RED — closer.** Add `cli/tests/core/frontmatter-hardening.test.ts` importing `matchFrontmatterBlock`, `findFrontmatterDescription` from `../../src/core/frontmatter` and `expectLinearScaling` from `./changes/helpers`. Assert:
   - Document `---\nname: a\n---x: 1\nstatus: b\n---\n\nbody\n` → block includes `status: b` and `---x: 1`.
   - `---\nname: a\n--- \n\nbody\n` and CRLF variants still extract `name: a`.
   - `description: hello\u00A0# keep` → value equals js-yaml’s description (includes NBSP and `# keep`).
   - `description: hello # drop` → value `hello`.
   - `expectLinearScaling((n) => { findFrontmatterDescription('description: a' + ' '.repeat(n) + 'x'); }, 20_000)` and the same with tabs.
2. Run CMD-FM → RED (closer truncates; linear test fails or times out badly; NBSP diverges).
3. **GREEN — implement in `frontmatter.ts`:**
   - Replace `matchFrontmatterBlock` body with a line-oriented scan (preferred) or a regex that requires the closer line to be exactly `---` plus optional trailing `[ \t]*` before `\r?\n` or end: must not treat `---x` as closer. Preserve opening `^---` + newline. Return inner text without the closing delimiter line.
   - Add a private `stripPlainScalarComment(value: string): string` that scans for the first index `i` where `(value[i]===' '||value[i]==='\t') && value[i+1]==='#'`, returns `value.slice(0,i).trim()`; if none, `value.trim()`. Replace `value.replace(/\s+#.*$/, '').trim()` with `stripPlainScalarComment(value)`.
4. Run CMD-FM, CMD-TYPECHECK, CMD-LINT → GREEN.
5. Commit: `fix(frontmatter): linear comment strip and exact --- closer`.

#### Edge cases

- `C#` in a plain scalar keeps `#` (no space before `#`).
- Closing line `---\t\t` closes; `---#comment` does **not** close (non-space after `---`).
- Empty frontmatter `---\n---\n` still yields `''` block.
- Block scalar / quoted branches of `findFrontmatterDescription` unchanged; only the final plain-scalar return path uses the strip helper.

#### Evidence

SRC-FM, SRC-FM-YAML, SRC-LINEAR, SRC-DESIGN. RED/GREEN: CMD-FM (+ typecheck/lint on green). Independent specification and code-quality reviews before S2. Reconcile plan identity via `awm plan validate` after any amendment.

#### Fallback

If line-scan vs regex tradeoff appears, amend design to pin one algorithm, revalidate plan; do not import js-yaml into the leaf module. Full-context fallback retains compact gates.

<a id="slice-s2"></a>
### Slice S2: Process model: YAML string slugs and bounded diagnostics

#### Surfaces

Owns FH-4, FH-5, FH-6 in `cli/src/core/process/model.ts` and extensions to `cli/tests/core/process/model.test.ts`. Depends on S1 only for shared release train (no code dependency). Grouping: all process-model trust-boundary limits in one parser.

#### Implementation

1. **RED — extend `model.test.ts`:**
   - `name: null`, `name: true`, `name: 0x1f`, `name: 1e5`, `name: 01` → no model; diagnostic mentions YAML string / quote.
   - `name: "null"` and `name: "demo-ok"` → model.name is `null` / `demo-ok` when slug-valid.
   - `terminates_to: 0x1f` rejected; `terminates_to: none` and `terminates_to: "none"` still OK.
   - Block length `FRONTMATTER_MAX+1` with `awm: process-model` and otherwise-valid fields → size diagnostic; no model.
   - Block length `FRONTMATTER_MAX+1` without `awm: process-model` → empty diagnostics.
   - 25 unknown fields → diagnostic contains at most 20 `unknown field` mentions and a remainder count; a single key of length 200 appears truncated to 64 + ellipsis in the message.
2. Run CMD-MODEL → RED.
3. **GREEN — implement in `model.ts`:**
   - Add `MAX_PROCESS_PROBLEMS = 20`, `UNKNOWN_FIELD_KEY_MAX = 64`.
   - Add `function loadYamlScalar(raw: string): unknown` using `yaml.load('v: ' + raw)` inside try/catch (never throw); return the `v` property when the doc is a plain object, else a sentinel.
   - Add `function yamlStringSlug(raw: string): string | null` — if `loadYamlScalar` result `typeof === 'string'` return it, else null.
   - After reading required presence of `name` / `terminates_to`, resolve through `yamlStringSlug`; if null, push the quote/string diagnostic; else run `PROCESS_NAME` (and `none` exception) on the resolved string; store the resolved string on the model.
   - Before `readPairs`: if `block.length > FRONTMATTER_MAX`, if block matches process-model discriminator at line start (`/^awm[ \t]*:[ \t]*process-model[ \t]*$/m`), return size diagnostic; else return `{ diagnostics: [] }`.
   - When pushing `unknown field`, stringify a truncated key: if `key.length > 64`, use `key.slice(0, 64) + '…'` inside `JSON.stringify`.
   - Before building the final diagnostic join: if `problems.length > 20`, set `problems = problems.slice(0, 20).concat([`${problems.length - 20} more problems`])` using the pre-slice length for the count.
4. Run CMD-MODEL, CMD-TYPECHECK, CMD-LINT → GREEN.
5. Commit: `fix(process): YAML string slugs and bounded frontmatter diagnostics`.

#### Edge cases

- `terminates_to: none` without quotes remains valid (YAML string).
- Path-traversal `name: ../../etc/passwd` still fails `PROCESS_NAME` after YAML string load.
- Description path still uses existing `loadBlock` size gate; FH-5 does not remove it.
- Diagnostics never embed the full hostile key beyond 64 characters.

#### Evidence

SRC-MODEL, SRC-MODEL-TEST, SRC-DESIGN. RED/GREEN: CMD-MODEL (+ typecheck/lint). Independent specification and code-quality reviews. Closure: all `closureCommands`.

#### Fallback

If `yaml.load('v: ' + raw)` is unsafe for a particular raw shape, amend to a denylist-plus-quoted-only loader with design update; do not validate slugs on raw text again. Full-context fallback retains gates.

## Traceability

| Req | Slice | Tests |
|-----|-------|-------|
| FH-1 | S1 | `frontmatter-hardening` expectLinearScaling spaces/tabs |
| FH-2 | S1 | NBSP vs space-before-`#`; yaml differential suite |
| FH-3 | S1 | `---x` keeps later keys; `--- ` / CRLF close |
| FH-4 | S2 | null/0x1f/1e5 reject; quoted accept |
| FH-5 | S2 | oversized process-model vs non-model |
| FH-6 | S2 | 25 unknowns + long key truncation |

## Self-review

- Forward/backward coverage: complete above.
- No TBD/TODO placeholders.
- Leaf import constraint explicit in S1.
- Constants match design.
