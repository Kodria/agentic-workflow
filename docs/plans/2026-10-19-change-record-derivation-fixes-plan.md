# Change Record Derivation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Change Record describe the change, not the AWM process: resolve the base against the remote default branch before a possibly stale local `main`, and stop plan-only commits from choosing `type` and `scope` (pilot findings on #222).

**Architecture:** Two serial slices in `cli/src/core/changes/`. S1 extends the candidate list of `resolveBaseCommit` (`git.ts`), the one resolver used by `change new`, `change validate` and `changes list`. S2 makes `deriveFields` (`derive.ts`) read a second, path-limited commit list that also excludes `docs/plans/`, and passes it to `deriveFromCommits` as the commits that choose `type` and `scope`, while `semver` and `breaking` keep using every commit. The contract is the 2026-10-19 amendment in `docs/plans/2026-10-17-change-record-design.md`.

**Tech Stack:** TypeScript (CLI), git pathspecs, Jest 30.

**Change Record:** `change-record-derivation-fixes`

**Criterios de aceptación:**
- Con la versión publicada, en un clon de `agentic-workflow` sin `origin/HEAD` (`git remote set-head origin -d`) y con el `main` local atrasado, correr `awm changes list --format voice` → lista los Change Records de `origin/main`, no dice que el repo todavía no usa Change Records
- Con la versión publicada, en una rama cuyo primer commit es `docs(plans): …` y el resto son `ci(release): …`, correr `awm sensors run` y `awm change new prueba` → el registro dice `type: ci` y `scope: release`

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

**Origen:** owner decisions of 2026-10-19 (options "Ignorar commits del plan" and "Preferir origin/main"), findings in https://github.com/Kodria/agentic-workflow/issues/222#issuecomment-6265512960. Dispatch: the owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "change-record-derivation-fixes",
  "requirements": ["CRD-1", "CRD-2", "CRD-3"],
  "sources": [
    {
      "id": "SRC-GIT",
      "path": "cli/src/core/changes/git.ts",
      "locator": "export function resolveBaseCommit",
      "fact": "resolveBaseCommit(root, explicit?) loops over `explicit !== undefined ? [explicit] : ['refs/remotes/origin/HEAD', 'main', 'master']`, returning `{ base: candidate, sha }` for the first candidate whose commitSha is non-null, else null. Its doc comment says `R3.1: --base, then origin/HEAD, then main, then master`."
    },
    {
      "id": "SRC-RANGE",
      "path": "cli/src/core/changes/range.ts",
      "locator": "export function resolveBaseRef",
      "fact": "resolveBaseRef and resolveRange delegate to resolveBaseCommit; their doc comments list the order `origin/HEAD, main, master`. `changes list` (`--base` help in cli/src/commands/changes/index.ts: 'base branch (default: origin/HEAD, main, master)') and `change new`/`change validate` all go through here."
    },
    {
      "id": "SRC-DERIVE",
      "path": "cli/src/core/changes/derive.ts",
      "locator": "export function deriveFromCommits",
      "fact": "deriveFromCommits(input) filters usable commits, picks type by breaking > feat > fix > perf > commits[0], scope by highest count then code-unit order, semver by determineBump over all, breaking over all; returns null when no usable commit. deriveFields runs `git log ... --no-merges --full-history --reverse -z --format=GIT_LOG_FORMAT --end-of-options <range> -- ':/' ':(top,exclude,literal)docs/changes'`, turns the NUL-separated records into commits with commitsFromRecords, and fails with no-commits / no-conventional-commits."
    },
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-17-change-record-design.md",
      "locator": "#### Enmienda 2026-10-19 — derivación corregida tras el piloto",
      "fact": "The amended R3.1 (order --base, refs/remotes/origin/HEAD, refs/remotes/origin/main, refs/remotes/origin/master, main, master) and amended R3.3 (plans-only commits ignored for type and scope, kept for semver and breaking; fallback to all when every usable commit is plans-only) are the contract."
    },
    {
      "id": "SRC-CLIREF",
      "path": "docs/cli-reference.md",
      "locator": "awm change new <slug> [--base <ref>]",
      "fact": "The `awm change new` flag table and the derived-fields list (`- `scope`: the most frequent scope, or `null`.`) document the old rules; the `awm changes list` section says to run `git fetch` first if `origin/HEAD` is stale."
    }
  ],
  "commands": [
    {
      "id": "CMD-BASE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/changes/git.test.ts", "tests/core/changes/range.test.ts"],
      "covers": ["CRD-1"]
    },
    {
      "id": "CMD-DERIVE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/changes/derive.test.ts"],
      "covers": ["CRD-2"]
    },
    {
      "id": "CMD-CHANGES",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/changes", "tests/commands/change", "tests/commands/changes"],
      "covers": ["CRD-1", "CRD-2", "CRD-3"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["CRD-1", "CRD-2"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Base resolution prefers the remote default branch",
      "requirements": ["CRD-1"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-GIT", "SRC-RANGE", "SRC-DESIGN", "SRC-CLIREF"],
      "redCommands": ["CMD-BASE"],
      "greenCommands": ["CMD-BASE", "CMD-CHANGES", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "bounded",
      "fallback": ["standard-review"]
    },
    {
      "id": "S2",
      "title": "Plan-only commits do not choose type or scope",
      "requirements": ["CRD-2", "CRD-3"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DERIVE", "SRC-DESIGN", "SRC-CLIREF"],
      "redCommands": ["CMD-DERIVE"],
      "greenCommands": ["CMD-DERIVE", "CMD-CHANGES", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-CHANGES", "CMD-TYPECHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

**Requirements:**

- **CRD-1** — `resolveBaseCommit` without an explicit base tries, in order, `refs/remotes/origin/HEAD`, `refs/remotes/origin/main`, `refs/remotes/origin/master`, `main`, `master`, and returns the first that names a commit, with that candidate string as `base`. An explicit base is still the only candidate (no fallback). Doc comments in `git.ts` and `range.ts`, the `--base` help text of `awm changes list`, `awm change new` and `awm change validate` (wherever it lists the default order), and the `--base` rows of `docs/cli-reference.md` name the new order.
- **CRD-2** — `deriveFields` derives `type` and `scope` from the usable commits of the range that touch at least one path outside both `docs/changes/` and `docs/plans/`. When there is none, it uses every usable commit, as before. `semver` and `breaking` are computed over every usable commit (unchanged), and `no-commits` / `no-conventional-commits` are decided over every commit (unchanged). `deriveFromCommits(all, focus?)` takes the focus list as an optional second argument. When it is omitted, not an array, or has no usable commit, `all` is used, so existing callers and tests keep their behaviour.
- **CRD-3** — `docs/cli-reference.md` (the `awm change new` derived-fields list) states that commits touching only `docs/plans/` do not choose `type` or `scope` but still count for `semver` and `breaking`.

**Amendment A1 (S1 specification review, 2026-10-19):** CRD-1's doc comments also include the `ListOptions.base` comment in `cli/src/core/changes/list.ts` (line ~65, "omitted, R3.1 picks origin/HEAD, main or master"), which the S1 surfaces had missed. S1 owns that one comment line; nothing else in `list.ts` changes. SRC-CLIREF's locator moves to the stable usage line `awm change new <slug> [--base <ref>]`, because S1 rewrote the `--base` row it used to point at.

**Amendment A2 (S2 implementer, 2026-10-19):** two corrections found while implementing S2.
1. In the S2 test "plan-only commits do not choose type or scope (the #228 shape)", the `docs(decisions)` commit also chooses, so `release` and `decisions` tied 1:1 and the unchanged code-unit tie-break gave `decisions`. The fixture gains a second `ci(release): gate it` commit touching `.github/workflows/release.yml` (closer to the real #228, which had six), so `release` wins 2:1 under the new rule. Under the old rule `plans` (3) would still win, so the test keeps failing first. The expected record stays `{ type: 'ci', scope: 'release', semver: 'none', breaking: false, modules: ['.github/workflows', 'docs', 'docs/plans'] }`.
2. `cli/tests/commands/change/validate.test.ts` (~line 881, "both records are valid, and git derives, checks ancestry and lists late files once") counts the derivation's `git log` calls (`--no-merges`) as 1. The second, focus log makes it 2 per derivation, still one derivation per verification commit. S2 owns that assertion: expect 2, with a comment naming the full log and the focus log.

**Amendment A3 (post-implementation QA, 2026-10-19).** The owner switched this plan to unattended mode after both slices were complete ("avanza desatendido hasta el PR"), so QA fixes every finding. Track A and the robustness, logic and tests lenses found no blockers. The fixes below are owned by a QA fix pass (requirements CRD-1 and CRD-2):

- **Q1 (tests)** — a test makes the second, focus `git log` fail while the first succeeds and asserts `deriveFields` returns `git-failed`. The fail-open mutant `(focusRaw ?? '')` must fail it.
- **Q2 (tests)** — with both `refs/remotes/origin/main` and `refs/remotes/origin/master` (different commits) and no `origin/HEAD`, the base is `origin/main`. Swapping them in the candidate list must fail it.
- **Q3 (tests)** — command-level tests exercise both fixes end to end: `awm change new` on a branch shaped like #228 (plan commits first, then `ci(release)` commits) writes `type: ci` and `scope: release`; and a command run with no `origin/HEAD`, a current `origin/main` and a stale local `main` uses `origin/main`.
- **Q4 (tests)** — the "only the top-level docs/plans is excluded" test gets fixtures that fail if nested `cli/docs/plans/` or `docs/plans-old/` were also excluded.
- **Q5 (tests)** — the subdirectory derivation test includes a plan-only commit, so dropping `top` from `EXCLUDE_PLANS` fails it.
- **Q6 (tests + code)** — the `--base` help text is built from the candidate list, not hand-written, and a test asserts it names the defaults in order.
- **Q7 (code, regression)** — without `--base`, `resolveRange` (used by `change new` and `change validate`) uses the first candidate that both names a commit and has a merge base with HEAD. A shallow `origin/main` that does not connect to HEAD no longer hides a connected local `main`. `changes list` keeps the first candidate that names a commit, because it needs no merge base.
- **Q8 (docs + test)** — when the branch's code commits are not conventional, `type` and `scope` fall back to every conventional commit, which can be the plan's. That is the fallback the amendment defines (no type is invented). The design amendment and `docs/cli-reference.md` say so explicitly, and a test pins it.
- **Q9 (code)** — `resolveRange` computes the merge base from the pinned commit id it resolved, not by resolving the base name a second time.
- **Q10 (code)** — the local defaults resolve as the full refs `refs/heads/main` and `refs/heads/master`, so a tag named `main` cannot redirect the base. The reported `base` stays `main`/`master`. A test with a tag `main` pointing elsewhere pins it.

The design amendment's R3.1 bullet gains Q7 and Q10, and its R3.3 bullet gains Q8. The QA fix pass may also touch `docs/plans/2026-10-17-change-record-design.md` (that amendment section only).

**Shared constraints:** touch only `cli/src/core/changes/git.ts`, `cli/src/core/changes/range.ts`, `cli/src/core/changes/list.ts` (one comment, A1), `cli/src/core/changes/derive.ts`, `cli/src/commands/change/**`, `cli/src/commands/changes/**` (help text only), `cli/tests/core/changes/**`, `cli/tests/commands/change/**`, `cli/tests/commands/changes/**`, `docs/cli-reference.md`. Never read or write `~/.awm`. Tests use the existing helpers in `cli/tests/core/changes/helpers.ts` (isolated tmp repos). Commit subjects: `fix(changes): …` for code and tests, `docs(changes): …` for documentation only, each ending with the session attribution lines.

<a id="slice-s1"></a>
### Slice S1: Base resolution prefers the remote default branch

#### Surfaces

Owns CRD-1. One resolver decides the base for all three commands, so the order changes in one place.

- Modify `cli/src/core/changes/git.ts` (`resolveBaseCommit` and its doc comment).
- Modify the doc comments in `cli/src/core/changes/range.ts` and the `ListOptions.base` comment in `cli/src/core/changes/list.ts` (A1).
- Modify the `--base` option descriptions in `cli/src/commands/change/` and `cli/src/commands/changes/` that list the default order.
- Modify `cli/tests/core/changes/git.test.ts`.
- Modify the `--base` row(s) and the stale-`origin/HEAD` sentence in `docs/cli-reference.md`.

#### Implementation

- [x] **Step 1 — RED.** In `git.test.ts`, next to `R3.1 resolves base: explicit, origin/HEAD, main, master`, add:

  ```ts
  test('R3.1 without origin/HEAD, origin/main wins over a local main', () => {
      branch();
      repo.git('update-ref', 'refs/remotes/origin/main', 'main');
      expect(baseOf(repo.root)).toBe('refs/remotes/origin/main');
  });
  test('R3.1 origin/master is used when there is no origin/HEAD nor origin/main, before a local main', () => {
      branch();
      repo.git('update-ref', 'refs/remotes/origin/master', 'main');
      expect(baseOf(repo.root)).toBe('refs/remotes/origin/master');
  });
  test('R3.1 origin/HEAD still wins over origin/main', () => {
      branch();
      repo.git('update-ref', 'refs/remotes/origin/main', 'main');
      repo.git('update-ref', 'refs/remotes/origin/trunk', 'main');
      repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
      expect(baseOf(repo.root)).toBe('refs/remotes/origin/HEAD');
  });
  test('R3.1 an explicit base never falls back to origin/main', () => {
      repo.git('update-ref', 'refs/remotes/origin/main', 'main');
      expect(baseOf(repo.root, 'nope')).toBeNull();
  });
  ```

  Rename the existing test to `R3.1 resolves base: explicit, origin/HEAD, origin/main, origin/master, main, master`. Run CMD-BASE. The first two new tests fail.
- [x] **Step 2 — Implementation.** In `git.ts`:

  ```ts
  /** R3.1 (amended 2026-10-19): the default base candidates, remote first so a stale local branch is the last resort. */
  const DEFAULT_BASES: readonly string[] = ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'main', 'master'];
  ```

  Loop over `explicit !== undefined ? [explicit] : DEFAULT_BASES`. Update the doc comment of `resolveBaseCommit` and the two in `range.ts` to `--base, then origin/HEAD, origin/main, origin/master, main, master`. Update every `--base` help string that lists the default (grep `origin/HEAD` under `cli/src/commands/change` and `cli/src/commands/changes`). In `docs/cli-reference.md`, update each `--base` row to `Default: \`origin/HEAD\`, then \`origin/main\`, \`origin/master\`, \`main\`, \`master\`.` and change the `changes list` sentence to `run \`git fetch\` first if the remote branch is stale`.
- [x] **Step 3 — GREEN.** Run CMD-BASE, CMD-CHANGES, CMD-TYPECHECK → pass. Commit `fix(changes): prefer the remote default branch as the Change Record base`.

#### Edge cases

- `origin/HEAD` pointing nowhere is still skipped, and with `origin/main` present the result is now `refs/remotes/origin/main`. The existing test `R3.1 origin/HEAD that points nowhere is skipped` expects `main` and has no `origin/main`, so it stays valid. Do not change it.
- A local branch literally named `origin/main` (`refs/heads/origin/main`) must not be picked up: the candidate is the full `refs/remotes/...` name, so it is not ambiguous.
- Tests in `tests/commands/changes` or `tests/commands/change` that create `refs/remotes/origin/main` without `origin/HEAD` and assert `base: 'main'` would change meaning. Run CMD-CHANGES and fix only those assertions, explaining each in the report.

#### Evidence

SRC-GIT, SRC-RANGE, SRC-DESIGN, SRC-CLIREF. RED: CMD-BASE. GREEN: CMD-BASE, CMD-CHANGES, CMD-TYPECHECK. Distinct, clean specification and code-quality verdicts.

#### Fallback

Bounded risk: one resolver, covered by unit tests. If a command test outside `tests/core/changes/git.test.ts` changes meaning (see Edge cases), record it as an amendment before fixing the assertion.

<a id="slice-s2"></a>
### Slice S2: Plan-only commits do not choose type or scope

#### Surfaces

Owns CRD-2 and CRD-3. The derivation and its user documentation change together.

- Modify `cli/src/core/changes/derive.ts` (`deriveFromCommits`, `deriveFields`).
- Modify `cli/tests/core/changes/derive.test.ts`.
- Modify the git-call count assertion in `cli/tests/commands/change/validate.test.ts` (A2).
- Modify `docs/cli-reference.md` (the `awm change new` derived-fields list).

#### Implementation

- [x] **Step 1 — RED.** In `derive.test.ts`:

  Unit tests, in `deriveFromCommits and deriveFields (no repository)`:

  ```ts
  test('R3.3 (amended) type and scope come from the focus commits; semver and breaking from all', () => {
      const all = [c('docs', 'plans'), c('ci', 'release'), c('docs', 'plans'), c('feat', 'plans', true)];
      const focus = [c('ci', 'release')];
      expect(deriveFromCommits(all, focus)).toEqual({ type: 'ci', scope: 'release', semver: 'major', breaking: true });
  });
  test('R3.3 (amended) an empty, unusable or non-array focus falls back to all commits', () => {
      const all = [c('docs', 'plans'), c('ci', 'release')];
      const expected = deriveFromCommits(all);
      for (const focus of [[], [{ type: 'x y', scope: null, breaking: false, subject: '' }], undefined, null, 'x'] as unknown[]) {
          expect(deriveFromCommits(all, focus as never)).toEqual(expected);
      }
  });
  ```

  Real-repository tests, in `deriveFields in a repository`:

  ```ts
  test('R3.3 (amended) plan-only commits do not choose type or scope (the #228 shape)', () => {
      const base = branch();
      repo.commit({ 'docs/plans/p.md': '1' }, 'docs(plans): plan it');
      repo.commit({ '.github/workflows/ci.yml': '1' }, 'ci(release): shard');
      repo.commit({ 'docs/plans/p.md': '2' }, 'docs(plans): amend A1');
      repo.commit({ 'docs/plans/p.md': '3' }, 'docs(plans): amend A2');
      repo.commit({ '.github/workflows/release.yml': '1' }, 'ci(release): gate it');
      repo.commit({ 'docs/decisions.md': '1' }, 'docs(decisions): record it');
      expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'ci', scope: 'release', semver: 'none', breaking: false, modules: ['.github/workflows', 'docs', 'docs/plans'] } });
  });
  test('R3.3 (amended) a plan-only commit still counts for semver and breaking', () => {
      const base = branch();
      repo.commit({ 'docs/plans/p.md': '1' }, 'feat(plans)!: plan a breaking change');
      repo.commit({ 'cli/src/a.ts': '1' }, 'fix(process): code');
      expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'fix', scope: 'process', semver: 'major', breaking: true, modules: ['cli/src', 'docs/plans'] } });
  });
  test('R3.3 (amended) a commit touching docs/plans and code counts for type and scope', () => {
      const base = branch();
      repo.commit({ 'cli/src/a.ts': '1' }, 'chore(x): first');
      repo.commit({ 'docs/plans/p.md': '1', 'cli/src/b.ts': '1' }, 'docs(plans): mixed');
      repo.commit({ 'docs/plans/p.md': '2', 'cli/src/c.ts': '1' }, 'docs(plans): mixed again');
      expect(deriveFields(repo.root, mergeBase(repo.root, base))).toMatchObject({ ok: true, fields: { type: 'chore', scope: 'plans' } });
  });
  test('R3.3 (amended) a pure planning branch keeps type and scope from its plan commits', () => {
      const base = branch();
      repo.commit({ 'docs/plans/p.md': '1' }, 'docs(plans): plan only');
      expect(deriveFields(repo.root, mergeBase(repo.root, base))).toEqual({ ok: true, fields: { type: 'docs', scope: 'plans', semver: 'none', breaking: false, modules: ['docs/plans'] } });
  });
  test('R3.3 (amended) only the top-level docs/plans is excluded, not similarly named directories', () => {
      const base = branch();
      repo.commit({ 'docs/plans-old/p.md': '1' }, 'docs(archive): old plans');
      repo.commit({ 'cli/docs/plans/p.md': '1' }, 'chore(cli): nested');
      expect(deriveFields(repo.root, mergeBase(repo.root, base))).toMatchObject({ ok: true, fields: { type: 'docs', scope: 'archive' } });
  });
  ```

  The `branchOff` helper returns the base ref; the expected `modules` above follow R3.4 (three segments, sorted). Adjust only a `modules` literal if the helper's base already contains files. Run CMD-DERIVE. The new tests fail.
- [x] **Step 2 — Implementation.** In `derive.ts`:

  ```ts
  const EXCLUDE_PLANS = ':(top,exclude,literal)docs/plans';
  ```

  `deriveFromCommits(input: Commit[], focusInput?: Commit[])`:

  ```ts
  const commits = usable(input);
  if (commits.length === 0) return null;
  const focused = usable(focusInput);
  const chooser = focused.length > 0 ? focused : commits;
  const breaking = commits.some((c) => c.breaking);
  const pick = chooser.find((c) => c.breaking) ?? chooser.find((c) => c.type === 'feat') ?? chooser.find((c) => c.type === 'fix')
      ?? chooser.find((c) => c.type === 'perf') ?? chooser[0];
  // scope counts over `chooser`; semver = determineBump(commits) ?? 'none' (unchanged)
  ```

  `usable` already returns `[]` for a non-array. Update the doc comment: R3.3 as amended 2026-10-19.

  In `deriveFields`, after the existing log, run a second log with identical arguments plus `EXCLUDE_PLANS` after `EXCLUDE_RECORDS`. If it returns null, fail `git-failed` with the same message as the first log. Turn its records into `focus` with `commitsFromRecords`. Call `deriveFromCommits(commits, focus)`. The `no-commits` / `no-conventional-commits` checks stay on the first log only. Keep the comment explaining why `--full-history` is used, and add one line saying why the second log exists (R3.3 amended: plan-only commits do not choose type or scope).

  In `docs/cli-reference.md`, replace the `type, breaking, semver` and `scope` bullets of `awm change new` with:

  ```markdown
  - `type`, `breaking`, `semver`: from the conventional-commit subjects, with the release parser. `semver` is `major` if any commit is breaking, else `minor` if any is `feat`, else `patch` if any is `fix` or `perf`, else `none`. `type` is the highest-impact commit's type (breaking > feat > fix > perf > first commit).
  - `scope`: the most frequent scope, or `null`.
  - Commits that only touch `docs/plans/` (the plan, its amendments and lifecycle marks) do not choose `type` or `scope`, unless every commit is like that; they still count for `semver` and `breaking`.
  ```
- [x] **Step 3 — GREEN.** Run CMD-DERIVE, CMD-CHANGES, CMD-TYPECHECK → pass. Commit `fix(changes): stop plan-only commits from choosing the record type and scope`.

#### Edge cases

- The exclusion is the literal, top-level `docs/plans` (`:(top,exclude,literal)`), so `docs/plans-old/` and `cli/docs/plans/` still count. A test asserts it.
- A breaking commit that touches only `docs/plans/` makes `breaking: true` and `semver: major`, while `type` comes from the remaining commits. This is the owner's decision ("semver y breaking siguen sobre todos"). A test asserts it.
- Existing `deriveFromCommits` tests call it with one argument and must stay green unchanged.
- The second `git log` must use the same safety arguments (`LOG_SAFETY_ARGS`, `--end-of-options`, `-z`, `--full-history`, `--no-merges`) and the same pinned `range` (same HEAD sha), so both lists describe one snapshot.
- Linear-scaling and hostile-subject tests (`expectLinearScaling`, `MAX_SUBJECT_UNITS`) must stay green. The second log doubles the git calls but not the per-commit cost.

#### Evidence

SRC-DERIVE, SRC-DESIGN, SRC-CLIREF. RED: CMD-DERIVE. GREEN: CMD-DERIVE, CMD-CHANGES, CMD-TYPECHECK. Distinct, clean specification and code-quality verdicts.

#### Fallback

Public-contract risk: `change validate` recomputes these fields (R4.3), so a branch whose record was created with the old CLI fails `derived-mismatch` after upgrading. The remedy is `awm change new <slug> --refresh`. Records already merged are never re-validated (R4.1). If a test shows otherwise, stop and amend the plan.
