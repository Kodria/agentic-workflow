# Process Model `description` Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a durable process model (`awm: process-model`) declare a `description`, so the skill it is also loads in runtimes that require one (Codex rejects a `SKILL.md` without it), while models without it keep parsing exactly as before.

**Architecture:** `parseProcessFrontmatter` (`cli/src/core/process/model.ts`) adds `description` to its closed field allowlist as the only optional field. Its value is resolved with the CLI's single frontmatter source of truth (`findFrontmatterDescription` in `cli/src/core/frontmatter.ts`), restricted to a single-line plain or quoted scalar, non-empty and at most 1024 characters, and exposed on the parsed model (and therefore on `awm process show --json`). The contract section of the process-lifecycle design records the field as an amendment.

**Tech Stack:** TypeScript CLI (`cli/`), Jest.

**Change Record:** `process-model-description`

**Criterios de aceptación:**
- Instalar la versión publicada por este cambio (`npm i -g agentic-workflow-manager@latest`) y correr `awm --version` → imprime una versión mayor que 9.20.0
- En un registry con un modelo de proceso que declara `description: <texto>` en su frontmatter, correr `awm process show <nombre> --json` → el JSON incluye `"description": "<texto>"` y no aparece ningún diagnóstico `unknown field "description"`
- En el mismo registry, quitar la línea `description` del modelo y correr `awm process list` → el modelo sigue listado y sin diagnósticos, igual que antes del cambio

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** Kodria/awm-personal-registry#3 — `documentar-proceso` and `trazar-sesion` fail to load in Codex (`missing field description`). Adding the line in the registry alone is impossible: the CLI rejects any process model carrying it (`unknown field "description"`). Dispatch: the owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "process-model-description",
  "requirements": ["PD-1", "PD-2", "PD-3", "PD-4"],
  "sources": [
    {
      "id": "SRC-MODEL",
      "path": "cli/src/core/process/model.ts",
      "locator": "export function parseProcessFrontmatter",
      "fact": "ALLOWED_FIELDS = ['awm','schema','name','status','entry_point','terminates_to','created','updated']; readPairs splits the block into single-line key: value pairs (any other line is a problem); every key outside ALLOWED_FIELDS adds `unknown field \"<key>\" — the contract admits only <list>`; all fields except awm are required; problems are joined into one `<file>: invalid process model — …` diagnostic; the function never throws."
    },
    {
      "id": "SRC-TYPES",
      "path": "cli/src/core/process/types.ts",
      "locator": "export interface ProcessModelFrontmatter",
      "fact": "ProcessModelFrontmatter { schema; name; status; entryPoint; terminatesTo; created; updated }; ProcessModel extends it with source and body; `awm process show --json` prints the model minus `source` (cli/src/commands/process/index.ts publicView)."
    },
    {
      "id": "SRC-FRONTMATTER",
      "path": "cli/src/core/frontmatter.ts",
      "locator": "export function findFrontmatterDescription",
      "fact": "Leaf module, the CLI's single source of truth for `description:` (verified against js-yaml). Returns { value, startLine, endLine }; resolves plain, single- and double-quoted scalars (unescaping) and block scalars; an ill-formed `>`/`|` indicator resolves to ''. isBlockScalarHeader(value) is the exported predicate for a block-scalar header."
    },
    {
      "id": "SRC-MODEL-TEST",
      "path": "cli/tests/core/process/model.test.ts",
      "locator": "describe('parseProcessFrontmatter'",
      "fact": "Fixture `valid` is the canonical model (no description); tests mutate it with String.replace and assert r.model / r.diagnostics; the unknown-field test inserts `api_token: ghp_x` before `created:`."
    },
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-08-23-process-lifecycle-design.md",
      "locator": "### El artefacto",
      "fact": "The yaml block under this heading is the frontmatter contract the baseline skill process-lifecycle cites; it lists awm, schema, name, status, entry_point, terminates_to, created, updated."
    }
  ],
  "commands": [
    {
      "id": "CMD-PROCESS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/process", "tests/commands/process.test.ts"],
      "covers": ["PD-1", "PD-2", "PD-3"]
    },
    {
      "id": "CMD-DOCS",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/process-model-description-contract.test.ts"],
      "covers": ["PD-4"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["PD-3"]
    },
    {
      "id": "CMD-LINT",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "lint"],
      "covers": ["PD-1", "PD-2"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Optional description in the process-model parser",
      "requirements": ["PD-1", "PD-2", "PD-3"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-MODEL", "SRC-TYPES", "SRC-FRONTMATTER", "SRC-MODEL-TEST"],
      "redCommands": ["CMD-PROCESS"],
      "greenCommands": ["CMD-PROCESS", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S2",
      "title": "Contract documentation",
      "requirements": ["PD-4"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN"],
      "redCommands": ["CMD-DOCS"],
      "greenCommands": ["CMD-DOCS"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "bounded",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-PROCESS", "CMD-DOCS", "CMD-TYPECHECK", "CMD-LINT"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

**Requirements:**

- **PD-1** — `description` is the only optional field of the process-model contract: a model without it parses exactly as before (same model, no diagnostic), and every other key outside the allowlist is still rejected as `unknown field`.
- **PD-2** — When present, `description` must be a single-line scalar, plain or quoted. Its value is resolved with `findFrontmatterDescription` (quotes removed, escapes undone). A block-scalar header (`>`, `|`, with or without chomping/indent, or an ill-formed `>`/`|` value) is rejected with `"description" must be a single-line string (block scalars are not supported in a process model)`; a value empty after resolution is rejected with `"description" must not be empty`; a resolved value longer than 1024 characters is rejected with `"description" must be at most 1024 characters`. The parser still never throws.
- **PD-3** — The parsed model carries `description` (the resolved string) when the field is present and has no `description` key when it is absent; `awm process show --json` therefore shows it with no change to the command.
- **PD-4** — The contract in `docs/plans/2026-08-23-process-lifecycle-design.md` (`### El artefacto`) lists `description` as optional with its rules and a dated amendment explaining why (Codex requires it), and a structural test pins it.

**Amendment A1 (S1 spec review, 2026-10-18):** a block-scalar or multi-line `description` leaked its text through `readPairs`, which quotes every non-pair line (`line is not a "key: value" pair: "<first 80 chars>"`), so the S1 edge case "the value is never echoed into a diagnostic" did not hold. `readPairs` now reports a non-pair line by its 1-based position in the frontmatter block and never by its content: `line <n> is not a "key: value" pair (multi-line values are not supported)`. This covers block scalars, plain multi-line values and quotes closed on a later line, for every field. A test in S1 asserts that the continuation text of each of those three shapes is absent from the diagnostics and that the line number is present.

**Amendment A2 (S1 spec re-review, 2026-10-18):** A1 left two gaps.
1. `readPairs` trims each line before matching, so an indented continuation shaped `  KEY: x` was taken as a field and echoed as `unknown field "KEY"`. The contract is a flat map, so any line that starts with whitespace is a continuation line. It is reported with the A1 message (`line <n> is not a "key: value" pair (multi-line values are not supported)`), whatever it contains, and never becomes a pair.
2. A `description` that opens a quote (`"` or `'`) and does not close it on the same line resolves to itself with the opening quote included. That is invalid YAML for every runtime that loads the skill, so it is rejected with `"description" must close its quote on the same line`. The test is: the raw value starts with a quote and `findFrontmatterDescription` returns it unchanged.

S1 gains tests for both: an indented `  SECRETKEY: x` after a plain `description` and after a `>-` header is reported by line number with no `SECRETKEY` in any diagnostic; `description: "hola` and `description: 'hola` are rejected with the quote message; `description: "a \"b\""` is still accepted as `a "b"`.

**Amendment A3 (S1 implementer, 2026-10-18):** A2's detection rule ("the helper returns the raw value unchanged") misses an unclosed quote followed by a comment (`description: 'hola # x` resolved to `'hola`). Detection now asks the frontmatter module directly. `cli/src/core/frontmatter.ts` joins S1's surfaces and exports `opensUnclosedQuote(value: string): boolean`: true when the trimmed value starts with `"` or `'` and the existing private `findClosingQuote` finds no closing quote. That keeps one quote scanner in the CLI. `parseProcessFrontmatter` uses it in place of the A2 comparison; the message is unchanged. Tests add `description: 'hola # x` and `description: "hola # x` (rejected), `description: "a" # note` (accepted as `a`), and direct unit cases for the predicate.

**Shared constraints (every slice):** Work only in `cli/` and `docs/`. Never read or write the real `~/.awm`; these tests are pure string parsing and need no HOME override. Commit after each slice's GREEN with a `fix(process): …` (S1) or `docs(process): …` (S2) subject ending in the session attribution lines. Run commands from the repository root exactly as declared.

<a id="slice-s1"></a>
### Slice S1: Optional description in the process-model parser

#### Surfaces

Owns PD-1, PD-2 and PD-3: one parser boundary (allowlist + validation + exposure) that cannot be split without leaving an accepted-but-dropped field.

- Modify `cli/src/core/process/model.ts`.
- Modify `cli/src/core/process/types.ts` (`ProcessModelFrontmatter` gains `description?: string`).
- Modify `cli/tests/core/process/model.test.ts` (new tests only; existing ones unchanged).

Interface: `parseProcessFrontmatter(source, file): ProcessParseResult<ProcessModelFrontmatter>` keeps its signature.

#### Implementation

- [ ] **Step 1 — RED.** Append to the `describe('parseProcessFrontmatter')` block of `cli/tests/core/process/model.test.ts`:

```ts
    describe('description (optional)', () => {
        const withDescription = (line: string): string => valid.replace('created:', `${line}\ncreated:`);

        it('is optional: a model without it parses unchanged and has no description key', () => {
            const r = parseProcessFrontmatter(valid, 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model).toBeDefined();
            expect(Object.prototype.hasOwnProperty.call(r.model, 'description')).toBe(false);
        });

        it.each([
            ['plain', 'description: Use when tracing a work session', 'Use when tracing a work session'],
            ['double-quoted', 'description: "Use when: tracing \\"sessions\\""', 'Use when: tracing "sessions"'],
            ['single-quoted', "description: 'It''s the entry point'", "It's the entry point"],
        ])('accepts a %s single-line value and exposes it resolved', (_kind, line, expected) => {
            const r = parseProcessFrontmatter(withDescription(line), 'p');
            expect(r.diagnostics).toEqual([]);
            expect(r.model?.description).toBe(expected);
        });

        it('accepts exactly 1024 characters and rejects 1025', () => {
            expect(parseProcessFrontmatter(withDescription(`description: ${'a'.repeat(1024)}`), 'p').model?.description).toHaveLength(1024);
            const r = parseProcessFrontmatter(withDescription(`description: ${'a'.repeat(1025)}`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/"description" must be at most 1024 characters/);
        });

        it.each(['description:', 'description: ""', "description: ''", 'description: "   "'])('rejects an empty value: %s', (line) => {
            const r = parseProcessFrontmatter(withDescription(line), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/"description" must not be empty/);
        });

        it.each(['description: >', 'description: >-', 'description: |', 'description: |2+', 'description: >-basura'])('rejects a block scalar header: %s', (line) => {
            const r = parseProcessFrontmatter(withDescription(`${line}\n  folded text`), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/"description" must be a single-line string \(block scalars are not supported in a process model\)/);
        });

        it('still rejects every other unknown field next to a valid description', () => {
            const r = parseProcessFrontmatter(withDescription('description: ok\nsummary: nope'), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/unknown field "summary"/);
            expect(r.diagnostics.join(' ')).not.toMatch(/unknown field "description"/);
        });

        it('rejects a duplicated description', () => {
            const r = parseProcessFrontmatter(withDescription('description: a\ndescription: b'), 'p');
            expect(r.model).toBeUndefined();
            expect(r.diagnostics.join(' ')).toMatch(/duplicate field "description"/);
        });

        it('never throws on hostile description values', () => {
            for (const line of ['description: "unclosed', "description: '''", 'description: \x00', `description: ${'"'.repeat(5000)}`]) {
                expect(() => parseProcessFrontmatter(withDescription(line), 'p')).not.toThrow();
            }
        });
    });
```

Run CMD-PROCESS → the plain/quoted/1024 tests fail with `unknown field "description"`, the empty/block tests fail on the message.

- [ ] **Step 2 — Implementation.** In `cli/src/core/process/types.ts`, add to `ProcessModelFrontmatter`, after `updated: string;`:

```ts
    /** Optional. Single-line scalar, resolved (quotes removed). Absent → no key. */
    description?: string;
```

In `cli/src/core/process/model.ts`:

1. Import: `import { findFrontmatterDescription, isBlockScalarHeader, matchFrontmatterBlock } from '../frontmatter';`
2. Add `'description'` at the end of `ALLOWED_FIELDS`, and above it a comment: `description` is the only optional field — runtimes such as Codex refuse to load a `SKILL.md` without one, and the model *is* the skill's `SKILL.md`.
3. Add `const DESCRIPTION_MAX = 1024;` with a comment: the Agent Skills limit the consuming runtimes enforce.
4. After the `created`/`updated` date loop and before `if (problems.length > 0)`, add:

```ts
    let description: string | undefined;
    const rawDescription = pairs.get('description');
    if (rawDescription !== undefined) {
        if (/^[>|]/.test(rawDescription) || isBlockScalarHeader(rawDescription)) {
            problems.push('"description" must be a single-line string (block scalars are not supported in a process model)');
        } else {
            const resolved = findFrontmatterDescription(`description: ${rawDescription}`).value.trim();
            if (resolved === '') problems.push('"description" must not be empty');
            else if (resolved.length > DESCRIPTION_MAX) problems.push(`"description" must be at most ${DESCRIPTION_MAX} characters`);
            else description = resolved;
        }
    }
```

A block scalar's continuation lines are already rejected by `readPairs` as non-pairs; the explicit message is what tells the author why. Pass only the single `description:` line to `findFrontmatterDescription` so continuation lines of other fields cannot be folded into it.

5. In the returned model, spread it conditionally so PD-3 holds: `...(description !== undefined ? { description } : {}),` after `updated: pairs.get('updated')!,`.

- [ ] **Step 3 — GREEN.** Run CMD-PROCESS, CMD-TYPECHECK and CMD-LINT → all pass. Commit `fix(process): admit an optional description in process models`.

#### Edge cases

- Unknown fields other than `description` still produce `unknown field "<key>"` (PD-1); the allowlist message now lists `description` too.
- `description:` with an empty value, `""`, `''` or only spaces inside quotes → `must not be empty`.
- `>`/`|` headers in every well-formed variant, and ill-formed ones like `>-basura` (which `findFrontmatterDescription` resolves to ''), → the block-scalar message, never the empty message.
- Exactly 1024 resolved characters pass; 1025 fail. Length counts the resolved value (quotes and escapes excluded).
- An unclosed quote or control characters must not throw (the function contract is never-throw); whatever it resolves to is subject to the same empty/length rules.
- The value is never echoed into a diagnostic (keeps R1.10: diagnostics never carry field contents).

#### Evidence

SRC-MODEL, SRC-TYPES, SRC-FRONTMATTER, SRC-MODEL-TEST. RED: CMD-PROCESS failing on the new tests. GREEN: CMD-PROCESS, CMD-TYPECHECK, CMD-LINT. Distinct clean specification and code-quality verdicts; `awm sensors run` → `overall: pass` on the committed tree.

#### Fallback

Public-contract risk (the parser defines what every registry may publish): full relevant context, all reviewers kept. If `findFrontmatterDescription` resolves a case differently than PD-2 states, stop and amend the plan instead of special-casing it in the parser.

<a id="slice-s2"></a>
### Slice S2: Contract documentation

#### Surfaces

Owns PD-4. The contract section is what `process-lifecycle` (baseline registry) tells authors to follow, so it must state the field.

- Modify `docs/plans/2026-08-23-process-lifecycle-design.md` (`### El artefacto`).
- Create `cli/tests/structural/process-model-description-contract.test.ts`.

#### Implementation

- [ ] **Step 1 — RED.** Create `cli/tests/structural/process-model-description-contract.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

const DESIGN = path.resolve(__dirname, '../../../docs/plans/2026-08-23-process-lifecycle-design.md');

function artifactSection(): string {
    const text = fs.readFileSync(DESIGN, 'utf8');
    const start = text.indexOf('### El artefacto');
    expect(start).toBeGreaterThan(-1);
    const end = text.indexOf('\n### ', start + 1);
    return text.slice(start, end === -1 ? undefined : end);
}

describe('process-model contract documents the optional description (PD-4)', () => {
    it('lists description in the frontmatter block as optional', () => {
        const section = artifactSection();
        expect(section).toMatch(/^description: <texto de una línea> {2}# opcional$/m);
    });

    it('states the rules the parser enforces and why the field exists', () => {
        const section = artifactSection();
        expect(section).toContain('#### Enmienda 2026-10-18 — `description` opcional');
        expect(section).toContain('una sola línea');
        expect(section).toContain('1024 caracteres');
        expect(section).toContain('Codex');
        expect(section).toContain('único campo opcional');
    });
});
```

Run CMD-DOCS → fails.

- [ ] **Step 2 — Implementation.** In the yaml block under `### El artefacto`, add the line `description: <texto de una línea>  # opcional` after `updated: YYYY-MM-DD`. Immediately after the closing fence of that yaml block, insert:

```markdown
#### Enmienda 2026-10-18 — `description` opcional

`description` es el único campo opcional del contrato. Existe porque el modelo *es* el `SKILL.md` del skill, y hay runtimes (Codex) que no cargan un `SKILL.md` sin `description`: sin el campo, el proceso queda instalado pero invisible en esas sesiones (Kodria/awm-personal-registry#3). Reglas: una sola línea, escalar plano o entre comillas (no se admiten block scalars `>`/`|`), no vacío y de a lo sumo 1024 caracteres. Un modelo sin `description` sigue siendo válido; cualquier otro campo fuera de la lista se sigue rechazando. Requiere `agentic-workflow-manager` posterior a 9.20.0: un CLI anterior rechaza el modelo con `unknown field "description"`.
```

- [ ] **Step 3 — GREEN.** Run CMD-DOCS → passes. Commit `docs(process): document the optional description field`.

#### Edge cases

The structural test anchors the section by its heading and stops at the next `### `, so a stray mention elsewhere in the file cannot satisfy it. Only additive edits to the design doc: nothing existing is removed or reworded.

#### Evidence

SRC-DESIGN. RED/GREEN: CMD-DOCS. Distinct clean specification and code-quality verdicts.

#### Fallback

If the heading moved or the yaml block changed shape, amend the plan's SRC-DESIGN locator and revalidate before editing.
