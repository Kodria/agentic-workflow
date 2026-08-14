# CLI Reference

The `awm` (Agentic Workflow Manager) binary is the entry point for the registry and the harness. It supports an interactive Text User Interface (TUI) via Clack Prompts by default, plus quiet, flag-based execution for scripting and CI.

New to AWM? Start with [installation](installation.md), [configuration](configuration.md),
and [project setup](project-setup.md). This page is the exhaustive command surface;
the [runbook](runbook.md) covers ongoing operations.

## Concepts used across commands

- **Agent target** (`-a, --agent`): one of `claude-code`, `codex`, `opencode`, `cursor`, `copilot`, or `antigravity`. It determines where artifacts install and how context is delivered. See [configuration](configuration.md) for provider capabilities, defaults, and coexistence.
- **Scope** (`-s, --scope`): `global` (machine-wide, in the agent's global dir) or `local` (inside the current repo).
- **Method** (`-m, --method`): `symlink` (default — links to the `~/.awm` cache so `awm update` patches everything at once) or `copy` (ejects a standalone copy).

---

## Setup & diagnostics

### `awm init`

Bootstraps AWM for one provider per run. Without `--agent`, a fresh machine uses
`claude-code`; subsequent commands use the configured default unless an agent is
explicit. A normal run can reconcile both machine state and the current project.
For the lifecycle and provider choices, see [configuration](configuration.md).

```
awm init [--agent <agent>] [--machine-only] [--yes] [--json]
```

| Flag | Description |
|---|---|
| `-a, --agent <agent>` | Target one provider for this run. On a fresh machine, the default is `claude-code`. |
| `--machine-only` | Run only machine-level steps and exclude **every** project-scoped write. Providers without global delivery defer their content until normal project initialization; AWM does not write project files to work around that limitation. |
| `-y, --yes` | Skip confirmation prompts (for scripts). |
| `--json` | Emit the full `InitOutcome` as JSON instead of the rendered report — on success **and** on failure. |

**Exit codes:** `0` init did its job — including a run that ends `degraded`, i.e. ran to completion with checks still pending · `2` did not complete: a gate refused, or a step failed and every write was rolled back. **`1` is not used.**

> **Changed in v5.0.0.** `degraded` previously exited `1`, which made a completed
> init fail under `set -e`. The exit code now answers whether init completed;
> `awm doctor` answers harness health. See [decisions D-008](decisions.md#d-008).

**`--json` contract.** Both documents carry a `result` field, so a script that wants the `ok` / `degraded` distinction can branch on it — the exit code no longer encodes it:

| `result` | Exit | Document |
|---|---|---|
| `ok` / `degraded` | 0 | The `InitOutcome`: `steps`, `applied`/`pending`/`failed`, `before`, `after`, `transactionId`, `modifiedFiles`. |
| `failed` | 2 | A failure envelope: `error` (names the failed steps), `steps`, `failedSteps` (the `action: "failed"` subset, each with `id` and `error`), `before`, `after`, and `transaction`. |

On `result: "failed"`, `transaction` records what happened to the machine: `committed` is always `false`, `rolledBack` says whether every path in `restoredFiles` was restored to its pre-init state, and `rollbackError` appears only if the restore itself failed (recover with `awm backup restore <transactionId>`). `after` is the state observed at the end of the step pipeline — *before* the rollback ran — so it describes what the failing run produced, not what is on disk now.

Human mode renders the same evidence: on failure the three-panel report is printed as usual, with the failing step marked `✖` and its error inline, followed by the summary on stderr.

**What it does:** syncs the registry cache · installs the agent's context mechanism (Claude: `SessionStart` hook; OpenCode: global `opencode.json` `instructions[]`) · installs the `dev` **baseline** skill pack · bootstraps `.awm/profile.json` · detects the stack and writes `.awm/sensors.json` · wires `CONSTITUTION.md` into the repo-local `opencode.json` (OpenCode). It **flags** (but does not perform) the steps that need an agent or a deliberate choice: generating `CONSTITUTION.md` / agent context, and installing the Claude per-edit sensor hook.

The output has three panels: **Initial state**, **Actions**, and **Final state**.
A red initial row that turns green in the final panel means the step repaired it;
the final panel is the result to act on.

### `awm doctor`

Read-only dashboard of machine + project harness state. Changes nothing.

```
awm doctor [--json]
```

Glyphs: `✔` healthy · `⚠` advisory (does not degrade) · `✖` missing (degrades state). Each non-healthy row carries a remedy — a command (`→ awm …`) or a skill to ask the agent to run (`→ skill: …`). `--json` emits a `ProviderDiagnosticReport`: `{ providers: [...], overall }`, one entry
per resolved agent with its `tier` and `checks`. If you are asserting on parsed fields,
that is the shape — there is no top-level `results` array.

A row that is **absent** means "nothing to verify", not "verified fine": a provider with no
native-agent directory, or a registry that ships no `agents/`, emits no row rather than a
red one nobody can act on. Two rows worth knowing:

- **`project.orphans`** — skill links in the project that no longer belong to any declared
  extension. Advisory; `awm sync` heals or prunes them.
- **`workflows.global`** — machine-scope workflows, for the providers that use them
  (today: Antigravity).

### `awm agent list`

List every supported provider and this machine's enabled/default state.

```
awm agent list [--json]
```

The human output marks enabled providers and the default; `--json` emits rows
with `id`, `label`, `enabled`, and `default`. This command only inspects AWM
preferences. See [configuration](configuration.md#inspect-enabled-and-default-providers)
for how the provider set affects normal commands.

### `awm agent disable <agent>`

Stop AWM from managing an enabled provider without deleting that provider's
existing hooks, skills, or instruction files.

```
awm agent disable <agent> [--default <replacement-agent>]
```

If `<agent>` is the current default, `--default <replacement-agent>` is
required, and that replacement must remain enabled. For example:

```bash
awm agent disable claude-code --default codex
```

Re-enable a provider through a normal `awm init --agent <provider>` run.

---

## Registry & artifacts

### `awm add [name]`

Install a **bundle** — a package of skills. With no `name`, launches an interactive search over the cached registry. With a `name`, the flags below let you skip the prompts (recommended for scripts).

**Bundles, not individual artifacts.** AWM's skills lean on each other — the
`development-process` spine invokes `brainstorming`, `writing-plans`, the QA gates — so a
skill installed alone rarely does what you expect. Passing a skill name fails with
`Bundle "<name>" not found in registry`. See [decisions D-001](decisions.md#d-001).

```
awm add [name] [-a <agent>] [-s <scope>] [-m <method>] [-y]
```

| Flag | Description |
|---|---|
| `-a, --agent <agent>` | Target agent. |
| `-s, --scope <scope>` | `global` or `local`. |
| `-m, --method <method>` | `symlink` or `copy`. |
| `-y, --yes` | Skip the final confirmation. |

```bash
# Fully scripted: install a skill globally via symlink on claude-code, no prompts
awm add dev --agent claude-code --scope global --method symlink --yes
```

### `awm list [package]`

List available artifacts from the local cache. With no argument, shows a package summary; pass a package name or `--all` to expand.

```
awm list [package] [-a, --all]
```

### `awm remove`

Remove an installed **bundle**. Interactive by default; the flags below make it scriptable.

```
awm remove [name] [-a <agent>] [-s <scope>] [-y]
```

| Flag | Description |
|---|---|
| `-a, --agent <agent>` | Target agent(s), comma-separated. Defaults to every enabled agent. |
| `-s, --scope <scope>` | `local` or `global`. Skips the scope prompt. |
| `-y, --yes` | Skip the confirmation. **Requires a name** — and implies fully non-interactive: no agent or scope prompt either. |

`--yes` without a name is refused. Removal without a name stays interactive so you see
what you are deleting; `--yes` skips the *confirmation*, never the *selection*.

Removing what is not installed is not an error — it reports that nothing matched and
exits `0`, so a cleanup script is safe to re-run.

### `awm sync`

Rebuild the project's local skill symlinks from `.awm/profile.json`. Run this after cloning a repo on a new machine, where the profile is committed but the machine-specific links don't exist yet.

```
awm sync [-a <agent>] [-m <method>]
```

| Flag | Description |
|---|---|
| `-a, --agent <agent>` | Target agent. |
| `-m, --method <method>` | `symlink` (default) or `copy`. |

`awm sync` also repairs the project's existing skill links before installing: a dangling
symlink whose target the registry can still serve is re-linked, and one nothing can serve
any more is pruned. Both are reported per line. Only dangling symlinks are touched — your
own files and directories, and links that still resolve, are left alone. This runs even
when the profile declares no extensions, which is precisely when orphans are left behind
by a removed one.

The whole sync is a **single transaction**: if any part of it fails, nothing is installed.
On success it prints the transaction id and the `awm backup restore` invocation that
undoes it.

### `awm update`

Pull the latest content from every configured registry (checking out the latest semver tag, or the pinned version if the project pins one). Because skills are symlinked into the registry clones by default, this instantly patches every global and local install on the machine.

| Flag | Effect |
|---|---|
| `-a, --agent <agent>` | Restrict the run to the given agent target(s), comma-separated. Defaults to every enabled agent. |
| `-y, --yes` | Non-interactive: never prompt, and take the CLI self-update below without asking. |

**Exit code and closing message are derived from what actually happened** — they never
claim work the run did not do:

| Situation | Exit | Closing line |
|---|---|---|
| Every configured registry synced | `0` | `✅ N registries, skills and hooks updated.` |
| A registry failed but its content is still on disk | `0` | `⚠ Updated with stale content — …` naming the stale registry |
| A registry failed and left no content on disk | `1` | the failing registry and its error |
| **No registries configured** on this machine | `1` | `Nothing updated — no registries configured on this machine.` (run `awm init`) |
| Any later stage failed (context, artifacts, hooks) | `1` | the failing stage |

> `awm update` updates **content** (registries). The CLI binary is a separate thing: at
> the end of the run, if a newer version is published, `awm update` offers to install it
> for you. That offer is only made when there is a human to answer — with no TTY on stdin
> (CI, cron, an agent session) it prints `npm i -g agentic-workflow-manager` and moves on
> rather than blocking on a prompt nobody can see. Pass `--yes` to take the update without
> being asked, or update by hand any time with `npm i -g agentic-workflow-manager@latest`.

### `awm export <name>`

Exports a bundle or an individual skill from the installed registry as claude.ai-uploadable
custom skill artifacts: one folder per skill (`SKILL.md` + `references/`) plus a `.zip`
when the system `zip` binary is available (folder-only fallback otherwise).

- Only skills declaring `portable: true` in their `SKILL.md` frontmatter are exported;
  bundle exports list non-portable skills as skipped, and requesting a non-portable
  skill explicitly is an error.
- If `skills/<name>/port.claude-ai.md` exists in the registry, it is used verbatim;
  otherwise a mechanical transform strips AWM-only frontmatter fields (`version`,
  `portable`), appends a deference line to the description, and rewrites
  intra-registry paths in the body (`skills/<other>/SKILL.md`,
  `skills/<other>/references/<file>.md`) into pathless prose — those paths resolve
  in Claude Code but never in claude.ai, where only the portable skill is uploaded.
  Paths embedded in a URL are left alone, since those do resolve for the reader.
- `--target <target>` (default `claude-ai`, the only target today) · `--out <dir>`
  (default `./awm-export`; artifacts are written under `<out>/<target>/`). Reads from
  the installed registry content roots.

---

## Registries & pinning (team/personal content)

Additional registries let a team or individual distribute their own skills, bundles, and packs alongside the baseline. Each registry is a git repo cloned under `~/.awm/registries/<name>/`.

### `awm registry add <remote>`

Clone an additional registry (git URL or local path) and register it in the machine config.

```
awm registry add <remote> [--name <name>] [--install-all] [--no-install]
```

| Flag | Description |
|---|---|
| `--name <name>` | Registry name (default: repo basename). |
| `--install-all` | Install every bundle from the new registry for the default agent. |
| `--no-install` | Skip the bundle install offer. |

Use an SSH remote (`git@github.com:org/repo.git`) for private registries — clone/fetch run through git, so your ssh-agent and `~/.ssh/config` apply as with any repo.

### `awm registry list`

List configured additional registries.

### `awm registry remove <name>`

Remove an additional registry (config + clone). `-y, --yes` skips confirmation.

### `awm pin <registry> <version>`

Pin a registry (`baseline` or an additional registry name) to a version tag, e.g. `awm pin baseline 1.0.0`. The pin is stored in `~/.awm/preferences.json` (machine-level, not committed) — it applies only to your local `awm update` runs. To pin for the whole team, edit `.awm/profile.json`'s `registries` map directly and commit it.

### `awm unpin <registry>`

Remove the version pin (the registry returns to the latest tag on the next `awm update`).

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

### `awm sensors coverage`

Compare configured sensors with the static coverage reference owned by the selected sensor-pack. This diagnostic is read-only: it does not run sensors, install tools, edit `.awm/sensors.json`, or apply a remedy.

```
awm sensors coverage [--json]
```

Human output is the default. `--json` emits the versioned `schemaVersion: 1` envelope, whose stable `static` section contains the current analysis; a future release may add optional `empirical` data without changing existing field meanings. Human output shows class descriptions, detector sensor statuses, and pack-provided remedies. It excludes configured sensor commands, evidence paths, marker values, and inspected file content.

Coverage gaps, unverifiable custom configuration, a missing `.awm/sensors.json`, and packs without a coverage reference are informative and exit `0`. A missing manifest returns `inconclusive/not_configured` and recommends `awm sensors init`; a legacy pack returns the distinct `inconclusive/no_reference` state and is never reported as covered. Malformed or unreadable manifests, packs, and coverage contracts exit non-zero with an actionable error.

On native Windows, when Node does not expose a safe no-follow file-open primitive, coverage inspection fails closed with an explicit non-zero safety error instead of inspecting the manifest, pack, or evidence files. Coverage results resume once that primitive is available.

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

`awm sensors run` only ever **reads** your project. It runs the manifest exactly as committed: it does not rewrite `.awm/sensors.json`, does not copy pack config files into the tree, and does not install anything. When the manifest's pack no longer matches the tree (a `generic` manifest over a real stack), the output carries a `packDrift` field naming the detected pack and the command that adopts it — `awm sensors init`.

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

Print recurrence clusters whose count meets a threshold (the recurrence signal `harness-retro` reads).

```
awm ledger recurring [--min <n>]    # default --min 2
```

Clustering uses three signals, in order of confidence: identical `signature`, then a shared
source file in `ref` plus at least one word in common, then strong word overlap alone. Each
cluster carries a `kind`:

| `kind` | Meaning |
|---|---|
| `exact` | One distinct signature — the same emitter recurring across tasks. |
| `convergent` | Two or more distinct signatures — independent reviewers landing on one defect, the stronger signal of a systemic problem. |

Convergent clusters also list every distinct signature in `signatures`; `signature` itself is the
most frequent one in the cluster. A `ref` that is not a file locus (e.g. `PR #16`) contributes no
clustering signal, and a win is never merged with a finding on the strength of a shared file.

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

- [AWM Runbook](runbook.md) — the complete operating manual (install → team setup → authoring).
- [Architecture & Design](architecture.md) — how AWM routes artifacts between the registry and your install.
