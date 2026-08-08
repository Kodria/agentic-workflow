# Agent setup

AWM installs into whichever agent each developer already uses. Six are supported, and they do **not** get the same product — because they don't have the same capabilities.

> **The authoritative paths live in [support-matrix.md](support-matrix.md)**, generated from
> `cli/src/providers/index.ts` and locked by a test. If this page ever disagrees with it,
> the generated one wins — and the disagreement is a bug on this page.

This page is deliberately blunt about that. Promising uniform behaviour and then degrading silently is how a tool loses trust; knowing up front that Cursor won't fire hooks is far better than discovering it when a gate doesn't hold.

## Choosing: what each tier actually gives you

| Tier | Agents | Skills available | Session hooks | Phase gates enforced | Deterministic sensors |
|---|---|---|---|---|---|
| **hooks-native** | `claude-code`, `codex` | yes | yes | yes | yes |
| **config-managed** | `opencode` | yes | no | read, not enforced | yes |
| **agents-md-managed** | `cursor`, `copilot` | yes (rendered) | no | read, not enforced | yes |
| **context-only** | `antigravity` | yes | no | read, not enforced | yes |

The rightmost column is the point: **`awm sensors run` behaves identically for every agent**, because it's a real command with a real exit code. No model can talk its way past it. What varies is how much of the *process discipline* the harness can enforce versus merely deliver as context.

`awm doctor` prints each installed agent's tier, so nobody has to guess.

---

## `claude-code` — hooks-native

The reference target: everything AWM can do, it does here.

```bash
awm init            # claude-code is the default
awm doctor -a claude-code
```

**What gets installed**

| | Path |
|---|---|
| Skills (global) | `~/.claude/skills/` (symlinks into the registry clone) |
| Skills (project) | `.claude/skills/` |
| Agent profiles | `~/.claude/agents/` · `.claude/agents/` |
| Session hook | merged into `~/.claude/settings.json` |

**The hook** registers on `SessionStart` (matcher `startup|clear|compact`) and re-anchors the agent's context at the start of every session and after every compaction. That's what makes the process survive long conversations.

AWM **merges** into `settings.json` — your own keys are preserved. `awm backup` keeps a restorable copy of every rewrite.

```bash
awm hooks status    # is the hook registered?
```

## `codex` — hooks-native

Full parity with Claude Code, with a version floor.

```bash
codex --version               # must be >= 0.145.0
awm init -a codex
```

**What gets installed**

| | Path |
|---|---|
| Skills | `~/.agents/skills/` · `.agents/skills/` |
| Agent profiles | `~/.codex/agents/` · `.codex/agents/` — rendered as **TOML** |
| Session hook | `~/.codex/hooks.json` (`startup|resume|clear|compact`) |
| Context | managed `AGENTS.md` block (project) + `~/.codex/AGENTS.md` |

If Codex is below `0.145.0`, `awm init -a codex` refuses with exit `2` and names the minimum. That's a correct refusal, not a bug — upgrade Codex and re-run.

## `opencode` — config-managed

```bash
awm init -a opencode
```

| | Path |
|---|---|
| Skills | `~/.agents/skills/` · `.agents/skills/` |
| Agent profiles | `~/.config/opencode/agents/` · `.agents/profiles/` |
| Context | the `instructions` field in `~/.config/opencode/opencode.json` |

Skills load normally. There's no hook mechanism, so nothing re-anchors the context mid-session — after a long conversation or a compaction, ask the agent to re-read the process docs if it starts drifting.

## `cursor` — agents-md-managed

```bash
awm init -a cursor
```

| | Path |
|---|---|
| Skills | `~/.cursor/rules/` · `.cursor/rules/` — rendered as `.mdc` |
| Project context | managed `AGENTS.md` block |
| Global context | **none** |

Each skill renders as a Cursor rule with `alwaysApply: false`, so Cursor pulls it in **contextually** by description rather than force-loading every skill into every request. That's the right trade — but it means relevance depends on Cursor's own matching, so a skill may not activate when you expect.

There is deliberately **no global context path**: Cursor's user rules live inside its app settings, not as a file on disk. AWM won't invent a path it can't verify, so `awm doctor` reports that as N/A rather than as an error.

## `copilot` — agents-md-managed

```bash
awm init -a copilot
```

| | Path |
|---|---|
| Skills | **project only** — `.github/instructions/*.instructions.md` |
| Project context | managed `AGENTS.md` block |
| Global scope | **not supported** |

GitHub Copilot has no user-level skill discovery, so there is nothing for a global install to write to. `awm add -a copilot --scope global` fails **with that explanation**.

Instructions render with `applyTo: "**"`. Copilot's instruction format is file-glob triggered, which doesn't map onto trigger-phrase activation — `**` keeps the guidance present rather than guessing a file-type restriction that means nothing here. This is a real format mismatch, documented rather than papered over.

Because everything is project-local, **commit `.github/instructions/` and `AGENTS.md`** — that's how the rest of the team gets the same context.

## `antigravity` — context-only

```bash
awm init -a antigravity
```

| | Path |
|---|---|
| Skills | `~/.gemini/antigravity/skills/` · `.agent/skills/` |
| Workflows | `~/.gemini/antigravity/global_workflows/` |
| Hooks / injection | none |

> Note the singular `.agent/skills` at project scope, and that Antigravity does **not**
> share `~/.agents/skills` with Codex/OpenCode — it has its own tree. This table said
> otherwise for several releases; the authoritative, code-generated version is in
> [support-matrix.md](support-matrix.md).

Content is delivered and read by the agent. No hooks, no managed injection — `awm doctor` won't report those as missing, because the agent has no such mechanism to begin with.

---

## Several agents on one machine

Normal and supported — different developers on a team use different agents against the same registry.

```bash
awm agent            # manage which targets AWM tracks
awm doctor           # state of every enabled agent
awm doctor -a cursor,copilot
```

`awm init` targets one agent per run; run it once per agent you use.

Note that `codex` and `opencode` share `~/.agents/skills/`. That's intentional — one installed copy serves both, and the installer treats them as a group so enabling one without the other is refused rather than silently divergent. **`antigravity` does not share it**: it has its own `~/.gemini/antigravity/skills/`.

---

## Team distribution

`.awm/profile.json` records what the project uses. **Commit it.** A teammate then reproduces the setup with:

```bash
git clone <repo> && cd <repo>
awm init -a <their agent>   # their agent, your project's content
awm sync                    # rebuild from profile.json
```

The profile is agent-agnostic: it records *what* the project needs, and each developer's `awm init` decides *where* that lands for their agent.

Full team model — registries, pinning, onboarding — in [Runbook ch. 4](runbook.md#chapter-4--team-setup--customization).

---

## Verify

Per-agent acceptance checks, including what is *supposed* to degrade: [testing/agent-matrix.md](testing/agent-matrix.md).
