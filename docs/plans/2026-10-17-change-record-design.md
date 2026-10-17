# Change Record per PR Design

**Issue:** [#217](https://github.com/Kodria/agentic-workflow/issues/217)

**Scope:** `agentic-workflow` CLI (`cli/`) plus two skills in `awm-baseline-registry` (`finishing-a-development-branch`, `writing-plans`). Related but out of scope: [#218](https://github.com/Kodria/agentic-workflow/issues/218) (canonical `.awm/` versioning policy).

**Approach:** One immutable, machine-readable Change Record per PR at `docs/changes/YYYY-MM-DD-<slug>.md`. Its deterministic fields are derived by the CLI from git and from a persisted sensor-run receipt. Its narrative fields are written by the agent. A local strict gate enforces it, and query-time derivation answers "what merged / released / is missing a record" without any post-merge writes, git hooks or host-specific CI (brainstorming 2026-10-16/17).

## Problem

Agentic PRs run in parallel and often unattended (`awm track`, overnight runs). The next day it is hard to recall what each PR did, what was actually verified, what still needs manual validation, and what risks remain. Today that information is spread across the plan, the local ledger and evidence, the PR body, the CHANGELOG and deploy logs. None of these is a short, structured summary that a voice, chat or mobile bot can query without reading code.

## Market research summary

- **Per-change fragment files in the repo** are the dominant pattern for "what changed": Changesets (`.changeset/*.md`, frontmatter plus summary), towncrier (`newsfragments/`), changie (`.changes/unreleased/*.yaml`), OpenStack reno (`releasenotes/notes/*.yaml`, with upgrade, known-issues and security sections) and Go `doc/next/*.md`. They exist to avoid merge conflicts on a single file. Their presence is enforced by a bot, a CI check or a test.
- **Explicit opt-out:** Kubernetes accepts a `NONE` release-note block. GitLab uses a `Changelog:` commit trailer.
- **Mandatory "what was tested":** Phabricator makes Test Plan a required field.
- **Risk and rollback:** ITSM change records (ServiceNow) carry implementation, backout and test plans plus risk and impact. No changelog tool covers these.
- **Agent provenance:** Copilot links commits to agent logs with an `Agent-Logs-Url` trailer. Agent Trace (RFC v0.1) leaves storage open.
- **Keep, don't consume:** ADR/MADR records (`docs/decisions/`) are kept forever with a status and an index, unlike Changesets and towncrier, which delete fragments on release.
- **Gap:** no tool combines a changelog fragment, an ITSM-style verification/risk record and agent provenance in one machine-readable artifact. That is what the Change Record fills.

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| DD-1 | The record is a versioned file in the project repo: `docs/changes/YYYY-MM-DD-<slug>.md`, one per PR. | It belongs to the project, not to git or AWM (user decision). A remote bot reads it through the host API without cloning. This matches the fragment pattern of the market. |
| DD-2 | The record is immutable after merge. `merged`, `merged_at`, `release` and the PR number are derived at query time. No `status`, `links.pr`, `links.release` or `links.deploy` fields exist. | No fragment tool rewrites files after merge. This avoids post-merge commits, CI write permissions and git hooks (AWM has none). |
| DD-3 | Hybrid, verified generation: the CLI derives `type/scope/semver/breaking/modules/verification`, and the agent writes the narrative. `validate` recomputes the derived fields and rejects any drift. | `verification` must come from evidence, not from the agent's claim. Studies show about half of agentic PRs that touch code under test add no tests. |
| DD-4 | The gate is local and host-agnostic (`awm change validate --strict` in the finishing skill). CI is optional and not installed by AWM. Bypasses are surfaced at query time as `missing`. | A per-repo CI job is host-specific and silently absent if not configured (user decision). |
| DD-5 | `verification` is bound to a persisted sensor-run receipt, keyed by commit and local (not versioned). | One sensor run instead of two (vs. re-running in validate), and no dependence on host CI. Option A from brainstorming. |
| DD-6 | Opt-out is the git trailer `Change-Record: none` on any commit of the change. | Git-native, so it works on any host. Same precedent as GitLab's `Changelog:` trailer. |
| DD-7 | No committed index file. `awm changes list` builds its view on demand from the base branch history. | A committed index would be touched by every PR and reintroduce the merge conflicts that fragments exist to avoid. |
| DD-8 | No published JSON Schema in this cycle. A hand-written TypeScript validator is the single source of truth, and `awm changes list --format json` is the machine contract. | Two sources of truth drift. This follows the existing `validateCycleEvidence` pattern. |
| DD-9 | No multi-repo aggregation in this cycle. The JSON output carries a `repo` field derived from `git remote`, so outputs from several repos can be concatenated. | YAGNI (user decision). This is the preparation step only. |
| DD-10 | `manual_validation` items have no `done` flag. | The record is immutable. Tracking completed manual validations is future work. |
| DD-11 | Skill changes cover only `finishing-a-development-branch` (generate, validate, PR body) and `writing-plans` (declare intent and acceptance criteria). | The user chose the minimal set. Retro, QA and docs stay unchanged. |

**Accepted risks:**
- A human PR that skips the skill is not blocked. It is reported as `missing` in `awm changes list`.
- The receipt is local, so `--strict` can only run where the sensors ran. The base (non-strict) mode is what an optional CI can run.

## Requirements

### R1 — Record format (`awm.change-record/v1`)

- **R1.1 — Location and name:** THE CLI SHALL treat as Change Records exactly the files matching `docs/changes/<YYYY-MM-DD>-<slug>.md`, where `<slug>` matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is at most 64 characters.
- **R1.2 — Frontmatter delimiting:** THE record SHALL start with a YAML frontmatter block delimited by `---` lines. THE CLI SHALL parse it with js-yaml's `CORE_SCHEMA` (a strict subset of the default safe schema: no custom tags, no implicit timestamps, no merge keys) and SHALL reject every YAML anchor and alias, including scalar and unused ones.
- **R1.3 — Allowed keys:** THE frontmatter SHALL contain only these keys: `schema`, `id`, `title`, `summary_short`, `type`, `scope`, `semver`, `breaking`, `modules`, `links`, `verification`, `manual_validation`, `risks`, `rollback`, `provenance`. IF any other key is present at any level, THEN `validate` SHALL fail with diagnostic `unknown-field` naming the field path.
- **R1.4 — Field rules:**
  - `schema` is exactly `awm.change-record/v1`.
  - `id` equals the file stem.
  - `title` is 1–120 characters.
  - `summary_short` is 1–280 characters, with no line breaks (`\r`, `\n`, U+0085, U+2028, U+2029).
  - `type` is a lowercase conventional-commit type.
  - `scope` is a non-empty string or `null`.
  - `semver` is one of `major | minor | patch | none`.
  - `breaking` is a boolean.
  - `modules` is a sorted, deduplicated array of repo-relative directory paths using `/`.
  - `links` is optional and may contain only `plan` (a safe repo-relative path; its existence as a regular file is verified whenever a repository root is available, as in `validate`, and not when records are read from history, as in `list`) and `issue` (an https URL).
  - `manual_validation` is either a non-empty array of `{step, expected}` objects with non-empty strings, or the object `{none: <non-empty reason>}`.
  - `risks` is an array of non-empty strings and may be empty.
  - `rollback` is a non-empty string.
  - `provenance` is optional and may contain only `agent`, `model`, `session`, `started_at` and `finished_at`, all non-empty strings. Timestamps are canonical ISO-8601, meaning exactly the form `Date.prototype.toISOString()` produces (UTC with milliseconds, e.g. `2026-10-17T10:00:00.000Z`).
- **R1.5 — Verification block:** `verification` SHALL contain:
  - `commit`: 40 lowercase hex characters;
  - `overall`: the receipt verdict;
  - `sensors`: a map from sensor name (a non-empty single-line string of at most 128 characters without control characters) to `pass | fail | inconclusive | skipped`;
  - `receipt_digest`: `sha256:<64 hex>`.
- **R1.6 — Body sections:** THE body SHALL contain the headings `## Qué se hizo`, `## Qué se probó`, `## Qué falta validar` and `## Riesgos y rollback`, in that order, each with non-empty content.
- **R1.7 — No placeholders:** IF the raw frontmatter text, any parsed string value (after YAML unescaping), or any body section contains the literal marker `<!-- awm:pending -->`, THEN `validate` SHALL fail with diagnostic `pending-content`.
- **R1.8 — Size bound:** IF a record file exceeds 64 KiB, THEN THE CLI SHALL reject it with diagnostic `record-too-large` without parsing it.

### R2 — Sensor-run receipt

- **R2.1 — When written:** WHEN `awm sensors run` completes with the default full selection (no `--fast`, `--slow` or `--changed`; `--all` is allowed) AND `git status --porcelain` (measured before the run) reports no changes, THE CLI SHALL write a receipt to `.awm/sensors/runs/<commit>.json` atomically with mode 0600.
- **R2.2 — No receipt on partial or dirty runs:** IF the selection is partial or the working tree is dirty or git is unavailable, THEN THE CLI SHALL NOT write a receipt. IF the selection was full, THE CLI SHALL print one stderr line stating why no receipt was written. THE sensor verdict and exit code SHALL be unchanged.
- **R2.3 — Content:** THE receipt SHALL contain:
  - `schema: 1`;
  - `commit`: the HEAD SHA at run start;
  - `ranAt`: canonical ISO;
  - `cliVersion`;
  - `overall`;
  - `sensors`: name → status, sorted by name;
  - `digest`: the sha256 of the canonical JSON of all other fields.
- **R2.4 — Stable output:** THE stdout JSON of `awm sensors run` SHALL keep its current shape. The receipt is a side effect only.
- **R2.5 — Tamper detection:** WHEN reading a receipt, THE CLI SHALL recompute the digest. IF it does not match, or if the file fails strict shape validation, THEN THE CLI SHALL treat the receipt as absent and SHALL report diagnostic `receipt-invalid`.

### R3 — `awm change new`

- **R3.1 — Derivation range:** WHEN invoked as `awm change new <slug> [--base <ref>] [--plan <path>] [--issue <url>] [--model <m>] [--session <s>]`, THE CLI SHALL resolve the base in this order: `--base`, then `refs/remotes/origin/HEAD`, then `main`, then `master`. It SHALL compute `merge-base(base, HEAD)` and derive the fields from the non-merge commits in `merge-base..HEAD`.
- **R3.2 — Unresolvable base:** IF no base can be resolved, THEN THE CLI SHALL exit 2 with diagnostic `base-unresolved` and remedy `pass --base <ref>`.
- **R3.3 — Commit-derived fields:** THE CLI SHALL derive `type`, `breaking` and `semver` with the release parser (`cli/src/release/core.ts`: `parseCommits`, `determineBump`):
  - `semver` is `major` if any commit is breaking, otherwise `minor` if any is `feat`, otherwise `patch` if any is `fix` or `perf`, otherwise `none`;
  - `type` is the type of the highest-impact commit, in the order breaking > feat > fix > perf > first commit;
  - `scope` is the most frequent non-null scope (ties broken alphabetically), or `null`.
- **R3.4 — Modules:** THE CLI SHALL set `modules` to the sorted, unique set of parent directories of the files in `git diff --name-only merge-base..HEAD`, excluding `docs/changes/`. Each path is truncated to at most 3 segments, and root-level files map to `.`.
- **R3.5 — No commits:** IF `merge-base..HEAD` contains no non-merge commit, THEN THE CLI SHALL exit 2 with diagnostic `no-commits`.
- **R3.6 — Receipt required:** IF no valid receipt exists for HEAD, or the working tree is dirty outside `docs/changes/`, THEN THE CLI SHALL exit 2 with diagnostic `receipt-missing` or `tree-dirty` and remedy `commit your work, then run awm sensors run`.
- **R3.7 — Verification copy:** THE CLI SHALL copy `commit`, `overall`, `sensors` and `digest` (as `receipt_digest`) from the receipt into `verification`.
- **R3.8 — Provenance:** THE CLI SHALL fill `provenance.agent` from the branch journal's `admissionContext.provider` and `started_at`/`finished_at` from the journal cycle when present. It SHALL take `model` and `session` only from flags, and SHALL omit any key without a source.
- **R3.9 — Skeleton:** THE CLI SHALL write narrative fields and body sections containing the `<!-- awm:pending -->` marker, and SHALL print the created path.
- **R3.10 — No overwrite:** IF the target file exists and `--refresh` is not given, THEN THE CLI SHALL exit 2 with diagnostic `record-exists`.
- **R3.11 — Refresh:** WHEN `--refresh` is given for an existing record, THE CLI SHALL recompute only `type`, `scope`, `semver`, `breaking`, `modules` and `verification`. It SHALL leave every other byte of the file unchanged, and SHALL fail with `record-invalid` if the existing frontmatter cannot be parsed.
- **R3.12 — Path safety:** THE CLI SHALL validate `<slug>` per R1.1 before building any path. IF the `docs/changes` path or the target is a symlink, THEN it SHALL refuse to write.

### R4 — `awm change validate`

- **R4.1 — Target selection:** WHEN called without a path, THE CLI SHALL validate every record added in `merge-base..HEAD` (resolving the base as in R3.1). WHEN called with a path, it SHALL validate that file only.
- **R4.2 — Missing record:** IF no record is added in the range AND no commit in the range has the trailer `Change-Record: none`, THEN `validate` SHALL fail with diagnostic `record-missing`. IF a trailer is present and no record is added, THEN it SHALL pass and report `exempt`.
- **R4.3 — Base mode:** THE base mode SHALL check:
  - R1 (shape);
  - that the recomputed R3.3/R3.4 fields equal the record (else `derived-mismatch`, naming each field);
  - that `verification.commit` is an ancestor of HEAD or equal to it (else `verification-commit-foreign`);
  - that `git diff --name-only <verification.commit> HEAD`, excluding `docs/changes/`, is empty (else `code-changed-after-verification`, listing up to 20 paths).
- **R4.4 — Strict mode:** WHEN `--strict` is given, THE CLI SHALL additionally require:
  - a valid receipt for `verification.commit` (else `receipt-missing` or `receipt-invalid`);
  - that the receipt's `digest`, `overall` and `sensors` equal the record (else `verification-mismatch`);
  - `overall: pass` (else `verification-not-passing`).
- **R4.5 — Output and exit:** THE CLI SHALL exit 0 when valid and 2 otherwise. It SHALL print a text report, or with `--json` a single JSON line `{state, records:[{path, state, diagnostics:[{code, message, field?}]}]}`. It SHALL cap diagnostics at 20 per record and pass every message through `terminalSafe`.
- **R4.6 — Read-only:** `validate` SHALL NOT write any file.

### R5 — `awm changes list`

- **R5.1 — Source:** THE CLI SHALL read the first-parent history of the base ref (resolved as in R3.1, default the local base branch tip). It SHALL read record contents from that ref with `git show`, never from the working tree.
- **R5.2 — Window:** `--since` SHALL accept `<n>h`, `<n>d` or an ISO date (default `24h`). IF the value is invalid, THEN THE CLI SHALL exit 2 with diagnostic `since-invalid`.
- **R5.3 — Classification:** For each first-parent commit in the window, THE CLI SHALL classify it as:
  - `recorded` if the commit adds a valid record;
  - `invalid-record` if it adds a record that fails base-shape validation (R1 only);
  - `exempt` if any commit of that change carries `Change-Record: none` (the commits of a change are the first-parent commit itself plus, for a merge commit, `<commit>^1..<commit>`; trailers are read via `git log --format=%(trailers:key=Change-Record,valueonly)`);
  - `missing` otherwise.
- **R5.4 — Adoption point:** THE CLI SHALL classify commits older than the first commit that ever added a file under `docs/changes/` as `pre-adoption` and SHALL omit them from output. IF no record ever existed, THEN it SHALL print a single line stating that the repo has not adopted Change Records and SHALL exit 0.
- **R5.5 — Derived fields:** For each entry, THE CLI SHALL derive:
  - `merged_at`: the commit date;
  - `pr`: from a trailing `(#<n>)` in the subject, else `null`;
  - `release`: the earliest-created tag that contains the commit, else `null`;
  - `repo`: `host/owner/name` parsed from `remote.origin.url` with credentials stripped, else `null`.
- **R5.6 — Formats:**
  - `text`: a human table.
  - `json`: one JSON document `{repo, base, since, changes:[…]}`. Each change has `classification`, the derived fields and, for `recorded`, the full frontmatter.
  - `voice`: one sentence per change, `"<repo-name>: <summary_short>. <type>, <verificado|sin verificar>, <n> validaciones manuales pendientes."`, followed by a closing count of `missing` and `invalid-record`.
- **R5.7 — Read-only and bounded:** `list` SHALL NOT write files. It SHALL resolve tags with one `git for-each-ref`/`git tag --contains` strategy per entry, bounded to 200 entries (with a truncation notice beyond that).

### R6 — Release script opt-out

- **R6.1:** WHEN `cli/src/release` creates the `chore(release): vX [skip ci]` commit, THE commit message SHALL include the trailer `Change-Record: none`.

### R7 — Skills (awm-baseline-registry)

- **R7.1 — writing-plans:** THE plan header SHALL declare the planned Change Record slug and the acceptance criteria that `manual_validation` will draw from. The skill SHALL state that `type/scope/semver` are derived and are not declared.
- **R7.2 — finishing-a-development-branch:** Before Option 1 (merge) and Option 2 (push/PR), THE skill SHALL instruct the agent to:
  1. commit;
  2. run `awm sensors run`;
  3. run `awm change new <slug>` (or `--refresh`);
  4. write every narrative field and section from the plan, QA results and diff;
  5. commit the record;
  6. run `awm change validate --strict`, and stop on a non-zero exit.
  
  Trivial changes MAY instead use the `Change-Record: none` trailer, with the reason stated in the commit body.
- **R7.3 — PR body:** For Option 2, THE skill SHALL build the PR body's Summary and Test Plan from the record's `summary_short`, `## Qué se hizo`, `## Qué se probó` and `manual_validation`, and SHALL link the record file.
- **R7.4 — Version gate:** THE changed skills SHALL declare the minimum CLI version that ships R2–R5. IF the commands are unavailable, THEN the skill SHALL state the limitation and continue without the record, never inventing it.

## Architecture

- **Core module:** `cli/src/core/changes/`, with pure, independently testable units:
  - `types.ts`: record and receipt types;
  - `parse.ts`: frontmatter split, safe YAML and size bound;
  - `validate-shape.ts`: R1;
  - `derive.ts`: R3.3/R3.4, reusing `release/core.ts`;
  - `git.ts`: thin `execFileSync` wrappers with no shell, `--` before paths, bounded timeouts;
  - `receipt.ts`: R2 read, write and digest;
  - `trailers.ts`;
  - `list.ts`: R5 classification and derivation;
  - `render.ts`: text, JSON and voice.
- **Commands:**
  - `cli/src/commands/change/index.ts` registers `change new` and `change validate`;
  - `cli/src/commands/changes/index.ts` registers `changes list`;
  - both use `register<X>Command(program, deps)` with injectable deps and `CommandResult`/`emit`.
- **Sensors hook:** `cli/src/commands/sensors/index.ts`, in the `run` action, calls `writeReceiptIfEligible` after `runSensors`. `runSensors` itself stays untouched, so admission and read-only paths are unaffected.

## NFRs

- **Security:**
  - safe YAML schema;
  - slug grammar before path joins;
  - refuse symlinked targets;
  - credentials stripped from remote URLs in all output;
  - `provenance.session` documented as optional, with a warning for public repos;
  - all output through `terminalSafe`.
- **Portability:** git invoked without a shell; paths normalized to `/`; tests pass on ubuntu, windows and macos (D-005).
- **Isolation:** tests use tmp git repos with `HOME` and `AWM_HOME` overridden and never touch the real `~/.awm`.
- **Performance:** `list` makes a bounded number of git calls (one log, one `show` per record, one tag lookup per entry), and the receipt write is a single atomic file.

## Out of scope

- multi-repo feed;
- deploy tracking;
- CDEvents/CloudEvents emission;
- tracking of completed manual validations;
- CHANGELOG generation from records;
- published JSON Schema;
- harness-retro consumption of records;
- AWM-installed CI;
- `.awm/` versioning policy (#218).

## Verification note

This document is a design artifact with no executable behavior. Per development-process, it needs only proportional structural verification. The implementation it specifies keeps the normal quality gates.
