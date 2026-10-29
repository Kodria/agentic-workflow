# Design: Upgrade simple-git to 4.x (#238)

**Status:** approved 2026-10-29 (owner)  
**Issue:** https://github.com/Kodria/agentic-workflow/issues/238  
**CLI baseline:** 9.22.0

## Goal

Publish a CLI release whose production dependency tree no longer ships `simple-git` 3.36.0 (or vulnerable `@simple-git/argv-parser` &lt; 2.0.1), so container images that `npm install -g agentic-workflow-manager` clear the Amazon Inspector critical findings named in #238.

## Owner decisions (locked)

| Fork | Choice |
|------|--------|
| Approach | **A — solo bump** (no `execGit` migration) |
| Target | Pin exact `simple-git@4.0.2` |
| Ambient `GIT_*` / `GIT_SSH_COMMAND` | Accept simple-git 4 defaults (silent strip); document in Change Record; no `allowEnvironment` factory |
| Release train | Conventional `fix:` → automatic patch publish on merge to `main` |

## Scope

**In**

- `cli/package.json` / `cli/package-lock.json` pin to `4.0.2`
- Named imports in the three call sites that already use `simple-git`
- Existing Jest coverage for registry sync / add / versioning
- Change Record + PR closing #238

**Out**

- Opt-in `allowEnvironment` / `allowUnsafeSshCommand` factory
- Migrating registry git ops onto `execGit` / `git-env.ts`
- Remediating unrelated `npm audit` findings (jest → handlebars, undici, etc.)

## Current surface

| File | Calls |
|------|--------|
| `cli/src/core/registries.ts` | `clone`, `reset(['--hard'])`, `checkout`, `pull` |
| `cli/src/commands/registry/add.ts` | `clone` |
| `cli/src/core/versioning.ts` | `raw([...])`, `tags()` |

v3 default import → v4 named `simpleGit`. No abbreviated long-form git options and no `.env()` usage at these sites.

## Architecture

Keep the existing call sites. Change only the dependency pin and import style so TypeScript resolves `simpleGit` under v4. Runtime behavior for HTTPS remotes and default-SSH (agent / `~/.ssh/config`) stays on simple-git’s built-in child-process path. Ambient guarded env vars (`GIT_*`, etc.) are stripped by the library; this design does not re-inject them.

## Requirements (EARS)

- **SG-1:** WHEN the CLI declares its runtime dependency on `simple-git`, THE package SHALL pin exactly `4.0.2`.
- **SG-2:** WHEN TypeScript sources import the library, THE modules SHALL use the named `simpleGit` export (and `SimpleGit` as a type-only import where needed); they SHALL NOT use a default import.
- **SG-3:** IF ambient `GIT_SSH_COMMAND` or other guarded `GIT_*` variables are set in the parent process, THEN registry git operations SHALL follow simple-git 4 defaults (ambient strip, no project opt-in in this change), and THE Change Record SHALL state that limitation.
- **SG-4:** WHEN the existing registry sync, registry add, and versioning Jest suites run against the upgraded dependency, THE observable outcomes for local/`file://` and HTTPS-style fixtures SHALL remain passing.

## Verification

- Targeted Jest: `registries-sync`, `registry/add`, `versioning`, related update/sync-gates suites that exercise clone/sync.
- After install: `npm ls simple-git` reports `4.0.2`; `@simple-git/argv-parser` ≥ `2.0.1`.
- `npm audit` (or advisory check) no longer reports CVE-2026-102826 / 102827 / 102828 / 102829 against the production tree.

## Self-review

1. Placeholders: none.
2. Consistency: A / 4.0.2 / no env factory aligned across decisions and requirements.
3. Scope: single dependency upgrade train.
4. Ambiguity: SSH via `~/.ssh/config` / agent explicit non-break; only ambient `GIT_SSH_COMMAND` is the accepted behavioral delta.
5. EARS: SG-1…SG-4 stable IDs, each testable.
