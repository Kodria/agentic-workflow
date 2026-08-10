# Agentic Workflow Manager (AWM)

[![Version](https://img.shields.io/npm/v/agentic-workflow-manager)](https://www.npmjs.com/package/agentic-workflow-manager)
[![CI](https://github.com/Kodria/agentic-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/Kodria/agentic-workflow/actions/workflows/ci.yml)

> A package manager for AI-agent context: distribute your team's skills, processes and quality gates to every developer's coding agent, from one git registry.

As teams adopt AI coding assistants, knowledge scatters. One developer has a great prompt for Next.js components, another a workflow for migrating legacy databases, and nobody else can use either. **AWM turns those into versioned, installable artifacts** — and installs them into whichever agent each developer actually uses.

It also carries the part most prompt libraries skip: **deterministic quality gates**. Sensors (typecheck, lint, tests, security) run as real commands with real exit codes, so "done" is verified by the machine, not asserted by a model.

---

## Install

Requires **Node.js 22+** and **git**.

```bash
npm i -g agentic-workflow-manager
awm --version
```

Then, inside the repo where you want the harness:

```bash
awm init            # Claude Code (default)
awm init -a codex   # or: opencode, cursor, copilot, antigravity
awm doctor          # read machine + project state at any time
```

`awm init` is idempotent — run it as often as you like. It bootstraps `~/.awm`, clones the baseline registry, and installs the artifacts your project declares.

**Detailed, per-OS instructions** (including native Windows and WSL): **[docs/installation.md](docs/installation.md)**

---

## Support matrix

This is a **contract**, not a wish list. Every row is verified against source and CI — see [`CONSTITUTION.md`](CONSTITUTION.md#matriz-de-soporte) for the authoritative version with source citations.

### Operating systems

| OS | Status |
|---|---|
| Linux | Supported · verified on every PR (`ubuntu-latest`) |
| macOS | Supported |
| Windows (native) | Supported · verified on every PR (`windows-latest`) |
| Windows (WSL) | Supported — reports as Linux |

> **One known, narrow gap on native Windows:** the crash-recovery path of `awm watch`'s supervisor (spawn → identity capture → adoption after the supervisor is killed) has not converged on real Windows CI, and its 4 end-to-end tests are POSIX-scoped. Everything else — `init`, `update`, `sync`, `add`, `sensors`, `preflight`, `doctor`, hooks — is continuously green on Windows. Details in [`cli/src/core/journal/process.ts`](cli/src/core/journal/process.ts).

### Agents

Not every agent can enforce the same things. AWM reports each one's **tier** honestly rather than implying parity — a lower tier is a limitation of the target agent's architecture, not a defect in AWM.

| Agent | Tier | What that means |
|---|---|---|
| `claude-code` | hooks-native | Full spine: session hooks fire, skills invoke, phase gates enforce |
| `codex` | hooks-native | Full spine (requires Codex ≥ 0.145.0) |
| `opencode` | config-managed | Context delivered via managed config instructions |
| `cursor` | agents-md-managed | Context delivered as project rules; no global context file |
| `copilot` | agents-md-managed | Context delivered project-locally; no global skills directory |
| `antigravity` | context-only | Context is read by the agent; no hooks, no managed injection |

**How to configure each one:** **[docs/agents-setup.md](docs/agents-setup.md)**

**Exactly what is supported, with what evidence, and what is not:**
**[docs/support-matrix.md](docs/support-matrix.md)** — install paths generated from the
source and locked by a test, plus an explicit `verified / unverified / not supported /
planned` level for every provider, OS, registry and sensor pack. Nothing there asks you
to take its word for it.

### Stacks (for sensors)

`js-ts`, `python`, `shell`, and a `generic` fallback. Detection is a convenience; `awm sensors init --pack <name>` is the explicit override and the real contract.

**Explicitly out of scope** (by decision, not omission): other languages (Go, Java, .NET, Ruby…), other git hosts for PR automation (Bitbucket, Azure DevOps — detected and warned about, never driven), and external contributions to this repo.

---

## How it fits together

```
   Your team's git registry                 Each developer's machine
  ┌────────────────────────┐               ┌──────────────────────────┐
  │  skills/               │  awm update   │  ~/.awm/registries/…     │
  │  bundles/              │ ────────────► │        │                 │
  │  sensor-packs/         │               │        │ awm init / add  │
  │  agents/  workflows/   │               │        ▼                 │
  └────────────────────────┘               │  ~/.claude/skills/  …    │
         versioned by tag                  │  .cursor/rules/     …    │
                                           │  AGENTS.md          …    │
                                           └──────────────────────────┘
                                              rendered per agent
```

The **CLI** and the **content** are separate on purpose. The CLI ships on npm; the content lives in git registries you control and version independently:

- [`awm-baseline-registry`](https://github.com/Kodria/awm-baseline-registry) — seeded by default
- [`awm-documentation-registry`](https://github.com/Kodria/awm-documentation-registry) — opt-in via `awm registry add`
- **your own team registry** — the point of the whole thing ([how to build one](docs/runbook.md#chapter-4--team-setup--customization))

---

## Day-to-day

```bash
awm add                  # install a skill / workflow / process (interactive)
awm list                 # see what's available
awm sensors run          # run the project's quality gates
awm preflight            # verify the harness can actually gate before you start
awm update               # pull the latest content from every registry
awm doctor               # what state is everything in?
awm track status         # parallel tracks: phase of each track and of the cohort
```

The two processes the system runs day to day:

- **[Product process](docs/guides/product-process.md)** — from a raw idea to a certified-ready brief.
- **[Development process](docs/guides/development-process.md)** — from a brief or a concrete requirement to merged, verified code.

---

## Documentation

**Get running**
- [Installation](docs/installation.md) — per OS, prerequisites, troubleshooting
- [Agent setup](docs/agents-setup.md) — per agent, what each tier gives you
- [Runbook](docs/runbook.md) — the complete operating manual, install → team rollout → authoring

**Use it**
- [Product process guide](docs/guides/product-process.md) · [Development process guide](docs/guides/development-process.md)
- [CLI reference](docs/cli-reference.md) — every command and non-interactive flag
- [Parallel tracks](docs/guides/parallel-tracks.md) — running a plan's tasks in parallel worktrees, when it degrades to serial, and what `BLOCKED` means

**Understand it**
- [Architecture](docs/architecture.md) — components, data flow, on-disk state
- [Software development lifecycle](docs/sdlc.md) — how the phases, gates and learning loop compose
- [`CONSTITUTION.md`](CONSTITUTION.md) — the project's non-negotiable rules
- [Harness retros](docs/harness-retros.md) — auditable log of recurring gaps turned into structural rules

**Verify it**
- [Support matrix](docs/support-matrix.md) — what is supported, at what evidence level, and what is missing
- [Decisions](docs/decisions.md) — product and process decisions, with their reason and consequence
- [End-to-end acceptance playbooks](docs/testing/README.md) — scripted checks per OS and per agent

**Extend it**
- [Authoring content](docs/runbook.md#chapter-5--extensibility-authoring-content) — write your own skills, bundles and packs
- [CLI developer guide](cli/README.md) — work on the CLI itself

