# Agentic Workflow Manager (AWM)

[![Version](https://img.shields.io/npm/v/agentic-workflow-manager)](https://www.npmjs.com/package/agentic-workflow-manager)
[![Build Status](https://img.shields.io/badge/build-passing-success)]()

> A centralized CLI for managing, sharing, and standardizing AI Agent skills and workflows across your team.

**AWM** (Agentic Workflow Manager) is a tool designed to solve the problem of fragmented prompt engineering and agent scripts. It allows you to package standard operating procedures, architectural guidelines, and codebase context into reusable "Skills" and "Workflows" that can be instantly installed into AI IDEs like Antigravity or OpenCode.

## 🚀 Quick Start

Install AWM globally using the one-liner bash script:

```bash
curl -fsSL https://raw.githubusercontent.com/Kodria/agentic-workflow/main/install.sh | bash
```

Once installed, verify it's working:
```bash
awm --help
```

Then, **inside the repo where you want the harness**, bootstrap everything in one idempotent pass:

```bash
awm init                  # Claude Code (default)
awm init --agent opencode # or OpenCode
awm doctor                # read the machine + project state any time
```

> **First time using AWM?** Read the [Getting Started runbook](docs/getting-started.md) — the from-zero walkthrough for both Claude Code and OpenCode: install → `awm init` → `awm doctor` → finish project setup (sensors + `CONSTITUTION.md` + the learning loop).

## 🧹 Uninstallation

To safely remove the AWM CLI and its internal cache without deleting your personal skills or workflows, run the uninstall script from the repository root:

```bash
curl -fsSL https://raw.githubusercontent.com/Kodria/agentic-workflow/main/uninstall.sh | bash
```

> **Note**: Your installed artifacts in `~/.agents` and `~/.gemini/antigravity/global_workflows` are intentionally left intact to protect personal files. If you wish to remove them, please delete the specific directories or symlinks manually.

## 📦 Managing Skills and Workflows

AWM comes with an interactive terminal interface.

**1. Install a new skill or process:**
```bash
awm add
```
*(You will be prompted to select from the available registry, choose your target agent, and select the installation scope).*

**2. See what's available:**
```bash
awm list
```

**3. Keep everything up to date:**
```bash
awm update
```
*(Because AWM uses symlinks by default, updating the central registry instantly updates the skills across all your local projects).*

## 📚 Documentation

Dive deeper into how AWM works and how you can contribute:

**Use it**
- [Getting Started](docs/getting-started.md): The from-zero runbook for Claude Code & OpenCode — install → `awm init` → `awm doctor` → sensors, `CONSTITUTION.md`, and the development + learning loop end-to-end.
- [CLI Reference](docs/cli-reference.md): Every `awm` command and non-interactive flag (`init`, `doctor`, `sensors`, `hooks`, `ledger`, `add`, …).

**Understand it**
- [Architecture & Design](docs/architecture.md): The logical monorepo and how AWM routes artifacts between the registry and your install.
- [Harness Retros](docs/harness-retros.md): Auditable log of recurring harness gaps converted into structural rules.

**Extend it**
- [Registry Contributor Guide](docs/registry-guide.md): Author your own Skills (`SKILL.md`) and bundle them into Processes.
- [CLI Developer Guide](cli/README.md): Work on the core AWM CLI source code.

## 🤝 Why AWM?

As teams adopt AI coding assistants, knowledge gets scattered. One developer has a great prompt for writing Next.js components, another has a workflow for migrating legacy databases. AWM brings the "Package Manager" experience to AI context: Let your most experienced engineers codify their best practices into Skills, and distribute them instantly to the rest of the team.
