# OS acceptance matrix

Only the **deltas per operating system**. Run [core-acceptance.md](core-acceptance.md) first — it must pass identically everywhere.

| OS | Continuous verification |
|---|---|
| Linux | Full suite on `ubuntu-latest`, every PR and every push to `main` |
| Windows (native) | Full suite on `windows-latest`, every PR and every push to `main` |
| macOS | **No CI.** This playbook is the only verification. |
| WSL | Reports as Linux; covered by the Linux path |

macOS having no CI is the honest gap in this matrix: it is the one OS where these manual checks are the *only* evidence.

---

## Linux

**LNX-01 · Symlinks work unprivileged**
```bash
awm add development-process --type skill --scope global --method symlink --agent claude-code --yes
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
awm add development-process --type skill --scope local --agent claude-code --yes
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
awm add development-process --type skill --scope global --method symlink --agent claude-code --yes
Get-Item ~\.claude\skills\development-process | Select-Object LinkType, Target
```
Windows only allows unprivileged symlink creation with **Developer Mode** on (Settings → System → For developers), otherwise it needs an elevated shell.

**Expect one of two acceptable outcomes:**
- Developer Mode on → a real symlink (`LinkType: SymbolicLink`).
- Developer Mode off → a clear error explaining the requirement, **or** an automatic fallback to `--method copy`.

**FAIL** if it half-succeeds: a zero-byte file, a broken link, or a silent no-op that `awm doctor` then reports as healthy.

**WIN-02 · Copy method always works**
```powershell
awm add development-process --type skill --scope local --method copy --agent claude-code --yes
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
awm sensors init --yes; awm sensors run
```
**Expect:** the typecheck sensor **runs** (pass or fail), not `skipped: not found`. Resolving `.cmd`/`.ps1` shims on Windows was a real published bug (v3.9.0); this is its regression check.

**WIN-05 · Line endings don't corrupt managed files**
```powershell
awm init --yes; Get-Content AGENTS.md -Raw | Format-Hex | Select-Object -First 4
```
**Expect:** AWM's managed block is intact and the file isn't mangled into mixed `\r\n`/`\n` inside a single block.

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
| MAC-01 · 02 · 03 · 04 |  |  |
| WIN-01 · 02 · 03 · 04 · 05 · 06 |  |  |
| WSL-01 · 02 |  |  |

Record the machine alongside the result: OS version, `node --version`, `awm --version`, and for macOS `uname -m`. A result without its environment isn't reproducible.
