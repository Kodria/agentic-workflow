# Getting Started

The complete runbook: from **nothing installed** to **a repo fully wired and ready for your first development prompt**. Two scenarios are covered end to end — a **new/greenfield repo** and an **existing/legacy codebase** — each as an explicit, ordered, point-by-point process.

AWM is **agent-agnostic**: the same workflow works for **Claude Code** and **OpenCode**. The *only* thing that differs between agents is **how each one receives context** (Claude via hooks, OpenCode via config injection). Every place that matters, this guide labels the difference explicitly. Nothing else changes.

---

## Mental model (read this first)

AWM has **two layers**, and **one command (`awm init`) bootstraps both**:

| Layer | Lives in | Set up | Holds |
|---|---|---|---|
| **Machine (global)** | `~/.awm/` + the agent's global skills dir | once per machine | the CLI cache, the baseline skill pack, the agent's context-delivery mechanism |
| **Project (per repo)** | `<repo>/.awm/`, `CONSTITUTION.md`, sensor configs | once per repo | the project profile, the sensor manifest, the project's rules |

`awm init` is **idempotent** — re-run it any time; it only fills gaps, never clobbers. `awm doctor` reports the state of both layers and **changes nothing**. You rarely call the low-level commands (`awm hooks install`, `awm sensors init`, …) by hand; `init` orchestrates them.

**How each agent stores skills and receives context** — the *only* per-agent difference:

| Agent | Global skills dir | Context delivery (how the agent learns AWM + your rules) |
|---|---|---|
| **Claude Code** | `~/.claude/skills/` | a `SessionStart` **hook** injects `using-awm` + `CONSTITUTION.md` into every session |
| **OpenCode** | `~/.agents/skills/` | `instructions[]` entries in `~/.config/opencode/opencode.json` (global AWM context) **+** `<repo>/opencode.json` (project `CONSTITUTION.md`) |

---

## The process at a glance

Pick your scenario and follow the ordered list. Each line is a real command or a plain-language prompt to your agent. The detailed explanation of every step is in [Part 1](#part-1--install-awm-once-per-machine)–[Part 6](#part-6--youre-ready-the-first-development-prompt) below. Steps marked **(Claude only)** or **(OpenCode only)** are the *only* per-agent branches.

### Track A — New / greenfield repo

```text
 1. curl -fsSL …/install.sh | bash        # install AWM (once per machine)
 2. cd <your-repo>                         # a git repo (run `git init` if needed)
 3. awm init                               # or: awm init --agent opencode
 4. awm doctor                             # confirm machine layer is green
 5. (reload the agent session)             # Claude: /clear or restart · OpenCode: new session
 6. ask agent: "Generá la CONSTITUTION.md con project-constitution."
 7. ask agent: "Inicializá el contexto del proyecto con project-context-init."
 8. (reload the agent session again)       # so it starts receiving CONSTITUTION.md
 9. awm sensors install                    # (Claude only) per-edit fast-sensor trigger
10. ✅ ready — give your first development prompt
```

> On a brand-new repo with no stack files yet (`package.json`/`pyproject.toml`), sensors start as the `generic` pack. **That's fine and self-correcting**: the first time `awm sensors run` executes over a tree that now has a real stack, it auto-upgrades the manifest to the right pack (tsc/lint/test). You never have to re-detect by hand. See [Part 5](#part-5--sensors-the-quality-gate).

### Track B — Legacy / existing codebase

Same spine as Track A, plus two extra moves (steps 6 and 9) because an existing codebase has a real stack and pre-existing debt from day one:

```text
 1. curl -fsSL …/install.sh | bash        # install AWM (once per machine)
 2. cd <your-repo>
 3. awm init                               # detects your real stack → real sensors immediately
 4. awm doctor                             # confirm machine layer is green
 5. (reload the agent session)             # Claude: /clear or restart · OpenCode: new session
 6. awm sensors status                     # EXTRA: are the gate tools healthy on this stack?
       └─ if DEGRADED → ask agent: "Adaptá los sensors con setup-sensors."
       └─ if "tool not installed" → npm i -D <tool>
 7. ask agent: "Generá la CONSTITUTION.md con project-constitution."
 8. ask agent: "Inicializá el contexto del proyecto con project-context-init."
 9. awm sensors baseline                   # EXTRA: accept existing debt → commit the file
10. (reload the agent session again)
11. awm sensors install                    # (Claude only) per-edit fast-sensor trigger
12. ✅ ready — give your first development prompt
```

> **Why the two extra steps on legacy?** (6) An existing project pins specific tool versions, so the templated sensor configs may need adapting before the gate is trustworthy. (9) A mature codebase has pre-existing findings — `awm sensors baseline` snapshots them as *accepted*, so the gate fails only on **new** problems you introduce, not on inherited debt. On greenfield there's no debt to baseline, so you skip both.

---

## Prerequisites

- `git`, `node`, `npm` on your `$PATH`.
- A working directory that is a git repo. If it isn't one yet: `git init`.

---

## Part 1 — Install AWM (once per machine)

```bash
curl -fsSL https://raw.githubusercontent.com/Kodria/agentic-workflow/main/install.sh | bash
awm --help        # verify it's on PATH
```

The installer clones the registry into `~/.awm/cli-source` and links the `awm` binary. **Nothing is wired into any agent yet** — that's `awm init` (Part 2). This step is machine-wide; you do it once, not per repo.

---

## Part 2 — Initialize the repo

### 2.1 Bootstrap with `awm init`

Run **inside the repo**. Pick your agent:

```bash
awm init                    # Claude Code (the default)
awm init --agent opencode   # OpenCode
```

Flags: `--machine-only` (bootstrap only the global layer, no project changes) · `--yes` (skip prompts, for scripts) · `--json` (machine-readable outcome).

**What `awm init` does in one idempotent pass:**

- **Machine layer:** syncs the registry cache · installs the agent's context mechanism (Claude: `SessionStart` hook; OpenCode: `instructions[]` in the global `opencode.json`) · installs the **baseline skill pack** (`dev`) — the full spine: `using-awm`, `development-process`, `brainstorming`, `writing-plans`, `subagent-driven-development`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `post-implementation-qa`, `harness-retro`, `setup-sensors`, `project-constitution`, `project-context-init`, and more.
- **Project layer:** bootstraps `.awm/profile.json` · detects your stack and writes `.awm/sensors.json` (+ copies the pack's config files) · for OpenCode, wires `CONSTITUTION.md` into the repo-local `opencode.json` once that file exists.

**What `awm init` deliberately leaves for you** — it *flags* these, it does not do them, because each needs an agent or a choice:

| Left for you | How to do it | Covered in |
|---|---|---|
| `CONSTITUTION.md` (the repo's rules) | run the `project-constitution` skill through the agent | [Part 4.1](#41-generate-the-constitution-constitutionmd) |
| Agent context (`AGENTS.md` / `CLAUDE.md`) | run the `project-context-init` skill through the agent | [Part 4.2](#42-generate-the-agent-context-file) |
| Per-edit fast-sensor trigger **(Claude only)** | `awm sensors install` | [Part 5.4](#54-claude-only-add-the-per-edit-fast-sensor-trigger) |

### 2.2 Read the state with `awm doctor`

```bash
awm doctor
```

```text
AWM · estado del harness

Máquina (global)
  ✔ CLI v1.0.0
  ✔ hook SessionStart
  ✔ dev-core (baseline)
  ✔ skills globales

Proyecto: my-repo
  ✔ .awm/profile.json (sin extensiones)
  ✔ bundles activos
  ✔ sensores
  ✖ CONSTITUTION.md ausente        → skill: project-constitution
  ⚠ contexto del agente ausente    → skill: project-context-init
```

Read the glyphs: `✔` healthy · `⚠` advisory (does not degrade) · `✖` missing (degrades state). Every non-`✔` row carries its **own remedy** — a command (`→ awm …`) or a skill to ask the agent to run (`→ skill: …`).

**A `→ skill: project-constitution` row is not a bug.** It is `init` telling you the next step requires the agent. A fresh repo is *expected* to read `degradado` until you run those skills — that is the normal starting state, not an error.

---

## Part 3 — Load the agent's context (first session)

The whole point: **every agent session starts already knowing the AWM discipline.** After `awm init`, trigger a fresh context load so the wiring takes effect:

- **Claude Code:** `/clear`, or restart the session. The `SessionStart` hook injects `using-awm` (and `CONSTITUTION.md` once it exists).
- **OpenCode:** start a new session. The `instructions[]` entries in `opencode.json` load each session.

Confirm it worked — ask the agent: *"¿qué skills de AWM tenés disponibles?"* It should reference `development-process` and the spine skills. If it doesn't, see [Troubleshooting](#troubleshooting).

---

## Part 4 — Generate the project's rules & context (through the agent)

These run **through your agent**, in the session you just loaded. Ask in plain language; the agent invokes the skill.

### 4.1 Generate the constitution (`CONSTITUTION.md`)

`CONSTITUTION.md` holds the repo's **non-negotiable rules**. AWM delivers it into every session automatically (Claude: hook; OpenCode: repo-local `opencode.json`).

> *"Generá la `CONSTITUTION.md` con `project-constitution`."*

The skill reads `CLAUDE.md`/`AGENTS.md`/`README`/`.awm/sensors.json`, drafts the rules section by section (with your approval), writes the file at the repo root, and commits it. **After it exists, reload the session** (Part 3) so the agent starts receiving it.

### 4.2 Generate the agent context file

`AGENTS.md` (agent-agnostic, preferred) or `CLAUDE.md` (Claude-specific) **describes** the repo — purpose, structure, commands. The split is deliberate: **rules → `CONSTITUTION.md`; description → `AGENTS.md`.**

> *"Inicializá el contexto del proyecto con `project-context-init`."*

Prefer `AGENTS.md` — every agent reads it. Use `CLAUDE.md` only for Claude-specific notes.

---

## Part 5 — Sensors: the quality gate

Sensors are **deterministic computational checks** (tsc, ESLint, Semgrep, test runner, …) whose output is LLM-readable. They are the project's quality gate. `awm init` already wrote `.awm/sensors.json` and copied the pack configs — these steps make the gate **trustworthy**.

> ### ⚠ Are sensors agnostic? — Yes. Read this to avoid the common misread.
>
> **The checks and the completion gate are 100% agent-agnostic.** `awm sensors run` executes the exact same tsc/eslint/semgrep/tests on Claude, OpenCode, or any agent. There is **no** "Claude-only sensor."
>
> What *is* Claude-only is the **automatic per-edit trigger** — a `PostToolUse` hook (Part 5.4). It is a matter of **cadence, not coverage**:
>
> | | Per-edit fast feedback | Full gate at "done" |
> |---|---|---|
> | **Claude Code** | ✅ hook runs fast sensors after each edit | ✅ `awm sensors run` |
> | **OpenCode** | — (no hooks exist) | ✅ `awm sensors run` |
>
> Both agents enforce the **same floor** at the completion gate (driven by `verification-before-completion`). Claude additionally gets a tighter, earlier feedback loop. Installing the hook does **not** make sensors "Claude-only" — it only adds an *extra, earlier* check on Claude.

### 5.1 Check sensor health

```bash
awm sensors status
```

- `HEALTHY` — ready.
- `DEGRADED` — the templated config doesn't match your installed tool versions (common on **legacy** repos).
- `NOT_CONFIGURED` — no manifest yet (shouldn't happen after `awm init`).

### 5.2 Adapt the configs (mostly legacy)

If `status` shows `DEGRADED`, ask the agent:

> *"Adaptá los sensors con `setup-sensors`."*

Also: tools that run via `npx` (eslint, depcruise, …) must be **devDependencies**, or `npx` fetches them remotely and `status` reports them as not installed. Fix with `npm i -D <tool>`.

### 5.3 Baseline existing debt (legacy only)

A mature codebase has pre-existing findings. Snapshot them as **accepted** so the gate fails only on **new** findings you introduce — then commit the snapshot so the whole team shares the ratchet:

```bash
awm sensors baseline      # writes .awm/sensors.baseline.json — commit it
```

**Skip this on greenfield** — there's no debt to accept. (The baseline is a *manual* snapshot you re-take deliberately when you want to move the ratchet; it never updates itself.)

### 5.4 (Claude only) Add the per-edit fast-sensor trigger

```bash
awm sensors install
```

This installs the `PostToolUse` hook so **fast** sensors (tsc/eslint) run automatically after each file edit, giving Claude an early feedback loop. **OpenCode has no hooks**, so it has nothing to install here — it runs the same sensors at the completion gate instead. Re-read the box at the top of Part 5 if this feels like an asymmetry in *coverage* — it isn't; it's only *cadence*.

### How the gate stays honest (the self-healing you don't see)

You don't manage this, but it's worth knowing: `awm sensors run` **re-detects your stack on every run**. If the manifest is still on the `generic` fallback but your tree now has a real stack, it auto-upgrades to the right pack. And if a run executed *nothing real* over a tree that clearly has a stack, it refuses to report green (`not_certified`) instead of a false pass. This is why greenfield Track A works without any manual re-detection: the gate corrects itself the first time it runs over real code.

---

## Part 6 — You're ready: the first development prompt

You're ready when **all** of these hold:

- [ ] `awm doctor` — machine layer all `✔`.
- [ ] `CONSTITUTION.md` exists and the session was reloaded after it was created.
- [ ] Agent context (`AGENTS.md`/`CLAUDE.md`) exists.
- [ ] `awm sensors status` — `HEALTHY` (and on legacy, a committed baseline).
- [ ] **(Claude only)** `awm sensors install` done.

Now just describe the work in plain language. Your default entry point for any development is the **`development-process`** orchestrator — you don't pick the skill, *it* reads project state and routes the phases:

```text
brainstorming → writing-plans → subagent-driven-development → post-implementation-qa → finishing-a-development-branch
```

> *"Quiero agregar la feature X."* — and let `development-process` drive. Cross-cutting skills (`test-driven-development`, `systematic-debugging`, `verification-before-completion`) kick in within phases.

---

## Part 7 — What happens automatically, day to day

| Trigger | Claude Code | OpenCode |
|---|---|---|
| New session in the repo | `SessionStart` hook injects `using-awm` + `CONSTITUTION.md` | `instructions[]` load the global AWM context + project `CONSTITUTION.md` |
| Agent edits a file | `PostToolUse` hook runs fast sensors, surfaces findings | — (no per-edit hook; caught at the gate) |
| Agent about to declare "done" | `verification-before-completion` runs `awm sensors run` and reads the output | **same** |
| Same sensor fails a 2nd time | the skill recommends `harness-retro` to turn it into a rule | **same** |

The common thread: **recurrence becomes a rule, not a repeated symptom fix.**

---

## Part 8 — The learning loop (ledger + harness-retro)

AWM remembers what goes wrong **and** what goes right, per branch, without bloating your context:

- During development, skills append wins and findings to a per-branch **ledger** (`awm ledger`) — ephemeral working memory, gitignored, **never injected** into the agent's context.
- At the end of a branch, **`harness-retro`** reads the ledger and *cures* recurring lessons into durable docs: structural findings → the remediation tree (eslint/semgrep/structural tests), process lessons → `CONSTITUTION.md`, agent lessons + wins → `AGENTS.md`. Then it archives the ledger.

You rarely touch `awm ledger` directly. Inspect it if curious: `awm ledger list` / `awm ledger recurring --min 2`.

> **Project-specific vs framework rules.** Rules born from a bug in *your* repo live in *your* repo (grown by `harness-retro` into your config files / `CONSTITUTION.md`). Only universally-avoidable patterns (e.g. "never `eval`") belong in the AWM registry. AWM ships the *mechanism*, not your project's bug list.

---

## Part 9 — Keep everything up to date

```bash
awm update
```

Pulls the latest registry **and rebuilds the CLI binary** (you never run `npm build`). Because skills are symlinked into the cache by default, the update instantly patches every global and local install on the machine. Re-run `awm init` afterward to reconcile the wiring to any new defaults (it's idempotent).

---

## Command reference (the surface you actually use)

| Command | What it does |
|---|---|
| `awm init [--agent <a>] [--machine-only] [--yes]` | Bootstrap machine + project (idempotent). `<a>` = `claude-code` (default) / `opencode` / `antigravity` |
| `awm doctor [--json]` | Read-only dashboard of machine + project state |
| `awm sensors status \| run \| init \| install \| baseline` | Manage the project's computational quality gate |
| `awm add [name]` / `awm list` / `awm remove` | Install / browse / uninstall individual skills, workflows, processes |
| `awm sync` | Rebuild local skill symlinks from `.awm/profile.json` (e.g. after cloning on a new machine) |
| `awm update` | Sync the registry and rebuild the CLI |
| `awm hooks status \| install \| uninstall` | Manage the Claude `SessionStart` bootstrap hook |
| `awm ledger list \| recurring \| add \| archive` | Per-branch findings ledger (mostly driven by skills) |

Full flags and every subcommand: [cli-reference.md](cli-reference.md).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `awm: command not found` | binary symlink points at a missing `~/.awm/cli-source/cli` | re-run the install script |
| `awm doctor` shows `✖ .awm/profile.json → awm init` right **after** `awm init` | (fixed) profile wasn't bootstrapped on zero-extension repos | `awm update` to rebuild the CLI, then `awm init` |
| New session doesn't show `using-awm` in context | session opened before the wiring existed | Claude: `/clear` or restart · OpenCode: start a new session |
| Sensors never run after an edit (Claude) | `PostToolUse` hook not installed | `awm sensors install` |
| Sensors don't run after edits (OpenCode) | **by design** — OpenCode has no hooks | they run at the completion gate via `awm sensors run` |
| `awm sensors status` says a tool is "not installed locally" | `npx` tool missing from devDependencies | `npm i -D <tool>` |
| Sensor always red on a legacy repo | no baseline accepted yet | `awm sensors baseline` ([Part 5.3](#53-baseline-existing-debt-legacy-only)) |
| `DEGRADED` sensor that won't clear | config templated for a different tool version | ask the agent to run `setup-sensors` |
| Gate reports `generic` / nothing ran on a real stack | stack appeared after `awm init` | just run `awm sensors run` once — it self-upgrades; never reports false green |
| A skill isn't in the agent's catalog | baseline pack not installed | re-run `awm init` (installs the `dev` baseline) |
| OpenCode isn't receiving `CONSTITUTION.md` | repo-local `opencode.json` missing the entry | re-run `awm init --agent opencode` (it wires it when `CONSTITUTION.md` exists) |

---

## What's next

- [architecture.md](architecture.md) — how AWM routes artifacts between the registry and your local install.
- [cli-reference.md](cli-reference.md) — the full `awm` command surface and non-interactive flags.
- [registry-guide.md](registry-guide.md) — author your own skills and packs.
