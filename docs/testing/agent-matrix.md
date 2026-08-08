# Agent acceptance matrix

Only the **deltas per agent**. Run [core-acceptance.md](core-acceptance.md) first.

Each agent gets a different amount of AWM. That is a property of the target agent's architecture, not a defect — and the single most important thing this document does is tell you **what is supposed to degrade**, so you don't file a bug against a documented limitation.

## Where artifacts land

Verified against `cli/src/providers/index.ts`.

| Agent | Skills (global) | Skills (project) | Rendered as | Context injection |
|---|---|---|---|---|
| `claude-code` | `~/.claude/skills/` | `.claude/skills/` | symlink | `~/.claude/settings.json` (hook) |
| `codex` | `~/.agents/skills/` | `.agents/skills/` | symlink | managed `AGENTS.md` (+ `~/.codex/AGENTS.md`) |
| `opencode` | `~/.agents/skills/` | `.agents/skills/` | symlink | `~/.config/opencode/opencode.json` |
| `cursor` | `~/.cursor/rules/` | `.cursor/rules/` | `.mdc` file | managed `AGENTS.md` (project only) |
| `copilot` | **not supported** | `.github/instructions/` | `.instructions.md` | managed `AGENTS.md` (project only) |
| `antigravity` | `~/.agents/skills/` | `.agents/skills/` | symlink | none |

`copilot` has no global scope on purpose: GitHub Copilot has no user-level skill-discovery mechanism, so skills must be installed per project. `awm add -a copilot --scope global` must fail with **that explanation**, not a generic error.

## What each tier gives you

| Tier | Agents | Skills load | Hooks fire | Phase gates enforce |
|---|---|---|---|---|
| hooks-native | `claude-code`, `codex` | yes | yes | yes |
| config-managed | `opencode` | yes | no | context only |
| agents-md-managed | `cursor`, `copilot` | yes (rendered) | no | context only |
| context-only | `antigravity` | yes | no | context only |

"Context only" means the process discipline is *read* by the agent rather than *enforced* by the harness. The deterministic part — `awm sensors run` — works identically for every agent, because it's a real command with a real exit code.

---

## Per-agent checks

Substitute `<agent>` and run in a scratch project (setup as in core-acceptance).

### Common to every agent

**AG-01 · The agent is recognised**
```bash
awm doctor --json -a <agent>
```
**Expect:** exit `0`; a `providers` entry for `<agent>` with the `tier` from the table above.

**AG-02 · Bootstrap for this agent**
```bash
awm init -a <agent> --yes --json > init-<agent>.json
```
**Expect:** `failed: 0`.
**Legitimate exception:** exit `2` with a message that the agent's binary is missing or below its minimum version — that is a **correct refusal**, record it as PASS with a note. `codex` requires ≥ `0.145.0`.

**AG-03 · Install a skill for this agent**
```bash
awm add development-process --type skill --scope local --method symlink --agent <agent> --yes
```
**Expect:** exit `0`, and the artifact present at the project path from the table.

**AG-04 · The rendered artifact is well-formed**

Open the file that AG-03 produced:

- symlink agents → the link resolves to `$AWM_HOME/registries/baseline/skills/development-process`
- `cursor` → `.cursor/rules/development-process.mdc` starts with valid YAML frontmatter (`description`, `globs`, `alwaysApply: false`)
- `copilot` → `.github/instructions/development-process.instructions.md` starts with `applyTo: "**"`

**Expect:** no literal `>-`, `|-`, `undefined`, or empty `description:` anywhere in the frontmatter.

**AG-05 · Install the whole frontend bundle** (exercises every renderer at once)
```bash
awm add frontend --agent <agent> --yes
```
**Expect:** exit `0` and ~30 artifacts. This is the check that caught two real crashes historically — a bundle exercises far more shapes than a single skill.

**AG-06 · The agent actually sees the context** *(manual, needs the real binary)*

Start a fresh session in the agent, in the project. Ask it: *"which AWM skills do you have available, and what does the development-process skill tell you to do first?"*

**Expect by tier:**
- hooks-native → names real installed skills and describes the orchestration
- config-managed / agents-md-managed / context-only → at minimum has the project context (`AGENTS.md` / rules) and can quote from it

**FAIL** if it has no idea AWM exists at all. That means delivery didn't reach the agent, which is the whole point of the tool.

---

### `claude-code` extras

**CC-01 · The SessionStart hook is registered**
```bash
awm hooks status
```
**Expect:** the hook present in `~/.claude/settings.json` under `SessionStart` with matcher `startup|clear|compact`.

**CC-02 · The hook survives a settings edit**
Add an unrelated key to `~/.claude/settings.json` by hand, then `awm init --yes`.
**Expect:** your key is still there. AWM merges into that file; it must never clobber user content.

### `codex` extras

**CX-01 · Version gate**
```bash
codex --version && awm init -a codex --yes --json
```
**Expect:** with ≥ `0.145.0`, `failed: 0`. Below it, a clean exit `2` naming the minimum.

**CX-02 · Agent profile renders as TOML**
```bash
awm add development-process --type agent --scope local --agent codex --yes
```
**Expect:** `.codex/agents/development-process.toml`, parseable as TOML, with the description intact.

### `cursor` extras

**CU-01 · No global context file is invented**
```bash
awm doctor --json -a cursor
```
**Expect:** the global-context check reports N/A or unsupported — **not** an error, and not a path AWM made up. Cursor's user rules live in app settings, not on disk.

### `copilot` extras

**CP-01 · Global scope is refused with a reason**
```bash
awm add development-process --type skill --scope global --agent copilot --yes
```
**Expect:** a clear failure naming *why* (no user-level skill discovery in Copilot). A generic stack trace is a **FAIL**.

**CP-02 · Project install still works**
Re-run with `--scope local`.
**Expect:** exit `0`, file under `.github/instructions/`.

### `opencode` extras

**OC-01 · Instructions land in the config**
```bash
cat ~/.config/opencode/opencode.json
```
**Expect:** an `instructions` field referencing AWM's managed content, with any pre-existing config preserved.

### `antigravity` extras

**AN-01 · Honest tier reporting**
```bash
awm doctor --json -a antigravity
```
**Expect:** tier `context-only`, and **no** hook or injection check reported as failing — it has neither mechanism, so "missing" would be a false alarm.

---

## Result sheet

| Agent | AG-01 | AG-02 | AG-03 | AG-04 | AG-05 | AG-06 | Extras | Notes |
|---|---|---|---|---|---|---|---|---|
| claude-code |  |  |  |  |  |  | CC-01 CC-02 |  |
| codex |  |  |  |  |  |  | CX-01 CX-02 |  |
| opencode |  |  |  |  |  |  | OC-01 |  |
| cursor |  |  |  |  |  |  | CU-01 |  |
| copilot |  |  |  |  |  |  | CP-01 CP-02 |  |
| antigravity |  |  |  |  |  |  | AN-01 |  |

Record **BLOCKED** for any agent whose binary you don't have. Do not infer a result from another agent's outcome — the bugs this suite exists to catch are precisely the ones that only appear on one provider's path.
