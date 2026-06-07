# CLI Reference

The `awm` (Agentic Workflow Manager) binary is the entry point for the registry and the harness. It supports an interactive Text User Interface (TUI) via Clack Prompts by default, plus quiet, flag-based execution for scripting and CI.

New to AWM? Start with the [Getting Started runbook](getting-started.md). This page is the exhaustive command surface.

## Concepts used across commands

- **Agent target** (`-a, --agent`): `claude-code` (default), `opencode`, or `antigravity`. Determines where artifacts install and how context is delivered.
- **Scope** (`-s, --scope`): `global` (machine-wide, in the agent's global dir) or `local` (inside the current repo).
- **Method** (`-m, --method`): `symlink` (default — links to the `~/.awm` cache so `awm update` patches everything at once) or `copy` (ejects a standalone copy).

---

## Setup & diagnostics

### `awm init`

Bootstraps the AWM harness on this machine **and** the current project, in one idempotent pass. This is the command you run first in any repo — it subsumes the older manual sequence (`hooks install` + `sensors init` + installing the skill pack).

```
awm init [--agent <agent>] [--machine-only] [--yes] [--json]
```

| Flag | Description |
|---|---|
| `-a, --agent <agent>` | Target agent. Default `claude-code`. |
| `--machine-only` | Run only machine-level steps; skip all project steps. |
| `-y, --yes` | Skip confirmation prompts (for scripts). |
| `--json` | Emit the full `InitOutcome` as JSON instead of the rendered report. |

**What it does:** syncs the registry cache · installs the agent's context mechanism (Claude: `SessionStart` hook; OpenCode: global `opencode.json` `instructions[]`) · installs the `dev` **baseline** skill pack · bootstraps `.awm/profile.json` · detects the stack and writes `.awm/sensors.json` · wires `CONSTITUTION.md` into the repo-local `opencode.json` (OpenCode). It **flags** (but does not perform) the steps that need an agent or a deliberate choice: generating `CONSTITUTION.md` / agent context, and installing the Claude per-edit sensor hook.

The output has three panels: **Estado inicial** (state before), **Acciones** (what each step did), **Estado final** (state after). A red row in *Estado inicial* that turns green in *Estado final* means the step fixed it — read the final panel for the result.

### `awm doctor`

Read-only dashboard of machine + project harness state. Changes nothing.

```
awm doctor [--json]
```

Glyphs: `✔` healthy · `⚠` advisory (does not degrade) · `✖` missing (degrades state). Each non-healthy row carries a remedy — a command (`→ awm …`) or a skill to ask the agent to run (`→ skill: …`). `--json` emits the structured `CheckReport`.

---

## Registry & artifacts

### `awm add [name]`

Install a skill, workflow, or process. With no `name`, launches an interactive search over the cached registry. With a `name`, the flags below let you skip the prompts (recommended for scripts).

```
awm add [name] [-t <type>] [-a <agent>] [-s <scope>] [-m <method>] [-y]
```

| Flag | Description |
|---|---|
| `-t, --type <type>` | `skill`, `workflow`, or `process`. Auto-detected if omitted. |
| `-a, --agent <agent>` | Target agent. |
| `-s, --scope <scope>` | `global` or `local`. |
| `-m, --method <method>` | `symlink` or `copy`. |
| `-y, --yes` | Skip the final confirmation. |

```bash
# Fully scripted: install a skill globally via symlink on claude-code, no prompts
awm add cscti-docs-assistant --type skill --agent claude-code --scope global --method symlink --yes
```

### `awm list [package]`

List available artifacts from the local cache. With no argument, shows a package summary; pass a package name or `--all` to expand.

```
awm list [package] [-a, --all]
```

### `awm remove`

Interactively uninstall a skill or workflow — prompts for agent, scope, then removes the symlink/folder. (No non-interactive flags.)

### `awm sync`

Rebuild the project's local skill symlinks from `.awm/profile.json`. Run this after cloning a repo on a new machine, where the profile is committed but the machine-specific links don't exist yet.

```
awm sync [-a <agent>] [-m <method>]
```

| Flag | Description |
|---|---|
| `-a, --agent <agent>` | Target agent. |
| `-m, --method <method>` | `symlink` (default) or `copy`. |

### `awm update`

Pull the latest registry from the canonical GitHub remote **and rebuild the CLI binary** (you never run `npm build` yourself). Because skills are symlinked into the cache by default, this instantly patches every global and local install on the machine. (No flags.)

---

## Sensors (per-project computational checks)

Sensors are deterministic checks (tsc, ESLint, Semgrep, depcheck, …) whose output is LLM-readable. They are configured per repo in `.awm/sensors.json`.

### `awm sensors init`

Detect the stack and write `.awm/sensors.json`, copying the pack's config files into the project by default.

```
awm sensors init [--no-configure] [--registry-root <path>]
```

| Flag | Description |
|---|---|
| `--no-configure` | Write the manifest only; do not copy pack config files. |
| `--registry-root <path>` | Override the AWM registry root (defaults to the cache). |

### `awm sensors run`

Run the sensors in the manifest. With no flag, runs **all** sensors (the completion gate). The speed flags scope the run:

```
awm sensors run [--fast | --slow | --all] [--json]
```

| Flag | Description |
|---|---|
| `--fast` | Fast sensors only (tsc, lint) — what the per-edit hook runs. |
| `--slow` | Slow sensors only (semgrep, mutation). |
| `--all` | All sensors regardless of speed. |
| `--json` | Machine-readable output. |

> The completion gate is the **full** run (no flag). Do not use `--slow` as the gate — it skips lint/typecheck, where most new findings surface.

### `awm sensors status`

Report each sensor's health: `HEALTHY` (ready), `DEGRADED` (config present but failing — usually a version mismatch; fix with the `setup-sensors` skill), or `NOT_CONFIGURED`.

### `awm sensors baseline`

Snapshot current findings as an accepted baseline (`.awm/sensors.baseline.json`) so sensors fail only on **new** findings. Commit the file to share the ratchet. Use on legacy repos with large pre-existing debt; skip on greenfield.

### `awm sensors install`

Install the **`PostToolUse`** hook in `~/.claude/settings.json` so fast sensors run automatically after each file edit. This installs **only the per-edit *trigger*, not the sensors** — the checks and the completion gate are identical on every agent. **Claude Code only:** OpenCode has no hooks, so it has nothing to install here; it runs the same sensors at the completion gate (`awm sensors run`, via `verification-before-completion`). The difference is *cadence* (Claude gets an extra early loop), not *coverage*.

---

## Hooks (Claude Code `SessionStart`)

Manage the bootstrap hook that injects `using-awm` + `CONSTITUTION.md` into every Claude session. `awm init` installs this for you; these subcommands are for manual repair/inspection.

```
awm hooks install   [-t <target>] [-y]
awm hooks uninstall [-t <target>] [-y]
awm hooks status    [-t <target>]
```

| Flag | Description |
|---|---|
| `-t, --target <target>` | Target harness. `claude-code` only in this version. |
| `-y, --yes` | Skip interactive confirmations (install/uninstall). |

`status` reports `HEALTHY` plus the four checks (bootstrap skill, session-start script, run-hook wrapper, settings entry).

---

## Ledger (the learning loop)

A persistent, per-branch findings ledger — ephemeral working memory for `harness-retro`. Stored at `.awm/ledger/<branch>.jsonl`, gitignored, and **never injected into agent context**. Skills append to it during development; you rarely call `add` by hand. All subcommands accept `--branch <branch>` to override the auto-detected git branch.

### `awm ledger add`

Append one finding or win to the current branch's ledger.

```
awm ledger add --polarity <p> --class <c> --signature <slug> --severity <s> --desc <text>
               [--ref <ref>] [--phase <phase>] [--source-skill <skill>] [--branch <branch>]
```

| Flag | Required | Description |
|---|---|---|
| `--polarity <p>` | yes | `win` or `finding`. |
| `--class <c>` | yes | `structural`, `logica`, `proceso`, or `seguridad`. |
| `--signature <slug>` | yes | Stable dedup key — recurring issues group by this. |
| `--severity <s>` | yes | `blocker`, `important`, `minor`, or `info`. |
| `--desc <text>` | yes | One-line description. |
| `--ref <ref>` | no | `file:line` or PR/commit reference. |
| `--phase <phase>` | no | Lifecycle phase (default `unknown`). |
| `--source-skill <skill>` | no | Emitting skill (default `unknown`). |

> Capture is best-effort: skill prose tells agents to skip silently if `awm` isn't on `PATH`.

### `awm ledger list`

Print the current branch's ledger as JSON.

### `awm ledger recurring`

Print signature clusters whose count meets a threshold (the recurrence signal `harness-retro` reads).

```
awm ledger recurring [--min <n>]    # default --min 2
```

### `awm ledger archive`

Rotate the current branch's ledger out of the active flow (into `.awm/ledger/archive/`). `harness-retro` calls this when it closes a branch.

---

## Misc

### `awm miro`

Miro board integration. (See `awm miro --help`.)

### `awm --help` / `awm --version`

Standard Commander help and version output. Every command and subcommand accepts `--help`.

---

## See also

- [Getting Started](getting-started.md) — the from-zero runbook (Claude & OpenCode).
- [Architecture & Design](architecture.md) — how AWM routes artifacts between the registry and your install.
- [Registry Contributor Guide](registry-guide.md) — author your own skills and packs.
