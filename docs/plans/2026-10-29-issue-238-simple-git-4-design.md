# Design: Upgrade simple-git to 4.x (#238)

**Status:** amended 2026-10-29 (owner) after design/plan audit on PR #239  
**Issue:** https://github.com/Kodria/agentic-workflow/issues/238  
**CLI baseline:** 9.22.0  
**Audit:** owner review on #239 (P1–P4) — premise “only `GIT_SSH_COMMAND` is stripped” was wrong; adopt **P3** (CLI knows its limits; never fails silently).

## Goal

Publish a CLI release whose production dependency tree pins `simple-git@4.0.2` (clearing CVE-2026-102826/102827/102828/102829), while registry network git ops stay **non-interactive**, **bounded**, and **honest** about ignored ambient `GIT_*` and sync failures.

## Owner decisions (locked)

| Fork | Choice |
|------|--------|
| Approach | **A + P3** — keep `simple-git` (no `execGit` migration); add a single registry-git factory |
| Target | Pin exact `simple-git@4.0.2` |
| Ambient `GIT_*` | Strip all guarded names; allow **only** `GIT_TERMINAL_PROMPT=0` via `allowEnvironment: ['GIT_TERMINAL_PROMPT']` |
| Failure UX | Never hang on a credential prompt; classify errors with git-config remedies; no silent stale cache on `add`/`list` |
| Release train | Conventional `fix:` → automatic patch publish on merge to `main` |

## Scope

**In**

- Pin + lockfile to `4.0.2`
- Named `simpleGit` imports only through a new factory module
- Non-interactive env + timeout for every registry network git child
- One-shot warning naming ignored ambient `GIT_*` (never values)
- Classified sync/clone errors with remedies expressed as git config / `~/.ssh/config`
- Honest messaging when `awm add` / `awm list` continue on cached content after a sync error
- Non-zero exit when sync fails in `init` / `update` / `sync` / `registry add`
- Change Record + PR closing #238

**Out**

- Passing through `GIT_ASKPASS`, `GIT_SSL_CAINFO`, `GIT_SSH_COMMAND`, `GIT_CONFIG_*`, or any other guarded name
- Migrating registry ops onto `execGit` / `git-env.ts`
- Remediating unrelated `npm audit` findings (jest → handlebars, undici, etc.)

## Current surface

### Call sites (`simple-git`)

| File | Calls |
|------|--------|
| `cli/src/core/registries.ts` | `clone`, `reset(['--hard'])`, `checkout`, `pull` (via `syncRegistries`) |
| `cli/src/commands/registry/add.ts` | `clone` (via `addRegistry`) |
| `cli/src/core/versioning.ts` | `raw([...])`, `tags()` (via `resolveTargetRef` / `currentVersion`) |

### Commands that reach those call sites

| Command | Network ops | Today if sync errors but disk still usable |
|---------|-------------|--------------------------------------------|
| `awm registry add <remote>` | `clone` | command error (clone path) |
| `awm init` | `clone`, `fetch --tags`, … | per-registry results; usable-disk gate |
| `awm update` / `awm sync` | `reset`, `fetch`, `checkout`, `pull` | warn + may continue if layout still usable |
| `awm add` (`cli/src/index.ts` ~L136) | sync-all before install | warn + continue if usable (**audit called this “install”**) |
| `awm list` (`cli/src/index.ts` ~L503) | sync-all before list | warn + continue if usable |

**Not in scope:** `execGit` / `git-env.ts` consumers (Change Record, evidence, admission) — they never load `simple-git`.

v3 default import → v4 named `simpleGit`. No abbreviated long-form options at these sites.

## Architecture

1. **Pin** `simple-git@4.0.2` (pulls `@simple-git/argv-parser@2.0.1+`).
2. **Factory** `cli/src/core/registry-git.ts` — the only module that imports `simple-git`:
   - `allowEnvironment: ['GIT_TERMINAL_PROMPT']` only (no `allowUnsafe*`)
   - `timeout: { block: 60000 }`
   - `.env(guardedEnv)` where `guardedEnv` is a **copy** of `process.env` with every key matching `/^git_/i` removed, then `GIT_TERMINAL_PROMPT: '0'` set
   - **Do not** spread `process.env` into `.env()` (throws on ambient `GIT_ASKPASS`)
   - **Do not** call `.env('GIT_TERMINAL_PROMPT', '0')` alone (replaces the whole env and drops `PATH`/`HOME`)
3. **Call sites** use `createRegistryGit(baseDir?)` instead of `simpleGit(...)`.
4. **Ignored-env notice (once per process command):** before the first network registry git op, if other ambient `GIT_*` names exist, print their **names** only + point at the remedy table.
5. **Error classification:** map failures to auth / TLS / network / SSH / not-found / timeout; include registry name, remote, class, last `fatal:` line, and a file-based remedy.
6. **Exit policy:** `init` / `update` / `sync` / `registry add` → non-zero on sync/clone failure with classified message. `add` / `list` may continue on still-usable cache **only if** they state the cached version in use plus the classified cause/remedy.

### Remedy table (operators / Change Record)

| Ambient var (ignored) | Working equivalent |
|-----------------------|--------------------|
| `GIT_SSL_CAINFO` / `GIT_SSL_CAPATH` | `git config --global http.sslCAInfo <path>` / `http.sslCAPath` |
| `GIT_ASKPASS` | `credential.helper` |
| `GIT_CONFIG_COUNT` / `KEY_n` / `VALUE_n` | `git config --global <key> <value>` |
| `GIT_SSH_COMMAND` | `core.sshCommand` or `~/.ssh/config` |
| `GIT_TERMINAL_PROMPT` | forced to `0` by the factory (SG-3) |

## Requirements (EARS)

- **SG-1:** WHEN the CLI declares its runtime dependency on `simple-git`, THE package SHALL pin exactly `4.0.2`.
- **SG-2:** WHEN TypeScript sources need a registry git client, THE modules SHALL obtain it only via `createRegistryGit` in `cli/src/core/registry-git.ts`, which SHALL import the named `simpleGit` export (no default import anywhere under `cli/src/`).
- **SG-3:** WHEN awm runs a registry git operation through `simple-git`, THE factory SHALL set `GIT_TERMINAL_PROMPT=0` for the child via `allowEnvironment: ['GIT_TERMINAL_PROMPT']` only, SHALL apply `timeout: { block: 60000 }`, and SHALL NOT enable any `allowUnsafe*` flag or admit any other guarded `GIT_*` name.
- **SG-4:** WHEN the existing registry sync, registry add, and versioning Jest suites run against the upgraded dependency and factory, THE observable outcomes for local/`file://` fixtures SHALL remain passing for successful paths.
- **SG-5:** IF the parent environment contains guarded `GIT_*` names other than `GIT_TERMINAL_PROMPT`, THEN before the first network registry git operation of that command THE CLI SHALL emit a single notice listing those **names** (never values) and pointing to the remedy table.
- **SG-6:** WHEN a network registry git operation fails, THE CLI SHALL classify the failure (authentication, TLS/certificate, network/proxy, SSH host/key, repository not found, timeout), and SHALL report registry name, remote, class, git’s last `fatal:` line, and a file-based remedy from the table above.
- **SG-7:** IF registry sync fails during `awm add` or `awm list` and the command continues because cached content is still usable, THEN THE CLI SHALL state the cached version in use plus the SG-6 cause and remedy. WHEN sync/clone fails during `awm init`, `awm update`, `awm sync`, or `awm registry add`, THE command SHALL exit non-zero with the SG-6 message.

## Verification

- Structural: pin `4.0.2`; no `simpleGit(` / `from 'simple-git'` outside `registry-git.ts`; factory allow-list exact.
- Behavior: missing/private remote fails fast with prompts disabled; ambient `GIT_SSL_CAINFO` triggers SG-5 name-only notice; `add`/`list` announce cache on soft sync failure; `update`/`sync`/`registry add`/`init` exit ≠ 0 on sync failure.
- Suites: `registries-sync`, `registry/add`, `versioning`, plus new factory/classifier tests.
- Lockfile: `simple-git@4.0.2`, `@simple-git/argv-parser` ≥ `2.0.1`; production tree clear of the four CVEs.

## Self-review

1. Placeholders: none.
2. Consistency: A+P3 / factory / SG-3 & SG-5…SG-7 aligned with audit P1–P4.
3. Scope: dependency bump plus honest registry-git boundary; no `execGit` migration.
4. Ambiguity: `awm add` (not a separate `install` command) is the sync-before-activate path; file-based git config still honored by simple-git 4.
5. EARS: SG-1…SG-7 stable IDs, each testable.
