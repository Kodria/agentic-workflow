# Frontmatter hardening (#225 / #226) — Design

**Status:** approved (owner 2026-10-19)  
**Approach:** surgical (Enfoque 1)  
**Issues:** Kodria/agentic-workflow#225, #226  
**Diagnosis:** `/opt/cursor/artifacts/package-a-frontmatter-diagnosis.md` (session) + ledger signatures on branch

## Context

Registry content is untrusted input. Four confirmed defects on the frontmatter / process-model parse path:

| ID | Defect | Surface |
|----|--------|---------|
| H1 | Quadratic `\s+#.*$` comment strip | `findFrontmatterDescription` |
| H2 | Closer matches `\n---` prefix (`---x`) | `matchFrontmatterBlock` |
| H3 | Slugs validated on raw `readPairs` text; YAML types diverge | `parseProcessFrontmatter` name / terminates_to |
| H4 | `readPairs` diagnostics unbounded; `FRONTMATTER_MAX` only on `yaml.load` | `parseProcessFrontmatter` |

## Decisions (locked)

- Scope: H1–H4 in one delivery, two serial slices.
- H3: reject bare YAML non-string tokens; accept quoted string form via `js-yaml` (option 1a).
- H4: block size cap **and** problem-count / key truncation (option 3).
- Architecture: keep `cli/src/core/frontmatter.ts` import-free (leaf). Do not parse description via js-yaml in that module. H3/H4 stay in `cli/src/core/process/model.ts` (already imports js-yaml).

## Non-goals

- Rewriting `findFrontmatterDescription` on top of js-yaml.
- Change Records, Spine, other open issues.
- New dependencies.
- Behavior change for well-formed frontmatter / process models that already match YAML string slugs.

## Requirements (EARS)

### Slice S1 — `frontmatter.ts` (H1, H2)

- **FH-1.** IF a plain (unquoted) `description` scalar contains a run of spaces or tabs with no following `#`, THEN THE CLI SHALL resolve that scalar in time that scales linearly with input length (regression: `expectLinearScaling` or equivalent bounded ratio), and SHALL NOT use a regex of the form `\s+#.*$` (or any nested-quantifier equivalent) for comment stripping.
- **FH-2.** IF a plain `description` scalar contains `#` preceded only by space or tab (U+0020 / U+0009), THEN THE CLI SHALL treat that `#` as starting a YAML comment and exclude it and the rest of the scalar from the value; IF `#` is preceded by any other character (including NBSP U+00A0), THEN THE CLI SHALL keep `#` and the following text as part of the value (js-yaml alignment).
- **FH-3.** IF a document’s frontmatter closing delimiter is a line that is exactly `---` with optional trailing spaces/tabs, THEN `matchFrontmatterBlock` SHALL include all lines between the opening `---` and that closer; IF a line begins with `---` followed by any non-space/tab character (e.g. `---x: 1`), THEN that line SHALL NOT close the frontmatter block. IF the inner frontmatter content would exceed `65536` characters before a valid closer is accepted, THEN `matchFrontmatterBlock` SHALL return `null` and SHALL stop accumulating further lines (bounds allocation).

### Slice S2 — `process/model.ts` (H3, H4)

- **FH-4.** IF the raw `name` or `terminates_to` pair value, when loaded with js-yaml as a single mapping value, is not a string, THEN `parseProcessFrontmatter` SHALL reject the model with a diagnostic that states the field must be a YAML string scalar (quote values YAML reads as null, boolean, or number); IF it loads as a string `S`, THEN THE CLI SHALL apply the existing `PROCESS_NAME` rule to `S` (and the existing `none` exception for `terminates_to`), not to the raw pair text. BEFORE calling `yaml.load`, strip a trailing YAML plain-scalar comment (` #…` / `\t#…`) from the raw value for the guard only; IF the remaining raw length exceeds 128 characters OR the remaining raw contains an alias/anchor token matching `/[&*][A-Za-z0-9_-]+/`, THEN THE CLI SHALL reject with the same YAML-string-scalar diagnostic and SHALL NOT call `yaml.load`. IF `checkDescription` would call `yaml.load` on the full block, THEN THE CLI SHALL first reject with the existing invalid-YAML description diagnostic when the block matches `/[&*][A-Za-z0-9_-]+/` (same alias class), without calling `yaml.load`.
- **FH-5.** IF `matchFrontmatterBlock` returns `null` because the source opens with `---` and either lacks a valid closer within the first `65536` inner characters or would exceed that inner limit, AND the source prefix declares `awm: process-model` (column-0 or indented `awm: process-model` line), THEN `parseProcessFrontmatter` SHALL reject with a size diagnostic; IF there is no process-model discriminator in that prefix, THEN return no diagnostics. IF a block is returned and its length exceeds `65536` (should not happen after FH-3), preserve the same size vs silence rules as before.
- **FH-6.** IF `readPairs` would produce more than 20 problems, THEN it SHALL stop recording further problem strings after 20 (still counting the remainder for the final `"N more problems"` suffix). IF an `unknown field` or `duplicate field` key is longer than 64 characters, THEN THE diagnostic SHALL show at most 64 characters of that key plus an ellipsis indicator.

## Constants (pinned)

| Name | Value | Where |
|------|-------|--------|
| `FRONTMATTER_MAX` | `65536` | existing in `model.ts`; apply before `readPairs` for FH-5 |
| `MAX_PROCESS_PROBLEMS` | `20` | new in `model.ts` |
| `UNKNOWN_FIELD_KEY_MAX` | `64` | new in `model.ts` |

## File map

| File | Role |
|------|------|
| `cli/src/core/frontmatter.ts` | FH-1..FH-3 |
| `cli/src/core/process/model.ts` | FH-4..FH-6 |
| `cli/tests/core/frontmatter-hardening.test.ts` | new — H1/H2 regressions + linear scaling |
| `cli/tests/core/process/model.test.ts` | extend — H3/H4 |
| `cli/tests/core/frontmatter-description-vs-yaml.test.ts` | keep green; NBSP case must match js-yaml after FH-2 |

## Verification

- Unit: linear scaling on plain-scalar strip; `---x` / `--- ` / CRLF closer; YAML non-string names rejected; quoted string names accepted; oversized process-model blocked; problem/key caps.
- Existing: `frontmatter-description-vs-yaml`, `process/model` suites, typecheck, lint, `awm sensors run` at finish.

## Out of scope follow-ups

- Generic ReDoS lint sensor (harness-retro already declined without new authorization).
- Moving description resolution entirely to js-yaml in the leaf module.
