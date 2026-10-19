# Windows ARM Change Record Shard Implementation Plan
<!-- awm-qa-complete: 2026-10-19 -->
<!-- awm-docs-complete: 2026-10-19 -->
<!-- awm-retro-complete: 2026-10-19 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the release gate's critical path from ~36–38 min to under 25 min by moving the Change Record suites out of the Windows ARM matrix remainder into a dedicated, gating ARM shard that runs in parallel (#223).

**Architecture:** `ci.yml` and `release.yml` gain a job `windows-arm-changes`, a copy of `windows-arm-hot` that runs only the 23 test files under `cli/tests/core/changes/`, `cli/tests/commands/change/` and `cli/tests/commands/changes/`. The ARM remainder's `--testPathIgnorePatterns` excludes those same files, so every test file still runs exactly once per platform. `release` adds the job to `needs`. The structural test that pins the partition (`native-release-artifacts.test.ts`) is extended so a missing, non-gating, skipped or mismatched shard fails, and D-005 records the new shape.

**Tech Stack:** GitHub Actions YAML, Jest 30 (`--testPathPatterns`), TypeScript structural tests.

**Change Record:** `ci-arm-change-record-shard`

**Criterios de aceptación:**
- Mergear y abrir la corrida de `release.yml` de ese merge en GitHub Actions → los jobs `test (windows-11-arm, win32-arm64)` y `windows-arm-changes` tardan menos de 25 min cada uno y `release` espera a los tres jobs de test
- En la misma corrida, el log de `windows-arm-changes` → corre 23 suites de test y ninguna falla

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** #223 (measured in its body: ARM remainder ~32 min, of which the Change Record suites are ~18 min; `windows-arm-hot` ~4.5 min of tests). On #227 the matrix ARM job took 38m28s. Dispatch: the owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "ci-arm-change-record-shard",
  "requirements": ["CI-1", "CI-2", "CI-3", "CI-4"],
  "sources": [
    {
      "id": "SRC-CI",
      "path": ".github/workflows/ci.yml",
      "locator": "  windows-arm-hot:",
      "fact": "The matrix step `Test (Windows ARM remainder)` runs `npx jest --runInBand --bail --testPathIgnorePatterns='node_modules|[/\\\\]cli[/\\\\]tests[/\\\\]commands[/\\\\]watch[/\\\\]track-(finalize|freeze)\\.test\\.ts$'` with env AWM_BASELINE_REGISTRY_ROOT; job `windows-arm-hot` (runs-on windows-11-arm; checkout, setup-node 22, npm ci, native:build && build, native:test-build) runs `npx jest --runTestsByPath tests/commands/watch/track-finalize.test.ts tests/commands/watch/track-freeze.test.ts --runInBand --bail`."
    },
    {
      "id": "SRC-RELEASE",
      "path": ".github/workflows/release.yml",
      "locator": "  windows-arm-hot:",
      "fact": "Same remainder step and `windows-arm-hot` job (plus `permissions: contents: read` and a two-line comment above it); `release:` declares `needs: [test, windows-arm-hot] # rojo en cualquier plataforma o shard ARM no publica`."
    },
    {
      "id": "SRC-PIN",
      "path": "cli/tests/structural/native-release-artifacts.test.ts",
      "locator": "function assertArmPartition",
      "fact": "assertArmPartition splits the workflow at `  windows-arm-hot:`, pins the exact remainder ignore pattern string, checks the hot job's runs-on/native builds/run line and absence of if/continue-on-error/upload-artifact; the 'runs each platform suite once' test pins `release:\\s*\\n\\s*needs: [test, windows-arm-hot]`; the mutation test asserts swapped guards, non-gating hot job, duplicate artifact, broadened ignore, skipped hot step, non-gating remainder and masked hot run all throw."
    },
    {
      "id": "SRC-D005",
      "path": "docs/decisions.md",
      "locator": "## D-005",
      "fact": "D-005 says release `needs: [test, windows-arm-hot]`, 'cualquiera de los dos shards ARM', and records the 2026-10-18 measurement pointing to #223."
    }
  ],
  "commands": [
    {
      "id": "CMD-PIN",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/native-release-artifacts.test.ts"],
      "covers": ["CI-1", "CI-2", "CI-3"]
    },
    {
      "id": "CMD-STRUCTURAL",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural"],
      "covers": ["CI-4"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["CI-3"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Change Record ARM shard, pinned partition and D-005",
      "requirements": ["CI-1", "CI-2", "CI-3", "CI-4"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-CI", "SRC-RELEASE", "SRC-PIN", "SRC-D005"],
      "redCommands": ["CMD-PIN"],
      "greenCommands": ["CMD-PIN", "CMD-STRUCTURAL", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["root-configuration"]
    }
  ],
  "closureCommands": ["CMD-PIN", "CMD-STRUCTURAL", "CMD-TYPECHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

**Requirements:**

- **CI-1** — Both `ci.yml` and `release.yml` have exactly one job `windows-arm-changes`, identical in setup to `windows-arm-hot` (runs-on `windows-11-arm`; in release.yml also `permissions: contents: read`; checkout, setup-node 22, `npm ci`, `npm run native:build && npm run build`, `npm run native:test-build`, all with `working-directory: cli`). Its single test step is named `Test Change Record Windows ARM suites` and runs exactly `npx jest --runInBand --bail --testPathPatterns='[/\\]cli[/\\]tests[/\\](core[/\\]changes|commands[/\\]changes?)[/\\]'`. It has no `if:`, no `continue-on-error`, and no artifact upload.
- **CI-2** — The ARM remainder's ignore pattern becomes exactly `node_modules|[/\\]cli[/\\]tests[/\\]commands[/\\]watch[/\\]track-(finalize|freeze)\.test\.ts$|[/\\]cli[/\\]tests[/\\](core[/\\]changes|commands[/\\]changes?)[/\\]`, so each test file runs exactly once on ARM (today: 355 remainder + 23 shard + 2 hot = 380). `release` declares `needs: [test, windows-arm-hot, windows-arm-changes]` (comment kept).
- **CI-3** — `native-release-artifacts.test.ts` pins the new shape on both workflows, LF and CRLF:
  - the exact remainder pattern;
  - that the shard and remainder patterns cover the same paths (the remainder pattern is the old pattern plus `|` plus the shard pattern, and the shard regex matches `cli/tests/core/changes/x.test.ts`, `cli/tests/commands/change/new.test.ts` and `cli/tests/commands/changes/list.test.ts` with both separators, and not `cli/tests/core/changesets/x.test.ts`);
  - the shard job's setup and run line;
  - the new `needs`.

  The mutation test adds cases that must throw: a non-gating shard (`continue-on-error: true`), a skipped shard step (`if: false`), a masked shard run (`; exit 0`), a shard pattern that differs from the remainder's exclusion, and a `release` that does not need the shard.
- **CI-4** — D-005 in `docs/decisions.md` names the three gating jobs, the three ARM shards (remainder, `windows-arm-hot`, `windows-arm-changes`), and closes the measurement note in Spanish, like the rest of the document ("Esas suites quedaron particionadas por #223"). The summary table row stays the same.

**Amendment A1 (S1 implementer, 2026-10-19):** CI-4 is written in Spanish, as said above. The comment above the remainder step in both workflows also names the third shard: `# The ARM runner's slow suites run in two separate jobs (watch track-finalize/freeze, and the Change Record suites). Keep runInBand within each job; no test file may run twice or be dropped.`

**Amendment A2 (post-implementation QA, 2026-10-19).** The pinned test also guards the release gate's other bypasses:
1. The `release` job has no `if:` and no `continue-on-error` (QA important: `if: always()` would publish past red shards).
2. Neither the `test` job nor the two ARM shard jobs has a job-level `continue-on-error`, in any form, including expressions.
3. The remainder step rejects `continue-on-error` in any form, not only `true`.
4. `needs` is compared as a set, so reordering it stays green. The set must still be exactly `{test, windows-arm-hot, windows-arm-changes}`.
5. Each real shard directory (`cli/tests/core/changes`, `cli/tests/commands/change`, `cli/tests/commands/changes`) exists, contains at least one `*.test.ts`, and matches `CHANGES_PATTERN`, so the case-only walk cannot pass vacuously.
6. The redundant prefix assertion is dropped.

Discarded, with reason: commit `c21b206f` touched `ci.yml` under a `docs(ci)` subject instead of `ci(release)`. Neither prefix produces a release, and rewriting pushed history is not worth it.

**Amendment A3 (QA verification of A2, 2026-10-19).** Two gaps remained.

First, A2 items 2 and 3 checked only specific places and spellings. The regular `Tests` step still accepted `continue-on-error: true` after its `run:` line, and the `test` job accepted a quoted `"continue-on-error"` key. A3 replaces items 2 and 3 with one rule: the gating jobs `test`, `windows-arm-hot`, `windows-arm-changes` and (in release.yml) `release` do not contain the text `continue-on-error` anywhere, in any quoting. Today neither workflow uses it.

Second, the self-test built its `needs` mutations by replacing the literal `[test, windows-arm-hot, windows-arm-changes]`, so a legitimate reorder turned it red. The mutations are now built from the list `RELEASE_NEEDS` actually matched, and a reordered `needs` keeps the whole file green.

**Amendment A4 (QA verification of A3, 2026-10-19).** The gate checks were still regexes over YAML text. A quoted `"if": always()` on `release` and quoted `'if'` keys on shard steps passed, which is the same class of finding as CTX-AGENTS-031 (validate a format with its real parser). A4 makes the gate semantics structural.

The pinned test loads both workflows with js-yaml (already a CLI dependency) and asserts on the parsed object:
- `jobs.release` (release.yml) has no `if` and no `continue-on-error`, and its `needs`, as a set, is exactly `{test, windows-arm-hot, windows-arm-changes}`.
- In `jobs.test`, `jobs['windows-arm-hot']` and `jobs['windows-arm-changes']`, neither the job nor any step has `continue-on-error`.
- The shard jobs and their steps have no `if`.
- In `jobs.test`, the only steps with `if` are the two test steps, and their values are exactly `matrix.target != 'win32-arm64'` and `matrix.target == 'win32-arm64'`.
- The shard `run` strings and the remainder ignore pattern are read from the parsed steps.

Text checks remain only where the exact text is the contract: the run lines (also compared structurally), the A1 comment, and CRLF handling.

The reorder self-test picks a permutation of the matched `needs` that differs from the current one. Mutation cases are added for quoted `"if"`, single-quoted `'if'` and an escaped `"continue-on-error"` on release, test and shard jobs and steps.

**Shared constraints:** touch only `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `cli/tests/structural/native-release-artifacts.test.ts`, `docs/decisions.md`. Never read or write `~/.awm`. Commit subjects: `ci(release): …` for the workflows and the pinned test, `docs(decisions): …` for D-005, each ending with the session attribution lines.

<a id="slice-s1"></a>
### Slice S1: Change Record ARM shard, pinned partition and D-005

#### Surfaces

Owns CI-1..CI-4: one partition boundary. The workflows, the test that pins them, and the decision that explains them must change together, or the structural test or the gate disagrees with reality.

- Modify `.github/workflows/ci.yml` and `.github/workflows/release.yml`.
- Modify `cli/tests/structural/native-release-artifacts.test.ts`.
- Modify `docs/decisions.md` (D-005 body only).

#### Implementation

- [x] **Step 1 — RED.** In `native-release-artifacts.test.ts`:
  - add the constants `HOT_IGNORE` (the current pattern) and `CHANGES_PATTERN = String.raw\`[/\\]cli[/\\]tests[/\\](core[/\\]changes|commands[/\\]changes?)[/\\]\``;
  - make `assertArmPartition` expect the remainder pattern `${HOT_IGNORE}|${CHANGES_PATTERN}`;
  - make it split out a second job at `  windows-arm-changes:` and assert CI-1 for it;
  - change the `needs` regex to `needs: \[test, windows-arm-hot, windows-arm-changes\]`;
  - add the CI-3 path-coverage checks and mutation cases.

  Run CMD-PIN → it fails, because the workflows are unchanged.
- [x] **Step 2 — Implementation.**
  - In both workflows, change the remainder's `--testPathIgnorePatterns` to the CI-2 pattern.
  - Add the job `windows-arm-changes` right after `windows-arm-hot`. Copy the hot job verbatim, including the release.yml permissions block. Replace the test step name with `Test Change Record Windows ARM suites` and its run line with the CI-1 command. In release.yml, also add a one-line comment above it: `# The Change Record suites (git-heavy) are the ARM remainder's largest block (#223).`.
  - In release.yml, set `needs: [test, windows-arm-hot, windows-arm-changes] # rojo en cualquier plataforma o shard ARM no publica`.
  - Update D-005 per CI-4.
- [x] **Step 3 — GREEN.** Run CMD-PIN, CMD-STRUCTURAL, CMD-TYPECHECK → pass. Locally confirm the counts with `npx jest --listTests` for:
  - the shard pattern (23);
  - the remainder ignore (355);
  - the two hot files (2);
  - everything (380).

  Commit.

#### Edge cases

- Windows paths use `\`. Both patterns use `[/\\]` like the existing one, and the test asserts both separators.
- `changes?` must cover `commands/change/` and `commands/changes/` but not similar names such as `changesets`. Because the pattern requires a trailing separator after the directory name, `changesets/` does not match. Assert it.
- Jest 30 renamed `--testPathPattern` to `--testPathPatterns`. Use the plural form, and the pinned test asserts it.
- No test file may run twice or be dropped. The pinned test proves the shard pattern is exactly what the remainder excludes beyond the hot suites.

#### Evidence

SRC-CI, SRC-RELEASE, SRC-PIN, SRC-D005. RED: CMD-PIN. GREEN: CMD-PIN, CMD-STRUCTURAL, CMD-TYPECHECK, plus the `--listTests` counts. Distinct, clean specification and code-quality verdicts. The real proof is the CI run on the PR: the seven jobs become eight, and the slowest ARM job drops below 25 min.

#### Fallback

Root-configuration risk: this is the release gate. If the PR's CI shows the shard picking up a different number of suites than 23, or the remainder not dropping, stop and amend the patterns before merging.
