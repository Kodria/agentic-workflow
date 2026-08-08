# Installation

AWM is a global npm CLI. Installing it does **not** install any content — content comes from git registries on first `awm init`.

## Prerequisites

| Requirement | Why | Check |
|---|---|---|
| **Node.js 22+** | The CLI targets Node 22; older runtimes fail with cryptic errors. | `node --version` |
| **git** | Registries are git repos; AWM clones and fetches them. | `git --version` |
| An agent | At least one of: Claude Code, Codex, OpenCode, Cursor, Copilot, Antigravity. | see [agents-setup.md](agents-setup.md) |

`package.json` declares `engines: { node: ">=22" }`, so npm warns you on an unsupported runtime instead of letting you discover it at runtime.

Optional, per feature:

- **`gh` / `glab`** — only if you want the PR/MR automation in the finishing skills. AWM itself never calls them; it detects your git host and warns if the matching tool is absent.
- **Sensor tools** (`tsc`, `eslint`, `semgrep`, `pytest`, `shellcheck`…) — whatever your stack's sensor pack declares. A missing tool reports `skipped` with a reason; it never silently passes.

---

## Install

```bash
npm i -g agentic-workflow-manager
awm --version
```

Upgrading later:

```bash
npm i -g agentic-workflow-manager@latest
```

> `awm update` updates **content** (your registries). The **CLI** updates through npm. They are deliberately separate: your team's skills move at a different cadence than the tool.

---

## Per-OS notes

### Linux

Nothing special. If npm's global prefix is root-owned you'll need `sudo`, or better, point npm at a user-owned prefix:

```bash
mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"   # add to ~/.bashrc or ~/.zshrc
```

### macOS

Same as Linux. With Homebrew Node, the global prefix is already user-owned, so no `sudo`.

macOS is **not covered by CI** — it's supported and expected to work (it's a POSIX platform like Linux), but the verification is the [acceptance playbook](testing/os-matrix.md#macos) rather than an automated matrix. If you use AWM on macOS, running that playbook after an upgrade is genuinely useful.

### Windows (native)

Supported and verified on `windows-latest` in CI on every PR. Two things to know:

**1. Symlinks need Developer Mode.** AWM's default install method is a symlink into the registry clone, so content updates propagate instantly. Windows only allows unprivileged symlink creation with **Developer Mode** enabled:

> Settings → System → For developers → Developer Mode → On

Without it, use copy mode:

```powershell
awm add <name> --method copy
```

Copy is a hard clone: it works everywhere, but it disconnects that artifact from `awm update` until you re-add it.

**2. One known gap.** The crash-recovery path of `awm watch`'s supervisor has not converged on Windows CI and its end-to-end tests are POSIX-scoped. Everything else — `init`, `update`, `sync`, `add`, `sensors`, `preflight`, `doctor`, hooks — is continuously green. See [`cli/src/core/journal/process.ts`](../cli/src/core/journal/process.ts).

### Windows via WSL

Works normally — WSL reports as Linux and takes the Linux path. Keep your projects on the **Linux filesystem** (`~/...`), not on `/mnt/c/...`: the Windows mount doesn't give POSIX symlink and permission semantics, which is exactly what AWM relies on.

---

## First run

Inside the repo where you want the harness:

```bash
awm init            # Claude Code (default)
awm init -a codex   # or: opencode, cursor, copilot, antigravity
```

This is **idempotent** and **transactional**: run it as often as you like, and if a step fails, every file it touched is restored.

### Reading the result

`awm init` exits **`1` on a normal, successful run.** Exit `1` means *degraded* — usually "two steps need an agent session to finish", not "something failed".

```bash
awm init --yes --json
```

```json
{ "result": "degraded", "applied": 4, "pending": 2, "failed": 0 }
```

Judge on **`failed`**:

| | Meaning |
|---|---|
| `failed: 0` | Nothing broke. `pending` steps need an agent to write `CONSTITUTION.md` / `AGENTS.md`. |
| `failed: > 0` | A real failure. The transaction rolled back; `modifiedFiles` lists what was restored. |

Exit codes: `0` clean · `1` degraded · `2` a gate refused (missing binary, version below minimum) — a `2` with a clear message is a *correct* refusal.

Then:

```bash
awm doctor    # what state is everything in?
```

---

## Verify the install

Run the [core acceptance suite](testing/core-acceptance.md) — 20 checks, about 15 minutes, and it tells you whether this machine is actually working rather than whether the commands merely printed something.

---

## Troubleshooting

**`awm: command not found` after install**
npm's global bin isn't on `PATH`. `npm bin -g` prints it; add that to your shell profile.

**`awm init` leaves `registries/` empty**
The baseline clone failed — network, proxy, or auth. Run `awm update` to see the real git error. For a private registry over SSH, confirm `git clone <url>` works standalone first.

**A skill shows an empty description, or `awm add` errors on one artifact**
Its `SKILL.md` frontmatter is likely malformed. `awm list` shows what AWM parsed. Frontmatter is parsed with YAML semantics verified against a real parser, so if AWM disagrees with your expectation, the file probably says something different than you think.

**Sensors report `skipped: not found` for a tool you have installed**
The binary isn't on the `PATH` of the shell AWM runs in. On Windows this also covers `.cmd`/`.ps1` shims — resolving those was a real bug fixed in R1, and [WIN-04](testing/os-matrix.md#windows-native) is its regression check.

**Something wrote to the wrong place / I want to experiment safely**
Override the home:

```bash
export AWM_HOME="$HOME/.awm-sandbox"
```

Never hand-edit `~/.awm` to fix a problem — that directory is owned by `awm init` / `awm update`, and editing it produces states the CLI can't reason about.

**I need to roll something back**

```bash
awm backup    # inspect and restore AWM's filesystem backups
```

Any command that rewrote a user-owned file leaves a restorable copy.
