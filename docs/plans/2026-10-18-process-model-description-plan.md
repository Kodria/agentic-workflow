# Process Model `description` Field Implementation Plan
<!-- awm-qa-complete: 2026-10-19 -->
<!-- awm-docs-complete: 2026-10-19 -->
<!-- awm-retro-complete: 2026-10-19 -->

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

**Amendment A4 (S1 spec re-review, 2026-10-18):**
1. A raw `description` value that starts with `#` is a YAML comment, so YAML reads the field as null. It is rejected with `"description" must not be empty`, never accepted as `# …`.
2. The 1024 limit counts Unicode code points (`[...resolved].length`), not UTF-16 units, so 600 emoji (1200 UTF-16 units) pass.
3. A2(1) excludes comment lines. A line whose trimmed text starts with `#`, indented or not, keeps being skipped, as before the change and as in YAML.
4. Accepted limitation, no code: the parser is not a YAML validator. Content after a closing quote that is not a comment (`description: "a" junk`) is not detected. The contract doc (S2) says the CLI rejects the common invalid shapes and that it does not replace a YAML parser.

S1 gains tests for (1) and (2) and an indented `  # comentario` line after a valid description that keeps the model valid.

**Amendment A5 (S1 code-quality review, 2026-10-18):**
1. A plain (unquoted) `description` that YAML cannot read as the same string is rejected with `"description" must be quoted when it contains ": " or starts with a YAML indicator`. Typical case: `Use when: tracing` (js-yaml: bad indentation). This covers a raw plain value that:
   - contains `": "`,
   - ends with `:`, or
   - starts with one of `` [ ] { } , & * ! % @ ` ``.
   Quoted values are unaffected, and a leading `#` keeps the A4(1) empty message.
2. The non-pair message names its frame: `frontmatter line <n> is not a "key: value" pair (multi-line values are not supported)`. `<n>` stays 1-based inside the block; the file line is `<n> + 1`.
3. The block-scalar guard keeps only the prefix test `/^[>|]/`, which already covers every header that `isBlockScalarHeader` accepts. A comment says so, and the import is dropped.

S1 tests: the four plain shapes above are rejected with the new message; `"Use when: tracing"` (quoted) is accepted; the A1/A2 line-number assertions use the new wording.

**Amendment A6 (S2 reviews, 2026-10-18):** the S2 amendment text also names the trailing-`:` quoting rule (`termina en \`:\``), and says the 1024 limit counts characters as Unicode code points (`de a lo sumo 1024 caracteres (code points)`). The structural test collapses whitespace in the section before matching, as `cloud-admission-docs-contract.test.ts` does, so rewrapping the prose does not break it. It also pins `termina en`.

**Amendment A7 (post-implementation QA, 2026-10-19; owner chose "validate with js-yaml + fix everything").** All four QA reviewers converged on one root cause: the parser re-implemented YAML scalar rules by hand, and each review found another shape it misses (`- x`/`? x`, `a:<TAB>b`, values YAML types as null/bool/number/date, YAML-only escapes, control characters, NBSP). A7 replaces that with the real parser the CLI already ships (`js-yaml` is a runtime dependency used by `core/changes`). A7 supersedes PD-2's resolution by `findFrontmatterDescription`, A2(2), A3, A4(1), A4(2), A4(4) and A5(1); A1, A2(1), A4(3), A5(2) and A5(3) stay.

1. `description` checks, in this order, each one stopping on failure:
   1. A raw value starting with `>` or `|` gets the existing block-scalar message (A5(3)).
   2. A raw value longer than 16384 characters is rejected with the 1024 message without parsing. 16384 bounds the cost of parsing untrusted registry content.
   3. Parse the single line `description: <raw>` with `yaml.load` (js-yaml default schema), inside try/catch:
      - A parse error is rejected with `"description" must be a valid single-line YAML string (quote it)`.
      - `null` or `undefined`, including an empty value and a comment-only value, is rejected with `"description" must not be empty`.
      - Any other non-string (boolean, number, Date, sequence, mapping) is rejected with `"description" must be a string (quote values YAML reads as a boolean, a number, a date or a collection)`.
      - A string whose `trim()` is empty is rejected with `"description" must not be empty`.
      - A string longer than 1024 Unicode code points is rejected with the 1024 message.
   4. The model stores the string exactly as YAML returns it, with no trim, so a padded quoted value keeps its padding.
2. `cli/src/core/frontmatter.ts` returns to its `origin/main` content (the `opensUnclosedQuote` export is no longer needed), and `cli/tests/core/frontmatter-opens-unclosed-quote.test.ts` is deleted.
3. Indented frontmatter (Track A A1, important). The parser now catches a model that is lost because its keys are indented. When the block has no top-level `awm` pair but one of its continuation lines, trimmed, is `awm: process-model`, it returns `<file>: invalid process model — frontmatter keys must not be indented (frontmatter line <n>)` instead of silently treating the file as "not a model".
4. Tests:
   - Each QA shape is rejected with its A7 message:
     - parse error: `- foo`, `? foo`, `a:<TAB>b`, `Use when: tracing`, `"hola`, `"a" junk`, raw ESC;
     - non-string: `true`, `123`, `2026-01-01`, `[a, b]`;
     - empty: `null`, `~`, `# x`.
   - `"\x41"` resolves to `A`.
   - `"  padded  "` keeps its padding.
   - `"Use when: tracing"` and `'It''s'` are accepted.
   - 1024 vs 1025 code points (emoji), and a raw value over 16384 characters rejected quickly.
   - The indented-`awm` diagnostic.
   - A `cli/tests/commands/process.test.ts` case shows that `runProcessShow` with `--json` emits `"description"` for a model carrying one (PD-3, Track A A4).
   - Existing A1/A2(1)/A4(3) tests stay.
5. S2: the contract paragraph states that the value is validated with a YAML parser. It must be a single-line YAML string (plain or quoted), not empty and at most 1024 characters (code points). Values YAML reads as null, a boolean, a number, a date or a collection are rejected (they go in quotes). The "no reemplaza a un parser YAML" limitation sentence is removed. The structural test replaces `termina en` with `parser YAML`.
6. Out of scope, filed separately: `findFrontmatterDescription`'s comment regex (`frontmatter.ts`, `/\s+#.*$/`) is quadratic on long whitespace runs. That is pre-existing and reached by discovery for every `SKILL.md`, and after A7 it is no longer on the process-model path.

**Amendment A8 (QA revalidation, 2026-10-19).** The revalidation found one important finding and several minor ones, all with one cause: the value was re-parsed from a synthetic `description: <raw>` line built from `readPairs` output. That output is already JS-trimmed and split on `\s*:\s*`, so it differs from what a runtime reads:
- NBSP, BOM and U+3000 were stripped (important);
- `description:value` with no space after the colon passed;
- a short value with a long comment hit the raw cap.

A8 reads `description` from the whole frontmatter block loaded with js-yaml, which is exactly what a runtime does. It supersedes A7(1.2) and A7(1.3), and corrects A7(3) and A7(6).

1. When the block has a top-level `description` pair, the checks run in this order and stop at the first failure:
   1. Keep the block-scalar prefix guard on the raw pair value.
   2. A frontmatter block longer than 65536 characters is rejected with the 1024 message without parsing. This bounds the cost of untrusted input.
   3. `yaml.load(block)` runs inside try/catch:
      - a parse error is rejected with `"description" cannot be read: the frontmatter is not valid YAML`;
      - a result that is not a plain object is rejected with the same message;
      - otherwise the value under `description` goes through the A7 checks, in A7's order and with A7's messages: null/undefined → empty, non-string → string message, trim-empty → empty, more than 1024 code points → 1024 message.
   4. A new check comes last. A value containing C0 controls (tab excepted), DEL, C1 controls, U+2028/U+2029, the bidi overrides and isolates U+202A–U+202E and U+2066–U+2069, or a lone surrogate (`!value.isWellFormed()`) is rejected with `"description" must not contain control, line-break or bidirectional-override characters`. That covers escaped forms such as `"a\nb"`, `"\e[31m"`, `"‮"` and `"\uD800"`.
   5. The stored value is the YAML string as loaded from the block: untrimmed, with NBSP and BOM preserved.
   6. A zero-width-space-only value counts as non-empty. That is the documented policy, and a test pins it.
2. `readPairs` captures the value with `([\s\S]*)` instead of `(.*)`, so a line containing U+2028/U+2029 is still a pair. The new control-character check then rejects it, instead of the misleading multi-line message.
3. The indented-`awm` diagnostic (A7(3)) needs two things before it fires:
   - the cheap prefilter (a continuation line that, trimmed, is exactly `awm: process-model`, anchored);
   - and the whole block, under the same 65536 cap, loading with js-yaml to a plain object whose top-level `awm` is `'process-model'`.
   A non-model skill that only mentions it is no longer flagged. That covers a mention nested under `metadata:`, inside a block-scalar `description`, or as `  awm: process-model-x`.
4. Tests to add:
   - NBSP, BOM and U+3000 preserved;
   - `description:value` rejected;
   - a short value with a 20000-character comment accepted;
   - an escape-heavy valid value (`"` + `\x41`×1024 + `"`) accepted;
   - the 65536 block boundary;
   - each control, line-break, bidi and lone-surrogate case rejected;
   - the ZWSP-only value accepted;
   - exactly 1024 emoji accepted and 1025 rejected;
   - the unknown-field message lists `description`;
   - three negative indented-`awm` cases: nested metadata, block-scalar mention, `process-model-x`;
   - a discover-level test (`cli/tests/core/process/discover.test.ts`, following its existing isolated-registry pattern with tmp `HOME`/`AWM_HOME`) proving `description` survives parse → discover.
5. Correction to A7(6): `awm process` discovery still reaches the quadratic regex of #225, through `discoverSkills` → `readFrontmatterDescription` for every `SKILL.md`, before the process parser runs. It stays out of scope here; #225 notes that this path is affected too.
6. S2: the contract paragraph adds that control characters, line breaks and bidirectional-override characters are rejected. The structural test pins `caracteres de control`.

**Amendment A9 (QA round 3, 2026-10-19).** One important finding and several minor ones share a root cause: `readPairs` and YAML disagree about the block's structure.

The important finding: a bare CR inside `description` (`hello\rallowed-tools: Bash(*)`) is one pair for `readPairs`, which splits only on `\r?\n`. YAML reads a second, unvalidated top-level key from it.

The same class:
- an unclosed quote that YAML folds into the following `name:` line;
- JS `trim()` and `\s` eating NBSP/U+3000 before the block-scalar guard;
- a partially indented `awm` line silently dropping the model.

This recurring class is recorded for `harness-retro`: when the CLI validates a format that other tools consume, it validates with that format's real parser from the start.

1. `readPairs` splits lines on YAML line breaks (`/\r\n|\r|\n/`). Around the key separator and the value it trims only YAML whitespace (space and tab), never JS `\s`. The key regex uses `[ \t]*:[ \t]*`.
2. When the block is loaded (a top-level `description` is present), the top-level key set YAML reads must equal the key set `readPairs` read. Otherwise the model is rejected with `"description" cannot be read: the frontmatter does not read the same as YAML (check quotes and line breaks)`. This closes the bare-CR and swallowed-line cases and any future divergence of the same kind.
3. The indented-`awm` diagnostic fires when the anchored prefilter matches, there is no top-level `awm` pair, and either the block is not loadable YAML (partial or tab indentation) or it loads with a top-level `awm === 'process-model'`. A block that loads with no top-level `awm` (nested metadata, a block-scalar mention) stays silent.
4. `FORBIDDEN_CHAR` adds U+200E, U+200F and U+061C. The empty check removes zero-width characters (U+200B–U+200D, U+2060, U+FEFF) before `trim()`, so a value made only of them is empty. This supersedes the ZWSP policy of A8(1.6).
5. Tests:
   - bare CR smuggling (`description: hello\rallowed-tools: x`) rejected;
   - `#\rdescription: …` validated;
   - the swallowed-`name` case rejected;
   - NBSP+`>` accepted as a string;
   - partially indented and tab-indented `awm` producing the indented diagnostic;
   - a top-level-`awm` model with nested `metadata.awm: process-model` getting no indented diagnostic;
   - `\b` and `\x1f` rejected;
   - LRM/RLM/ALM rejected;
   - a ZWSP-only value rejected as empty.

**Amendment A10 (QA round 4 close-out, 2026-10-19; owner chose "cheap fixes + close").** Four QA rounds have converged on the realistic surface:
- 200k-case differential runs found no mismatch between the stored description and js-yaml;
- all 473 `.md` files in the repo parse the same as on `origin/main`, apart from the intended changes;
- both real registry models are byte-identical.

Round 4's remaining findings are esoteric parser-differential cases. The validator is an authoring quality gate, not a security boundary: a registry author already controls the skill's whole body.

1. Fixed: YAML 1.1 line breaks. A frontmatter line containing U+0085, U+2028 or U+2029, comment lines included, is a problem reported by position: `frontmatter line <n> contains a YAML 1.1 line break (NEL, LS or PS)`. That closes the comment-line key smuggling that PyYAML reads and js-yaml does not.
2. Fixed: a quoted description that YAML folds across a following `#` line. After the A8/A9 checks, the raw pair value is loaded alone as `description: <raw>` in try/catch. If that throws, or gives a different string than the whole-block value, the model is rejected with the block-scalar/multi-line message of A5(3): `"description" must be a single-line string (block scalars are not supported in a process model)`.
3. Discarded with reasons, recorded in QA:
   - **Indented-`awm` diagnostic on a non-model** whose YAML is already broken and that nests `metadata.awm: process-model`: a diagnostic on a broken file is acceptable.
   - **Trailing NBSP after `awm: process-model`:** YAML reads that as a different value, so dropping the model is correct.
   - **Invisible-only characters outside the A9 sets** (U+3164, U+00AD, variation selectors, the tag block): cosmetic, and no contract clause covers them.
   - **Moved to a separate issue, because they are pre-existing and shared by every artifact reader:**
     - `matchFrontmatterBlock` closing on a line that only starts with `---`;
     - slug-valid `name`/`terminates_to` values that YAML reads as non-strings (`null`, `0x1f`);
     - unbounded diagnostic size from `readPairs` on huge blocks.
4. Tests:
   - an LS/PS/NEL inside a comment line and inside a value line is rejected by position;
   - `description: "foo` followed by `# bar"` (double and single quote) is rejected with the single-line message;
   - realistic quoted, plain and commented descriptions stay accepted.

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

- [x] **Step 1 — RED.** Append to the `describe('parseProcessFrontmatter')` block of `cli/tests/core/process/model.test.ts`:

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

- [x] **Step 2 — Implementation.** In `cli/src/core/process/types.ts`, add to `ProcessModelFrontmatter`, after `updated: string;`:

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

- [x] **Step 3 — GREEN.** Run CMD-PROCESS, CMD-TYPECHECK and CMD-LINT → all pass. Commit `fix(process): admit an optional description in process models`.

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

- [x] **Step 1 — RED.** Create `cli/tests/structural/process-model-description-contract.test.ts`:

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

- [x] **Step 2 — Implementation.** In the yaml block under `### El artefacto`, add the line `description: <texto de una línea>  # opcional` after `updated: YYYY-MM-DD`. Immediately after the closing fence of that yaml block, insert:

```markdown
#### Enmienda 2026-10-18 — `description` opcional

`description` es el único campo opcional del contrato. Existe porque el modelo *es* el `SKILL.md` del skill, y hay runtimes (Codex) que no cargan un `SKILL.md` sin `description`: sin el campo, el proceso queda instalado pero invisible en esas sesiones (Kodria/awm-personal-registry#3). Reglas: una sola línea, escalar plano o entre comillas (no se admiten block scalars `>`/`|`), no vacío y de a lo sumo 1024 caracteres (code points). Un modelo sin `description` sigue siendo válido; cualquier otro campo fuera de la lista se sigue rechazando. El CLI rechaza las formas inválidas comunes (bloques, valores de varias líneas, comillas sin cerrar, un valor que es solo un comentario, y un valor sin comillas que contiene `: `, termina en `:` o empieza con un indicador YAML: esos van entre comillas), pero no reemplaza a un parser YAML: texto suelto después de una comilla cerrada no se detecta. Requiere `agentic-workflow-manager` posterior a 9.20.0: un CLI anterior rechaza el modelo con `unknown field "description"`.
```

- [x] **Step 3 — GREEN.** Run CMD-DOCS → passes. Commit `docs(process): document the optional description field`.

#### Edge cases

The structural test anchors the section by its heading and stops at the next `### `, so a stray mention elsewhere in the file cannot satisfy it. Only additive edits to the design doc: nothing existing is removed or reworded.

#### Evidence

SRC-DESIGN. RED/GREEN: CMD-DOCS. Distinct clean specification and code-quality verdicts.

#### Fallback

If the heading moved or the yaml block changed shape, amend the plan's SRC-DESIGN locator and revalidate before editing.
