# OS acceptance matrix

Only the **deltas per operating system**. Run [core-acceptance.md](core-acceptance.md) first — it must pass identically everywhere.

| OS | Continuous verification |
|---|---|
| Linux | Full suite on `ubuntu-latest`, every PR and every push to `main` |
| Windows (native) | Full suite on `windows-latest`, every PR and every push to `main` |
| macOS | Full suite on `macos-latest`, every PR and every push to `main`; the manual playbook additionally exercises real agent binaries. |
| WSL | Reports as Linux; covered by the Linux path |

The macOS CI suite proves the CLI on the platform; the manual playbook remains necessary because CI does not exercise a user's real agent binary or configuration.

## Sensor-pack certification evidence

For every first-party pack, record one real-tool boundary run on Linux, macOS,
and native Windows: minimum supported version, current version, and a
representative future version. Include native config and package-manager
fixtures where the pack supports both. The expected future-version result is an
explicit compatibility state, never a fallback to PATH or an assumed pass.

Windows-specific certification must run the local `.cmd` or environment shim;
macOS and Linux must demonstrate the same structured command without a shell.
This supplements the CI suite—it is not permission to describe an unrecorded
combination as verified.

---

## Linux

**LNX-01 · Symlinks work unprivileged**
```bash
awm add dev --scope global --method symlink --agent claude-code --yes
ls -la ~/.claude/skills/development-process
```
**Expect:** a symlink into `$AWM_HOME/registries/baseline/skills/`.

**LNX-02 · File modes are restrictive where they should be**
```bash
stat -c '%a' "$AWM_HOME/config.json" 2>/dev/null
```
**Expect:** owner-only for anything that could hold a token (`600`). World-readable secrets are a **FAIL**.

**LNX-03 · No `~/.awm` writes when `AWM_HOME` is set** — see CORE-20.

---

## macOS

Everything in the Linux section applies (`stat -f '%A'` instead of `stat -c '%a'`), plus:

**MAC-01 · Works under both shells**
Run CORE-03 in `zsh` (default) and again in `bash`.
**Expect:** identical results. Shell detection must not change the outcome.

**MAC-02 · Apple Silicon and Intel**
Note `uname -m` (`arm64` / `x86_64`) with your results. Node's install path differs (`/opt/homebrew` vs `/usr/local`); AWM must not care.

**MAC-03 · Gatekeeper does not block the sensors**
```bash
awm sensors run
```
**Expect:** no "cannot be opened because the developer cannot be verified" dialog. If a sensor's binary is quarantined, that's an environment note, not an AWM bug — but record it, since a teammate will hit it too.

**MAC-04 · Case-insensitive filesystem**
```bash
awm add dev --scope local --agent claude-code --yes
ls .claude/skills/
```
**Expect:** exactly one entry. Two entries differing only in case would mean AWM is relying on case-sensitivity — a **FAIL** on the default macOS filesystem.

---

## Windows (native)

This is the section with real differences. Run in **PowerShell**.

```powershell
$env:AWM_HOME = "$HOME\.awm-e2e"
```

**WIN-01 · Symlink creation, or an honest fallback**
```powershell
awm add dev --scope global --method symlink --agent claude-code --yes
Get-Item ~\.claude\skills\development-process | Select-Object LinkType, Target
```
For a **directory** artifact (a skill), `--method symlink` deliberately installs an NTFS
**Junction**, not a `SymbolicLink` — a privilege-free directory reparse point that needs no
Developer Mode and that Node/libuv report through the same `isSymbolicLink()`/`readlinkSync()`
surface every downstream consumer already relies on (see `executor.ts`'s `stageArtifact`).
Developer Mode only matters for **file**-type artifacts (agent `.md`, workflow `.md`), where no
privilege-free equivalent exists.

**Expect one of two acceptable outcomes:**
- A directory artifact → `LinkType: Junction`, regardless of Developer Mode. Treat a real
  `SymbolicLink` here as equally acceptable if Developer Mode happens to be on, but do not
  require it — junction is the intended, primary outcome.
- A file artifact with Developer Mode off → a `SymbolicLink` attempt that falls back to a
  plain copy (no privilege-free equivalent), **or** a clear error naming the requirement.

**FAIL** if it half-succeeds: a zero-byte file, a broken link, or a silent no-op that `awm doctor` then reports as healthy.

**WIN-02 · Copy method always works**
```powershell
awm add dev --scope local --method copy --agent claude-code --yes
```
**Expect:** exit `0` and a real directory with content. This is the guaranteed path on Windows.

**WIN-03 · Paths with spaces**
```powershell
$WORK = "$env:TEMP\awm e2e con espacios"
New-Item -ItemType Directory -Path $WORK -Force; Set-Location $WORK
git init -q -b main .; git commit -q --allow-empty -m init
awm init --yes --json > init.json
```
**Expect:** `failed: 0`. Historically the richest source of Windows bugs — quoting, argument splitting, and `cmd.exe` metacharacter handling all surface here.

**WIN-04 · Sensors resolve their binaries on PATH**
```powershell
npm init -y; npm i -D typescript
awm sensors init; awm sensors run
```
**Expect:** the typecheck sensor **runs** (pass or fail), not `skipped: not found`. Resolving `.cmd`/`.ps1` shims on Windows was a real published bug (v3.9.0); this is its regression check.

**WIN-05 · Line endings don't corrupt managed files**
```powershell
awm init --yes; Get-Content AGENTS.md -Raw | Format-Hex | Select-Object -First 4
```
**Expect:** AWM's managed block is intact and the file isn't mangled into mixed `\r\n`/`\n` inside a single block.

> **Precondition gap (not Windows-specific — reproduces identically on macOS/Linux):**
> a bare `awm init --yes` defaults to the `claude-code` target, whose `project.context` step
> stays `pending` (gated on a `project-context-init` skill session) — it never writes
> `AGENTS.md` on its own. As written, this check has no file to inspect. Either target an
> agent whose context step materializes directly (`awm init -a codex --yes` did, in one live
> run — see result sheet), or run a skill session first to produce `AGENTS.md`, then re-run
> this check against it.

**WIN-06 · `awm watch` — the known gap**
```powershell
awm watch --init
```
**Expect:** the command runs. **Known limitation:** the supervisor's *crash-recovery* path (spawn → identity capture → adoption after the supervisor is killed) has not converged on Windows CI, and its end-to-end tests are POSIX-scoped. If you exercise crash-recovery and it misbehaves, that is the **documented** gap ([`cli/src/core/journal/process.ts`](../../cli/src/core/journal/process.ts)) — record it as **KNOWN-GAP**, not a new bug. Everything else in `awm watch` should behave.

---

## WSL

**WSL-01 · Reports as Linux**
```bash
awm doctor --json | grep -i platform
```
**Expect:** Linux. WSL is deliberately *not* treated as native Windows.

**WSL-02 · Stay on the Linux filesystem**
Run the suite from `~` inside the distro, **not** from `/mnt/c/...`.
**Expect:** pass. Running from `/mnt/c` is unsupported for symlink and permission semantics — if you must, record it separately and expect symlink checks to differ.

---

## Result sheet

| ID | Result | Notes |
|----|--------|-------|
| LNX-01 · 02 · 03 |  |  |
| MAC-01 · 02 · 03 · 04 | PASS | 2026-08-10 — macOS 15.6, arm64, Node 24.18.0, AWM 6.4.1. Bootstrap matched in zsh and bash; no Gatekeeper warning; one case-insensitive `development-process` entry. |
| WIN-01 | PASS | 2026-08-10 — Windows Server 2022 Datacenter, Node 24.19.0, Developer Mode on, AWM 6.4.1. `LinkType: Junction` for the `development-process` directory artifact, as intended (this row's own criterion above was corrected the same day — it previously required `SymbolicLink`). |
| WIN-02 | PASS | **Real bug found and closed.** 2026-08-10 against AWM 6.4.1: `awm add dev --scope local --method copy --agent claude-code --yes` reported exit `0` but installed a Junction, not a real directory — `--method copy` was silently discarded (`runAddBundleCore` hardcoded `method: 'symlink'`). Reproduced in two independently fresh `AWM_HOME`/project setups to rule out state bleed from earlier steps. Fixed in [#68](https://github.com/Kodria/agentic-workflow/pull/68) (AWM 6.4.2) and verified via a real, unmocked `addBundle → installBundle → executor.stageArtifact` pipeline test (`tests/commands/add.test.ts`) green on `windows-latest` CI. |
| WIN-03 | PASS | 2026-08-10, AWM 6.4.1. `awm init --yes --json` from `%TEMP%\awm e2e con espacios` returned `failed: 0`. |
| WIN-04 | PASS | 2026-08-10, AWM 6.4.1. `npm i -D typescript` + `awm sensors init` + `awm sensors run`: the typecheck sensor resolved its `.cmd` shim and ran (not `skipped: not found`). |
| WIN-05 | BLOCKED | 2026-08-10. Not a Windows bug — see the precondition-gap note under WIN-05 above: `awm init --yes` (bare, `claude-code` default) never produces an `AGENTS.md` to inspect on any OS. In a separate live run, `awm init -a codex --yes` (AWM 6.4.2, patched build) *did* write `AGENTS.md` directly — worth re-running this exact check against that target before it can PASS or FAIL for real. |
| WIN-06 | PASS | 2026-08-10, AWM 6.4.1. `awm watch --init` exited `0`; the documented crash-recovery known-gap was not exercised. |
| WSL-01 · 02 |  |  |

**Related finding, adjacent to this playbook but not a WIN-XX check itself:** `awm remove <bundle> --yes` (no `--scope`) still opened an interactive scope picker on Windows — found live during this same session, against AWM 6.4.1. Fixed in [#68](https://github.com/Kodria/agentic-workflow/pull/68) (AWM 6.4.2), unit-tested (`resolveScopeOption`); not yet re-verified against a real non-interactive invocation post-fix.

Record the machine alongside the result: OS version, `node --version`, `awm --version`, and for macOS `uname -m`. A result without its environment isn't reproducible.
