# AWM Runbook

The complete operating manual for AWM: install it, wire a project, use it day to day,
set it up for a team, and extend it with your own content.

---

## Who this is for

**Individual developer** — you want AWM running on your machine and wired into one or more repos. Start with [Chapter 1](#chapter-1--install--machine-setup) and follow [Chapter 2](#chapter-2--project-setup).

**Team lead setting up a shared registry** — you want every engineer on the team to share the same skills, sensor packs, and rules. After completing Chapters 1-2 yourself, go to [Chapter 4](#chapter-4--team-setup--customization).

**Contributor authoring skills or packs** — you want to create new skills, sensor packs, or registry bundles. Go to [Chapter 5](#chapter-5--extensibility-authoring-content).

---

## Mental model

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

## Chapter 1 — Install & machine setup

### 1.1 Prerequisites

- `git`, `node`, `npm` on your `$PATH`.
- A working directory that is a git repo. If it isn't one yet: `git init`.
- **macOS or Linux.** Windows is not supported natively (symlinks + Unix paths); use [WSL](https://learn.microsoft.com/en-us/windows/wsl/) instead.

### 1.2 Install the CLI

```bash
npm i -g agentic-workflow-manager
awm --help        # verify it's on PATH
```

This installs the `awm` binary globally. **Nothing is wired into any agent yet** — that happens in [Chapter 2](#chapter-2--project-setup) with `awm init`. This step is machine-wide; you do it once, not per repo.

`awm init` will seed `~/.awm/registries/baseline/` by cloning [`awm-baseline-registry`](https://github.com/Kodria/awm-baseline-registry) the first time it runs.

### 1.3 Keeping the CLI itself up to date

The CLI and content (registries) are updated separately — this is an important distinction:

- **To update the CLI binary** (new `awm` commands, bug fixes in the tool itself):
  ```bash
  npm i -g agentic-workflow-manager@latest
  ```

- **To update content** (skills, sensor packs, registry bundles):
  ```bash
  awm update
  ```
  `awm update` pulls the latest content from each configured registry clone. It does **not** update the CLI binary — those are delivered via npm.

After `awm update`, re-run `awm init` to reconcile the wiring to any new defaults (it's idempotent).

---

## Chapter 2 — Project setup

### 2.1 Bootstrap: `awm init`

Run **inside the repo**. Pick your agent:

```bash
awm init                    # Claude Code (the default)
awm init --agent opencode   # OpenCode
```

Flags: `--machine-only` (bootstrap only the global layer, no project changes) · `--yes` (skip prompts, for scripts) · `--json` (machine-readable outcome).

**What `awm init` does in one idempotent pass:**

- **Machine layer:** syncs the registry cache · installs the agent's context mechanism (Claude: `SessionStart` hook; OpenCode: `instructions[]` in the global `opencode.json`) · installs the **baseline skill pack** (`dev`) — the full spine: `using-awm`, `development-process`, `brainstorming`, `writing-plans`, `subagent-driven-development`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `post-implementation-qa`, `harness-retro`, `setup-sensors`, `project-constitution`, `project-context-init`, and more.
- **Project layer:** bootstraps `.awm/profile.json` · detects your stack and writes `.awm/sensors.json` (+ copies the pack's config files) · for OpenCode, wires `CONSTITUTION.md` into the repo-local `opencode.json` once that file exists.

**What `awm init` deliberately leaves for you** — it flags these, it does not do them, because each needs an agent or a choice:

| Left for you | How to do it |
|---|---|
| `CONSTITUTION.md` (the repo's rules) | run the `project-constitution` skill through the agent |
| Agent context (`AGENTS.md` / `CLAUDE.md`) | run the `project-context-init` skill through the agent |
| Per-edit fast-sensor trigger **(Claude only)** | `awm sensors install` |

### 2.2 Read the state: `awm doctor`

```bash
awm doctor
```

```text
AWM · estado del harness

Machine (global)
  ✔ CLI v2.x.x
  ✔ hook SessionStart
  ✔ dev-core (baseline)
  ✔ global skills

Project: my-repo
  ✔ .awm/profile.json
  ✔ active bundles
  ✔ sensors
  ✖ CONSTITUTION.md absent        → skill: project-constitution
  ⚠ agent context absent          → skill: project-context-init
```

Glyphs: `✔` healthy · `⚠` advisory (does not degrade) · `✖` missing (degrades state). Every non-`✔` row carries its **own remedy** — a command (`→ awm …`) or a skill to ask the agent to run (`→ skill: …`).

**A `✖ CONSTITUTION.md absent` row is not a bug.** It is `init` telling you the next step requires the agent. A fresh repo is *expected* to read degraded until you run those skills — that is the normal starting state, not an error.

### 2.3 Track A — greenfield

For **new repos with no existing stack**. Pick your scenario and follow the ordered list. Each line is a real command or a plain-language prompt to your agent.

```text
 1. npm i -g agentic-workflow-manager      # install AWM (once per machine)
 2. cd <your-repo>                         # a git repo (run `git init` if needed)
 3. awm init                               # or: awm init --agent opencode
 4. awm doctor                             # confirm machine layer is green
 5. (reload the agent session)             # Claude: /clear or restart · OpenCode: new session
 6. ask agent: "Generá la CONSTITUTION.md con project-constitution."
 7. ask agent: "Inicializá el contexto del proyecto con project-context-init."
 8. (reload the agent session again)       # so it starts receiving CONSTITUTION.md
 9. awm sensors install                    # (Claude only) per-edit fast-sensor trigger
10. ready — give your first development prompt
```

On a brand-new repo with no stack files yet (`package.json`/`pyproject.toml`), sensors start as the `generic` pack. **That is fine and self-correcting**: the first time `awm sensors run` executes over a tree that now has a real stack, it auto-upgrades the manifest to the right pack (tsc/lint/test). You never have to re-detect by hand.

### 2.4 Track B — legacy

For **existing codebases with a real stack and pre-existing debt**. Same spine as Track A, plus two extra steps (6 and 9) because an existing codebase has a real stack and pre-existing debt from day one:

```text
 1. npm i -g agentic-workflow-manager      # install AWM (once per machine)
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
12. ready — give your first development prompt
```

**Why the two extra steps on legacy?** Step 6: an existing project pins specific tool versions, so the templated sensor configs may need adapting before the gate is trustworthy. Step 9: a mature codebase has pre-existing findings — `awm sensors baseline` snapshots them as *accepted*, so the gate fails only on **new** problems you introduce, not on inherited debt. On greenfield there is no debt to baseline, so you skip both.

### 2.5 Load the agent context

After `awm init`, trigger a fresh context load so the wiring takes effect:

- **Claude Code:** `/clear`, or restart the session. The `SessionStart` hook injects `using-awm` (and `CONSTITUTION.md` once it exists).
- **OpenCode:** start a new session. The `instructions[]` entries in `opencode.json` load each session.

Confirm it worked — ask the agent: *"¿qué skills de AWM tenés disponibles?"* It should reference `development-process` and the spine skills. If it does not, see [Troubleshooting](#troubleshooting).

### 2.6 Constitution & agent context files

These run **through your agent**, in the session you just loaded. Ask in plain language; the agent invokes the skill.

**Generate `CONSTITUTION.md`:**

`CONSTITUTION.md` holds the repo's **non-negotiable rules**. AWM delivers it into every session automatically (Claude: hook; OpenCode: repo-local `opencode.json`).

> *"Generá la `CONSTITUTION.md` con `project-constitution`."*

The skill reads `CLAUDE.md`/`AGENTS.md`/`README`/`.awm/sensors.json`, drafts the rules section by section (with your approval), writes the file at the repo root, and commits it. **After it exists, reload the session** (see [2.5](#25-load-the-agent-context)) so the agent starts receiving it.

**Generate the agent context file:**

`AGENTS.md` (agent-agnostic, preferred) or `CLAUDE.md` (Claude-specific) **describes** the repo — purpose, structure, commands. The split is deliberate: **rules → `CONSTITUTION.md`; description → `AGENTS.md`.**

> *"Inicializá el contexto del proyecto con `project-context-init`."*

Prefer `AGENTS.md` — every agent reads it. Use `CLAUDE.md` only for Claude-specific notes.

### 2.7 Sensors: the quality gate

Sensors are **deterministic computational checks** (tsc, ESLint, Semgrep, test runner, …) whose output is LLM-readable. They are the project's quality gate. `awm init` already wrote `.awm/sensors.json` and copied the pack configs — these steps make the gate **trustworthy**.

> **Are sensors agnostic? — Yes.**
>
> **The checks and the completion gate are 100% agent-agnostic.** `awm sensors run` executes the exact same tsc/eslint/semgrep/tests on Claude, OpenCode, or any agent. There is **no** "Claude-only sensor."
>
> What *is* Claude-only is the **automatic per-edit trigger** — a `PostToolUse` hook (see step 9/11 in the tracks above). It is a matter of **cadence, not coverage**:
>
> | | Per-edit fast feedback | Full gate at "done" |
> |---|---|---|
> | **Claude Code** | hook runs fast sensors after each edit | `awm sensors run` |
> | **OpenCode** | — (no hooks exist) | `awm sensors run` |
>
> Both agents enforce the **same floor** at the completion gate (driven by `verification-before-completion`). Claude additionally gets a tighter, earlier feedback loop. Installing the hook does **not** make sensors "Claude-only" — it only adds an *extra, earlier* check on Claude.

**Check sensor health:**

```bash
awm sensors status
```

- `HEALTHY` — ready.
- `DEGRADED` — the templated config does not match your installed tool versions (common on legacy repos).
- `NOT_CONFIGURED` — no manifest yet (should not happen after `awm init`).

**Adapt the configs (mostly legacy):**

If `status` shows `DEGRADED`, ask the agent:

> *"Adaptá los sensors con `setup-sensors`."*

Also: tools that run via `npx` (eslint, depcruise, …) must be **devDependencies**, or `npx` fetches them remotely and `status` reports them as not installed. Fix with `npm i -D <tool>`.

**Baseline existing debt (legacy only):**

A mature codebase has pre-existing findings. Snapshot them as **accepted** so the gate fails only on **new** findings you introduce — then commit the snapshot so the whole team shares the ratchet:

```bash
awm sensors baseline      # writes .awm/sensors.baseline.json — commit it
```

Skip this on greenfield — there is no debt to accept. The baseline is a *manual* snapshot you re-take deliberately when you want to move the ratchet; it never updates itself.

**(Claude only) Add the per-edit fast-sensor trigger:**

```bash
awm sensors install
```

This installs the `PostToolUse` hook so fast sensors (tsc/eslint) run automatically after each file edit. OpenCode has no hooks, so it has nothing to install here — it runs the same sensors at the completion gate instead.

**How the gate stays honest:**

`awm sensors run` **re-detects your stack on every run**. If the manifest is still on the `generic` fallback but your tree now has a real stack, it auto-upgrades to the right pack. And if a run executed nothing real over a tree that clearly has a stack, it refuses to report green (`not_certified`) instead of a false pass. This is why greenfield Track A works without any manual re-detection.

### 2.8 Ready checklist

You are ready when **all** of these hold:

- [ ] `awm doctor` — machine layer all `✔`.
- [ ] `CONSTITUTION.md` exists and the session was reloaded after it was created.
- [ ] Agent context (`AGENTS.md`/`CLAUDE.md`) exists.
- [ ] `awm sensors status` — `HEALTHY` (and on legacy, a committed baseline).
- [ ] **(Claude only)** `awm sensors install` done.

Now just describe the work in plain language. Your default entry point for any development is the **`development-process`** orchestrator — you do not pick the skill, *it* reads project state and routes the phases:

```text
brainstorming → writing-plans → subagent-driven-development → post-implementation-qa → harness-retro → finishing-a-development-branch
```

---

## Chapter 3 — Day-to-day in a project

### 3.1 The development loop

AWM plugs into your work via the `development-process` skill — a lightweight orchestrator you invoke by describing what you want to build. It reads project state and routes you through the correct phases automatically:

```
brainstorming → writing-plans → subagent-driven-development → post-implementation-qa → harness-retro → finishing-a-development-branch
```

Cross-cutting skills kick in within phases: `test-driven-development` (write the test first), `systematic-debugging` (root-cause before fixing), `verification-before-completion` (run sensors before declaring done).

To start any development task, just describe it in plain language — `development-process` decides what's next.

### 3.2 What happens automatically

| Trigger | Claude Code | OpenCode |
|---|---|---|
| New session in the repo | `SessionStart` hook injects `using-awm` + `CONSTITUTION.md` | `instructions[]` load the global AWM context + project `CONSTITUTION.md` |
| Agent edits a file | `PostToolUse` hook runs fast sensors (tsc/lint), surfaces findings | — (no per-edit hook; caught at the gate) |
| Agent about to declare "done" | `verification-before-completion` runs `awm sensors run` and reads the output | **same** |
| Same sensor fails a 2nd time | the skill recommends `harness-retro` to turn it into a structural rule | **same** |

The common thread: **recurrence becomes a rule, not a repeated symptom fix.**

### 3.3 The quality gate in practice

The project's quality gate is `awm sensors run` (no flag — runs all sensors). Here is how to use it:

- **Per-edit (Claude Code only):** fast sensors (tsc/lint) run automatically after each file edit via the `PostToolUse` hook. This is early feedback, not the gate.
- **Completion gate (all agents):** before declaring a task done, the `verification-before-completion` skill runs `awm sensors run` (all sensors, no flag) and reads `overall`. Only `overall: "pass"` counts as green.
- **Do not use `--slow` as the gate.** `awm sensors run --slow` runs only semgrep/mutation and skips lint/typecheck, where most findings surface.
- **Baseline ratchet:** `awm sensors baseline` snapshots current findings as accepted. Re-take it deliberately when you want to move the ratchet forward (e.g. after a debt-reduction sprint). It never updates itself.

### 3.4 The learning loop

AWM builds institutional memory per branch without bloating your context:

- During development, skills append wins and findings to a per-branch **ledger** (`awm ledger`) — ephemeral working memory, gitignored, never injected into agent context.
- At the end of a branch, **`harness-retro`** reads the ledger and *cures* recurring lessons into durable docs:
  - Structural / security / logic findings → the remediation tree (`eslint.config.awm.mjs`, `.semgrep.awm.yml`, `tests/structural/`)
  - Process lessons → `CONSTITUTION.md`
  - Agent working-style lessons + wins → `AGENTS.md`

You rarely touch `awm ledger` directly. Inspect it if curious: `awm ledger list` / `awm ledger recurring --min 2`.

> **Project-specific vs framework rules.** Rules born from a bug in *your* repo live in *your* repo (grown by `harness-retro` into your config files / `CONSTITUTION.md`). Only universally-avoidable patterns (e.g. "never `eval`") belong in the AWM registry. AWM ships the *mechanism*, not your project's bug list.

### 3.5 Update cadence

Keep your installed content current without over-running updates:

| What | When | Command |
|---|---|---|
| Team registry content (new skills, fixes) | When a teammate cuts a release, or at the start of a sprint | `awm update` |
| Machine harness health | When something feels off | `awm doctor` |
| Re-run project init | After a large `awm update` that adds new defaults | `awm init` (idempotent — safe to re-run) |
| CLI itself | When a new AWM CLI version ships | `npm i -g agentic-workflow-manager@latest` (separate from `awm update`) |

---

## Chapter 4 — Team setup & customization

### 4.1 The team model

AWM supports a self-service team workflow:

```
senior authors a skill → PR to team registry → tagged release vX.Y.Z → teammates run awm update to receive it
new developer → git clone → awm init → awm sync → awm doctor → ready
```

Skills live in a git repo (the team registry). You author them, tag a release, and every teammate's `awm update` pulls the new version. A new developer joins by cloning the project, running three commands, and their machine is fully wired — no manual file copying, no shared drives.

### 4.2 Create your team registry

A registry is a git repo with this minimum structure:

```
<registry-repo>/
├── skills/
│   └── <skill-name>/
│       └── SKILL.md
├── bundles/
│   └── <bundle-name>/
│       └── bundle.json
└── catalog.json
```

`catalog.json` declares the bundles:

```json
{
  "version": 1,
  "bundles": [
    { "name": "dev", "source": "bundles/dev", "version": "1.0.0", "scope": "baseline" }
  ]
}
```

The registry can be **public or private** from day one. SSH remotes work the same as any git repo (see §4.4).

### 4.3 Wire it: awm registry add

Register an additional registry on your machine:

```bash
awm registry add <git-url>               # prompts for a name
awm registry add <git-url> --name <name> # skip the prompt
awm registry add <git-url> --install-all # install every bundle after cloning
awm registry add <git-url> --no-install  # clone only, skip bundle install
```

AWM clones the registry under `~/.awm/registries/<name>/` and registers it in the machine config. Once added, `awm update` keeps it in sync alongside the baseline.

> **Tip:** If your registry has no semver tags yet (a common starting state for new team registries), `awm update` reports `updated @ HEAD` and syncs to the latest commit. Add a tag when you're ready to version your releases.

Inspect and remove registries:

```bash
awm registry list                # list all configured registries
awm registry remove <name>       # remove registry config + clone (-y to skip confirmation)
```

### 4.4 Private registries (SSH)

Use an SSH remote for private repositories:

```bash
awm registry add git@github.com:your-org/your-registry.git
```

Clone and fetch run through git, so your `ssh-agent` and `~/.ssh/config` apply exactly as with any git repository. No AWM-specific configuration needed.

**If access fails:** AWM reports a git authentication error and exits cleanly. It does not hang waiting for credentials. In CI or headless environments, export `GIT_TERMINAL_PROMPT=0` before running any `awm` command that touches git — this tells git to fail immediately instead of prompting for a username/password:

```bash
GIT_TERMINAL_PROMPT=0 awm registry add <url>
```

A failed `awm registry add` leaves no clone on disk and no entry in the machine config (atomic — either it works or nothing changes).

> **Note:** `awm registry add` against a truly non-existent or inaccessible repository exits cleanly in ~2 seconds with a `Clone failed:` prefix, leaving no partial files or config entries behind.

### 4.5 Version pinning

By default, `awm update` checks out the latest semver tag in each registry (the **stable channel**). To lock a project to a specific version:

```bash
awm pin <registry> <version>    # e.g. awm pin baseline 1.0.0
awm unpin <registry>             # return to latest-tag behavior
```

The pin is stored in `.awm/profile.json` under the `registries` map:

```json
{
  "extensions": ["frontend"],
  "registries": {
    "baseline": "1.0.0"
  }
}
```

**Commit `.awm/profile.json`.** The whole team is pinned as soon as they pull — the pin is a project contract, not a per-machine preference. After committing a pin, `awm update` in any teammate's sandbox respects it.

### 4.6 The shared profile: .awm/profile.json

`.awm/profile.json` is the project's AWM configuration:

```json
{
  "extensions": ["frontend"],
  "registries": {
    "baseline": "1.1.0"
  }
}
```

| Field | What it does |
|---|---|
| `extensions` | Skill bundles installed for the project (names from your registries' catalogs) |
| `registries` | Version pins per registry (omit a registry to use the latest tag) |

**Commit this file.** It is the onboarding contract — a new developer's `awm sync` reads it and materializes the correct symlinks for every declared extension.

### 4.7 Onboarding a new developer

A developer joining the project:

```bash
npm i -g agentic-workflow-manager   # 1. install AWM CLI (once per machine)
git clone <project> && cd <project> # 2. clone the project
awm init                            # 3. machine layer + reads the committed profile
awm sync                            # 4. materializes skill symlinks the profile declares
awm doctor                          # 5. verify everything is green
```

After step 5, the developer has the same skill set as every other teammate. No manual file copying, no registry access needed beyond what the profile declares.

> `awm sync` is a no-op if `.awm/profile.json` declares no extensions — it completes silently. It becomes necessary once a teammate has run `awm add <bundle>` to add project extensions; the sync materializes those symlinks on a fresh machine.

---

## Chapter 5 — Extensibility: authoring content

### 5.1 Registry layout

A registry is a git repo with this directory structure:

```
<registry>/
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md          # required
│       ├── scripts/          # optional helper scripts
│       └── examples/         # optional implementation references
├── bundles/
│   └── <bundle-name>.json
├── sensor-packs/
│   └── <pack-name>/          # eslint/semgrep configs
├── hooks/                    # agent hook files
└── catalog.json              # registry manifest
```

### 5.2 Anatomy of a skill

A skill is a `SKILL.md` file with a YAML frontmatter block and a Markdown body:

```yaml
---
name: your-skill-name
description: >
  Short definition (1-3 sentences) explaining WHEN the agent should use this skill.
  Written from the agent's perspective: "Use when…", "Invoke when…"
---

# Your Skill Title

Detailed Markdown instructions. Use `<HARD-GATE>` XML tags to enforce strict rules on the agent.
```

The `description` frontmatter is parsed by `awm list` to show the skill's purpose. Write it as a trigger: the agent reads it to decide when to invoke the skill.

### 5.3 Anatomy of a workflow

A workflow is a Markdown file under `skills/workflows/<name>.md`:

```yaml
---
description: Short title describing what this workflow achieves
---

# My Workflow Title

1. Step one instructions.
// turbo
2. Step two instructions (`// turbo` tells the agent to auto-run this step's shell commands if safe).
```

The filename becomes the `/slash-command` used to invoke it.

### 5.4 Defining bundles

Bundles let users install a collection of skills in one shot instead of individually.

Create `bundles/<bundle-name>.json`:

```json
{
  "name": "domain-docs",
  "description": "Essential skills for documenting domain service architectures.",
  "artifacts": [
    { "type": "skill", "name": "documenting-modules" },
    { "type": "skill", "name": "business-documenting-modules" }
  ]
}
```

Then `awm add domain-docs` installs all artifacts. Declare bundles in `catalog.json` (see §4.2) so `awm init` can install them automatically.

### 5.5 Releasing a version

The team release cycle (connect this with §4.1):

1. Author a skill (or fix an existing one) in the registry repo.
2. Commit and push to the main branch.
3. Tag the release: `git -c tag.gpgSign=false tag vX.Y.Z && git push --tags`
4. Teammates run `awm update` — they receive the new version.

The `git -c tag.gpgSign=false` flag suppresses GPG signing (not needed for registry tags, and avoids errors on machines without a signing key configured).

The **stable channel** always resolves to the latest semver tag, so untagged commits on main are not distributed until you tag them. This gives you a staging area: merge your changes, then tag when you're ready to distribute.

### 5.6 Mutation testing (opt-in)

The `js-ts` sensor-pack ships a `mutation` sensor (Stryker) **disabled by default** (`enabled: false`): mutation runs are slow and noisy as a per-commit gate, so AWM treats them as an opt-in tool for critical paths.

To enable it in a project, edit `.awm/sensors.json`:

```json
{
  "sensors": {
    "mutation": { "enabled": true }
  }
}
```

Keep only the `mutation` entry — the rest of the file stays as generated by `awm sensors init`. Scope Stryker to critical paths via its own config (`stryker.conf.json`) to keep run times manageable.

Once enabled, mutation runs on every `awm sensors run` (the full gate). Use `awm sensors run --slow` to run only slow sensors (mutation + semgrep) and skip fast ones (typecheck, lint, test).

### 5.7 Contributing to the default registries

AWM ships two public registries:

- [`awm-baseline-registry`](https://github.com/Kodria/awm-baseline-registry) — the baseline skill pack seeded by default on `awm init`
- [`awm-documentation-registry`](https://github.com/Kodria/awm-documentation-registry) — documentation-focused skills (opt-in: `awm registry add https://github.com/Kodria/awm-documentation-registry.git`)

To contribute, open a PR in the relevant registry repo. This CLI repo (`agentic-workflow-manager`) does **not** contain content — it only contains the CLI tool.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `awm: command not found` | npm global bin not on PATH, or npm package not installed | `npm i -g agentic-workflow-manager` and ensure `npm bin -g` is on your `$PATH` |
| `awm doctor` shows `✖ .awm/profile.json → awm init` right after `awm init` | (fixed) profile was not bootstrapped on zero-extension repos | `awm update` to get latest content, then `awm init` |
| New session does not show `using-awm` in context | session opened before the wiring existed | Claude: `/clear` or restart · OpenCode: start a new session |
| Sensors never run after an edit (Claude) | `PostToolUse` hook not installed | `awm sensors install` |
| Sensors do not run after edits (OpenCode) | **by design** — OpenCode has no hooks | they run at the completion gate via `awm sensors run` |
| `awm sensors status` says a tool is "not installed locally" | `npx` tool missing from devDependencies | `npm i -D <tool>` |
| Sensor always red on a legacy repo | no baseline accepted yet | `awm sensors baseline` |
| `DEGRADED` sensor that will not clear | config templated for a different tool version | ask the agent to run `setup-sensors` |
| Gate reports `generic` / nothing ran on a real stack | stack appeared after `awm init` | just run `awm sensors run` once — it self-upgrades; never reports false green |
| A skill is not in the agent's catalog | baseline pack not installed | re-run `awm init` (installs the `dev` baseline) |
| OpenCode is not receiving `CONSTITUTION.md` | repo-local `opencode.json` missing the entry | re-run `awm init --agent opencode` (it wires it when `CONSTITUTION.md` exists) |

---

## See also

- [cli-reference.md](cli-reference.md) — full `awm` command surface and non-interactive flags.
- [architecture.md](architecture.md) — how AWM routes artifacts between the registry and your local install.
