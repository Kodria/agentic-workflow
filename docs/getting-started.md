# Getting Started

How to go from "AWM installed" to "the full Harness Engineering loop is running in my project."

This guide assumes you've already installed AWM (see the README). If not, run the install script first.

## Prerequisites

- `git`, `node`, `npm` available on your `$PATH`
- AWM installed (`awm --help` works)
- A working directory inside a git repo where you want to use the system

## 1. Install the hooks (one time, per machine)

AWM uses two hooks, both registered in `~/.claude/settings.json`. Install both once.

**1a. SessionStart hook (feedforward).** Injects the `using-awm` skill (and the project's `CONSTITUTION.md` when present) into every Claude Code session:

```bash
awm hooks install
awm hooks status   # expect HEALTHY + four ✓ (bootstrap skill, session-start, run-hook wrapper, settings entry)
```

**1b. PostToolUse hook (automatic feedback).** Runs the project's **fast** sensors (tsc/eslint) after each file edit and surfaces the output to Claude. **Without this hook, sensors never run automatically** — they only run when you invoke them or when `verification-before-completion` does. This is the step that makes Section 4's "automatic" behavior real:

```bash
awm sensors install
```

After both, **restart Claude Code** (or run `/clear`) so the SessionStart hook fires. From this point on, every new session loads `using-awm` + `CONSTITUTION.md`, and edits trigger the fast sensors automatically.

## 2. Install the core skill pack (one time, per machine)

```bash
awm add core-dev
```

This installs the full set of development skills into `~/.claude/skills/`, including:

- `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`
- `test-driven-development`, `systematic-debugging`, `verification-before-completion`
- `setup-sensors`, `project-constitution`, `harness-retro` (the Harness Engineering skills)
- `development-process` (the orchestrator that routes between phases)

You can check what got installed:

```bash
ls ~/.claude/skills/
```

## 3. Configure a project (first time in each repo)

When you enter a new repository where you want the full loop, do this once:

### 3.1. Bootstrap sensors

Sensors are computational checks (tsc, ESLint, Semgrep, etc.) that produce LLM-readable output. AWM detects your stack and writes `.awm/sensors.json` plus the pack's config files (eslint/semgrep/dep-cruiser). It also detects your source layout, so `depcheck` targets the dirs that actually exist (`src/`, or App-Router-style `app/ lib/ components/`):

```bash
awm sensors init          # writes the manifest + copies config files by default (--no-configure to skip)
awm sensors status
```

> Tools that run via `npx` (eslint, depcruise) must be installed as **devDependencies** — otherwise `npx` fetches a remote package at run time and `status` reports the sensor as not installed. Run `npm i -D <tool>` for any sensor flagged this way.

Read the status output:

- `HEALTHY` — sensor is configured correctly and ready to run.
- `DEGRADED` — config file is present but failing checks (usually a version mismatch).
- `NOT_CONFIGURED` — no manifest entry for this sensor.

### 3.2. Adapt sensor configs (only if DEGRADED)

If `awm sensors status` reports any sensor as `DEGRADED`, the templated configs don't match your actual installed tool versions. Ask Claude to fix it:

> "Adaptá los sensors con `setup-sensors`"

Claude will invoke the `setup-sensors` skill, which:

1. Reads the actual installed versions (`eslint --version`, `npx tsc --version`, etc.)
2. Consults Context7 for current docs on those specific versions
3. Proposes minimal extensions to the config files (one at a time, with your approval)
4. Validates with `awm sensors status` until everything is `HEALTHY`

### 3.3. Generate the project constitution

The `CONSTITUTION.md` file at the repo root holds the non-negotiable rules for the project. The `SessionStart` hook injects this file into every Claude Code session as feedforward context. Generate it:

> "Generá la `CONSTITUTION.md` con `project-constitution`"

Claude will invoke the `project-constitution` skill, which:

1. Reads `CLAUDE.md` / `AGENTS.md` / `README` if present
2. Reads `.awm/sensors.json` to include sensor-related rules
3. Drafts the constitution section by section with your approval
4. Writes `CONSTITUTION.md` at the repo root and commits

### 3.4. Verify the setup

```bash
ls -la CONSTITUTION.md .awm/sensors.json
awm sensors status        # all HEALTHY
awm hooks status          # HEALTHY
```

### 3.5. Accept the existing debt (baseline — recommended on repos with history)

On a legacy repo a sensor may report thousands of pre-existing findings (e.g. ESLint). That makes it always-red — pure noise. Snapshot the current findings as an accepted **baseline** so sensors fail only on **new** ones:

```bash
awm sensors baseline      # writes .awm/sensors.baseline.json
```

Commit `.awm/sensors.baseline.json` to make the ratchet permanent and shared. From then on the existing debt is suppressed and any **new** finding fails the sensor. Skip this on a clean/greenfield repo — without the file, every finding counts (default behavior). See Section 7 to drive the debt down over time.

## 4. What happens automatically (day-to-day)

Once configured, the system works without you invoking anything explicitly:

| Trigger | What runs |
|---|---|
| You open Claude Code in the repo | SessionStart hook injects `using-awm` + `CONSTITUTION.md` into the initial context |
| Claude edits a file | PostToolUse hook runs the **fast** sensors (tsc/eslint) and surfaces findings — requires `awm sensors install` (Section 1b) |
| Claude is about to declare work "done" | `verification-before-completion` requires running `awm sensors run --slow` and reading the output |
| The same sensor fails for the second time | The skill recommends invoking `harness-retro` to convert it into a structural rule |
| A `systematic-debugging` session finishes | The skill checks `docs/harness-retros.md` and recent `harness-retro:` commits; if the root cause is recurring, it proposes `harness-retro` |
| The code-quality reviewer detects the same flaw in ≥2 files | It names the pattern once and recommends `harness-retro` for a structural fix |
| You receive PR feedback that already came in a prior PR | `receiving-code-review` recommends `harness-retro` to promote the human-loop check into a rule |

The common thread: recurrence becomes a rule, not a repeated symptom fix.

## 5. What you invoke manually

| Need | Invocation |
|---|---|
| Configure sensors adapted to unusual versions | "Usá `setup-sensors`" |
| Generate or refresh the `CONSTITUTION.md` | "Usá `project-constitution`" |
| Convert a recurring bug into a harness rule | "Usá `harness-retro`" (or wait for cross-cutting skills to propose it) |
| Plan a new feature from scratch | "Usá `development-process`" — it orchestrates `brainstorming` → `writing-plans` → execution → close |
| See current sensor state | `awm sensors status` |
| Run all sensors manually | `awm sensors run --slow` (full) or `awm sensors run --fast` (tsc/eslint only) |
| Accept current findings as the baseline (ratchet) | `awm sensors baseline` — sensors then fail only on new findings |
| Sync the registry to the latest version on GitHub | `awm update` |
| Install a new pack or skill | `awm add <name>` |

## 6. Try it end-to-end

A short walkthrough you can run inside any repo to confirm the loop:

```bash
# 1. Restart Claude Code (or /clear) so the bootstrap fires
# 2. In the new session, ask Claude to set up the project:
"Generá la CONSTITUTION.md con project-constitution"

# 3. Once CONSTITUTION.md exists, configure sensors:
"Inicializá los sensors con awm sensors init, después adaptá lo que quede DEGRADED con setup-sensors"

# 4. Make a small change (e.g. a typo fix in any file), then:
"Verificá esto antes de declararlo done"
# → verification-before-completion will run `awm sensors run --slow` and only proceed if clean
```

If all three phases run end-to-end, the system is fully active in that project.

## 7. Reducing technical debt (the ratchet)

Once a baseline is in place (Section 3.5), the existing debt is suppressed and can only shrink — never grow. Drive it down incrementally:

1. **See the debt.** The baseline hides it from the sensors, so look with the tool directly:
   ```bash
   npm run lint        # all ESLint findings
   npm run typecheck   # all tsc findings
   ```
2. **Pick a slice** — one rule or one directory, not everything at once. Many lint findings are auto-fixable:
   ```bash
   npx eslint . --config eslint.config.awm.mjs --fix
   ```
   For non-mechanical fixes use `systematic-debugging`; if a change alters behavior, follow `test-driven-development`.
3. **Lower the floor.** Re-snapshot what remains so the fixed findings leave the accepted set (if they reappear, they now fail as "new"):
   ```bash
   awm sensors baseline
   ```
4. **Repeat.** Each pass lowers the baseline. When it reaches zero, the sensor is fully green with no suppressions.

If the same debt pattern keeps recurring, invoke `harness-retro` to turn it into a structural rule (lint rule, CONSTITUTION entry, or test) so it's prevented rather than repeatedly fixed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `awm: command not found` | Global symlink points at a missing `~/.awm/cli-source/cli` | Re-run the install script |
| `awm hooks status` reports gaps | SessionStart hook uninstalled or partial | `awm hooks install` |
| Sensors never run after Claude edits a file | PostToolUse hook not installed | `awm sensors install` |
| `awm sensors status` says a tool is "not installed locally" | `npx` tool missing from devDependencies | `npm i -D <tool>` |
| Sensor is always red on a legacy repo (huge pre-existing baseline) | No baseline accepted yet | `awm sensors baseline` (Section 3.5) |
| New session doesn't show `using-awm` in context | Session was opened before the hook was installed | `/clear` or restart Claude Code |
| `harness-retro`/`setup-sensors`/`project-constitution` not in skill catalog | The `core-dev` pack was never installed | `awm add core-dev` |
| `awm sensors status` reports DEGRADED that won't go away | Sensor config templated for a different version | Invoke the `setup-sensors` skill |
| Sensors aren't catching a recurring bug you keep hitting | Harness gap — you need a structural rule | Invoke `harness-retro` |
| Want to verify what was changed when wiring `harness-retro` into the cross-cutting skills | Patch records | See `~/.claude/skills/harness-retro/integrations/` |

## What's next

- Read [docs/architecture.md](architecture.md) to understand how AWM routes artifacts between the registry and your local install.
- Read [docs/cli-reference.md](cli-reference.md) for the full `awm` command surface.
- Read [docs/registry-guide.md](registry-guide.md) if you want to author your own skills or packs.
