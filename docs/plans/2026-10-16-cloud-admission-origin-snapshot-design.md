# Cloud Admission: Rewritten Origin and Read-Only Snapshot Exclusions Design

**Issue:** [#215](https://github.com/Kodria/agentic-workflow/issues/215)

**Scope:** `agentic-workflow` CLI only (`cli/`). No registry content changes.

**Approach:** (A) read the registry origin from the literal `remote.origin.url` config value instead of the `insteadOf`-rewritten `git remote get-url`; (B) let the read-only admission snapshot skip git-ignored, untracked directories, using AWM defaults plus an optional project file `.awm/admission.json` (brainstorming 2026-10-16). One PR, two independent tasks.

## Problem

In Cursor Cloud Agents, `awm plan admit --provider … --require-current --verify-sensors` blocks on real projects even when the plan is valid, `awm sensors run --all` certifies, and the CLI and baseline registry are current.

- **A.** Cloud injects `url."https://x-access-token:…@github.com/".insteadOf "https://github.com/"` into the global git config. This is AWM's own official cloud recipe (D-7, `2026-06-21-portability-and-cloud-bootstrap-design.md`). `git remote get-url origin` applies the rewrite and returns the credential-bearing URL, while the registry `.git/config` holds the clean URL. `registryComponent` (`cli/src/core/currentness/check.ts`) compares exactly against `registry.remote`, so `registry:<name>` becomes `unverifiable`. Reproduced on 2026-10-16: `get-url` returns `https://x-access-token:SECRET@github.com/…`, `git config --get remote.origin.url` returns `https://github.com/…`.
- **B.** Admission calls `runSensors({ cwd, all: true, readOnly: true })`. `filesystemSnapshot` (`cli/src/commands/sensors/run.ts`) hashes the whole project tree except the root `.git`, bounded by 250 000 entries and 1 GiB. A Node monorepo exceeds 1 GiB mostly through `node_modules`, the snapshot returns `null`, and admission reports `not_certified` / `read-only-observation-unavailable` with the misleading remedy "run admission from a readable git worktree".

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| DD-1 | Read `remote.origin.url` with `git config --get` and keep exact equality. | Fixes the rewrite without loosening the comparison; normalization (host+path) was rejected as more permissive than needed. A token persisted in `.git/config` keeps failing (G-3 anti-pattern). |
| DD-2 | Only git-ignored directories that contain no tracked file can be excluded; `.git` and `.awm` never. | The snapshot's purpose is detecting sensor mutation. Restricting exclusions to ignored, untracked output keeps source, `.gitignore`, and AWM evidence observed. |
| DD-3 | AWM defaults apply implicitly when no file is declared. | Large Node projects work without repo changes; safe because of DD-2. |
| DD-4 | Declaration lives in a new optional file `.awm/admission.json`, not in `.awm/sensors.json`. | The sensors manifest parser rejects unknown fields; a new field would make older CLIs treat the whole manifest as malformed. Older CLIs ignore the new file and behave as today. |
| DD-5 | Tests stay light: injectable snapshot limits, tiny fixtures, git mocked except 2–3 real-git integration tests. | The suite is already heavy; overflow is provoked with a 1 KB test limit, never real volume. |

**Accepted risk:** a sensor that mutates content inside an excluded (ignored, untracked) directory is not detected by admission. Mutations to tracked files, `.gitignore`, or `.awm` are still detected.

## Requirements

### A — Registry origin under `insteadOf`

- **A-R1 — Rewrite-transparent origin:** WHEN the global git config contains a `url.<base>.insteadOf` rewrite AND the registry checkout's `remote.origin.url` equals the configured `registry.remote`, THE CLI SHALL evaluate `registry:<name>` currentness (`current` / `behind` / other existing states) exactly as without the rewrite.
- **A-R2 — Real mismatch still fails:** IF the registry checkout's `remote.origin.url` differs from `registry.remote` (different host, path, scheme, SSH userinfo, or a credential persisted in `.git/config`), THEN THE CLI SHALL report `registry:<name>` as `unverifiable` with the existing origin-mismatch detail and remedy.
- **A-R3 — Missing origin:** IF `git config --get remote.origin.url` fails or returns no value, THEN THE CLI SHALL report `unverifiable` with detail "Could not read local registry origin."
- **A-R4 — No credential in diagnostics:** IF the origin or remote value contains HTTPS userinfo, THEN THE CLI SHALL NOT include the userinfo or token in any currentness detail, remedy, or JSON output.
- **A-R5 — Authenticated tag query preserved:** WHEN querying remote tags, THE CLI SHALL keep running `git ls-remote --tags <registry.remote>` so the environment's `insteadOf` rewrite still authenticates the query.

### B1 — `.awm/admission.json` contract

- **B-R1 — Optional file:** WHERE `<projectRoot>/.awm/admission.json` is absent, THE CLI SHALL behave as if it declared `{ "schemaVersion": 1, "readOnlyObservation": { "defaults": true, "exclude": [] } }`.
- **B-R2 — Shape:** WHEN the file is present, THE CLI SHALL accept only `schemaVersion` (exactly `1`) and an optional `readOnlyObservation` object with optional `defaults` (boolean, default `true`) and optional `exclude` (array of strings, default `[]`).
- **B-R3 — Invalid file fails closed:** IF the file is not valid JSON, has `schemaVersion !== 1`, has an unknown field at any level, or has a field of the wrong type, THEN `runSensors({ readOnly: true })` SHALL return `overall: "not_certified"`, `reason: "admission-config-invalid"`, and a remedy naming `.awm/admission.json` and the offending field.
- **B-R4 — Entry grammar:** IF an `exclude` entry is empty, absolute (leading `/` or a drive letter), contains an empty, `.` or `..` segment, contains `\`, `*`, `?`, `[`, NUL, or a line break, or ends with `/`, THEN THE CLI SHALL apply B-R3.
- **B-R5 — Reserved paths:** IF an `exclude` entry is `.git` or `.awm` or starts with `.git/` or `.awm/`, THEN THE CLI SHALL apply B-R3.
- **B-R6 — Matching:** WHEN an entry contains no `/`, THE CLI SHALL match it against the name of any directory at any depth; WHEN it contains `/`, THE CLI SHALL match it against the exact directory path relative to `projectRoot`, using `/` as separator on every platform.
- **B-R7 — Defaults list:** WHILE `defaults` is `true`, THE CLI SHALL add the name rules `node_modules`, `.next`, `.turbo`, `dist`, `build`, `coverage`, `.venv`, `target` to the declared `exclude` entries.
- **B-R8 — Non-admission runs unaffected:** WHEN `runSensors` runs without `readOnly`, THE CLI SHALL NOT read or validate `.awm/admission.json`.

### B2 — Snapshot algorithm and evidence

- **B-R9 — Verified exclusion:** WHEN the snapshot walk reaches a directory (not a symlink) that matches a rule, AND `git ls-files -z -- <rel>` run from `projectRoot` returns no path, AND `git check-ignore -q -- <rel>` exits `0`, THE CLI SHALL skip the directory entirely: neither its stat line nor its contents enter the digest, so a sensor creating, filling, or deleting such a directory leaves the digest unchanged. Every observed directory entry SHALL be hashed by path and mode only, without its size, because a directory's size changes when entries (including excluded ones) are added and its contents are already hashed through its children.
- **B-R10 — Unverifiable candidate is observed:** IF a matching directory contains at least one tracked file (including force-added files), THEN THE CLI SHALL hash it as today and record it in `rejected` with reason `contains-tracked`; IF it contains no tracked file but is not ignored, THEN THE CLI SHALL hash it and record reason `not-ignored`. The tracked check runs first because `git check-ignore` already reports a directory holding a force-added file as not ignored (verified 2026-10-16).
- **B-R11 — No git means no exclusions:** IF git is unavailable or `projectRoot` is not inside a git worktree, THEN THE CLI SHALL apply no exclusion, SHALL hash the full tree as today, and SHALL record matching directories in `rejected` with reason `git-unavailable`.
- **B-R12 — Symmetric passes:** WHEN computing the before and after snapshots, THE CLI SHALL apply the same rule function to both passes and SHALL reuse cached verification results for paths already verified, so a matching ignored directory created by a sensor is excluded under the same rules.
- **B-R13 — Git invocation safety:** WHEN verifying candidates, THE CLI SHALL invoke git without a shell, with `--` before the path argument, with `cwd` set to `projectRoot`, and with a bounded timeout; IF a verification call fails or times out, THEN THE CLI SHALL treat that candidate as `git-unavailable` per B-R10/B-R11 (hash it), except that output overflow of `git ls-files` (bounded output) SHALL be classified `contains-tracked`, because output beyond the bound proves at least one tracked path exists; either way the directory is hashed.
- **B-R14 — Limits unchanged:** WHEN walking, THE CLI SHALL keep the 250 000-entry and 1 GiB limits, counting only observed (non-excluded) entries and bytes.
- **B-R15 — Evidence:** WHEN `readOnly` is active, the configuration is valid, and the run either reaches sensor execution or fails the before-snapshot, THE CLI SHALL include in the `runSensors` output `readOnlyObservation: { defaults: boolean, excluded: string[], rejected: { path: string, reason: "not-ignored" | "contains-tracked" | "git-unavailable" }[] }`, with paths relative to `projectRoot`, `/`-separated, sorted, and deduplicated across both passes.
- **B-R16 — Actionable limit remedy:** IF the snapshot fails because a limit is exceeded, THEN THE CLI SHALL return `reason: "read-only-observation-unavailable"` with a remedy that names the exceeded limit and points to git-ignoring heavy directories or declaring them in `.awm/admission.json`; IF it fails for any other reason (unreadable entry), THEN the remedy SHALL keep pointing to a readable worktree.
- **B-R17 — Admission diagnostic carries the cause:** WHEN `awm plan admit --verify-sensors` blocks because the sensor verdict is `not-certified`, THE `ADMISSION_SENSORS_BLOCKED` diagnostic message SHALL include the sensor run's `reason` and `remedy`; THE admission report schema SHALL NOT change.

### Verification and documentation

- **V-R1 — Isolation:** WHEN any test runs, IT SHALL use a temporary directory with `HOME`, `AWM_HOME`, and (for git) `GIT_CONFIG_GLOBAL` overridden and SHALL NOT touch the real `~/.awm`.
- **V-R2 — Light tests:** WHEN testing limit overflow, THE tests SHALL inject small snapshot limits (test-only seam) with fixtures of a few small files, and SHALL NOT create large trees.
- **V-R3 — Real-git integration:** THE test suite SHALL include real-git integration tests for (a) A-R1 with a global `insteadOf` rewrite that points at a local bare repository (offline; `get-url` then differs from the configured remote exactly as with the Cloud token), complemented by a unit test whose rewritten URL carries `x-access-token` userinfo and (b) B-R9/B-R10 with an ignored `node_modules`, an un-ignored one, and an ignored one containing a force-added file.
- **V-R4 — Docs:** WHEN the change ships, `docs/cli-reference.md` (`awm plan admit`, `--verify-sensors`), `docs/configuration.md` (new `.awm/admission.json` section including the accepted risk), `docs/operations/cloud-and-platforms.md` (the `insteadOf` recipe works with `--require-current`; no `GIT_CONFIG_GLOBAL` workaround), and the `plan admit` help text SHALL describe the new behavior.

**Delivery note (process step, not a testable requirement):** the PR title and squash-merge commit use `feat(admission): Cloud insteadOf origin + read-only snapshot exclusions (#215)`, so the generated changelog records a minor feature.

## Design

### A — `cli/src/core/currentness/check.ts`

Replace the origin read in `registryComponent`:

```ts
// before
git(registry.contentRoot, ['remote', 'get-url', 'origin'], …)
// after — literal config value; `remote get-url` applies url.*.insteadOf
git(registry.contentRoot, ['config', '--get', 'remote.origin.url'], …)
```

Everything else (exact equality, `sanitizeSource`, `sshUserInfoLabel`, `ls-remote` against `registry.remote`) is unchanged. `git remote get-url` has no option to skip rewrites; `git config --get` returns the stored value on every supported git version and platform.

### B — new module `cli/src/commands/sensors/read-only-observation.ts`

Single-purpose unit, consumed by `run.ts`:

- `loadAdmissionConfig(projectRoot): { ok: true, rules: Rule[], defaults: boolean } | { ok: false, field: string, message: string }` — reads and strictly validates `.awm/admission.json` (B-R1–B-R7), following the `fields()` / `invalid()` style of `compatibility/manifest.ts`.
- `createExclusionPolicy(projectRoot, rules, verifier)` — returns `isExcluded(rel): boolean` with a per-path cache (B-R12) and accumulates `excluded` / `rejected` evidence (B-R15).
- `gitVerifier(projectRoot)` — default verifier running `git ls-files -z -- <rel>` then `git check-ignore -q -- <rel>` via `spawnSync` without a shell, with a timeout (B-R9, B-R13). Tests inject a fake verifier.

`filesystemSnapshot(root, options)` gains an optional exclusion policy and test-only limits (`maxEntries`, `maxBytes`, defaulting to the current constants). On a matching directory it asks the policy; excluded directories contribute nothing to the digest, and observed directories are hashed without their size. It returns either the digest or a typed failure (`limit-entries` | `limit-bytes` | `unreadable`) so B-R16 can build the right remedy.

`runSensors` with `readOnly`: load config (fail per B-R3) → build one policy → before snapshot → run → after snapshot with the same policy → attach `readOnlyObservation` evidence to the output.

### Admission — `cli/src/core/admission/index.ts`

`ADMISSION_SENSORS_BLOCKED` message becomes `Sensor verdict is not-certified (<reason>): <remedy>.` when the run output carries them; otherwise unchanged (B-R17). No report-schema field is added.

## Out of scope

- Glob patterns in `exclude`; per-provider exclusion profiles.
- Normalizing HTTPS/SSH/SCP remote forms as equivalent.
- Changing the snapshot limits or the `.awm/sensors.json` schema.
- Using exclusions outside admission (`sensors run` without `readOnly`).

## Verification

Executable behavior changes: full gates apply (unit + integration tests, lint, typecheck, CI on ubuntu/windows/macos per D-005).
