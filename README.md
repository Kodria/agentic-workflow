# Agentic Workflow Manager (AWM)

[![Version](https://img.shields.io/npm/v/agentic-workflow-manager)](https://www.npmjs.com/package/agentic-workflow-manager)
[![Build Status](https://img.shields.io/badge/build-passing-success)]()

> A centralized CLI for managing, sharing, and standardizing AI Agent skills and workflows across your team.

**AWM** (Agentic Workflow Manager) is a tool designed to solve the problem of fragmented prompt engineering and agent scripts. It allows you to package standard operating procedures, architectural guidelines, and codebase context into reusable "Skills" and "Workflows" that can be instantly installed into AI IDEs like Antigravity or OpenCode.

## 🚀 Quick Start

Install AWM globally using the one-liner bash script:

```bash
curl -fsSL https://raw.githubusercontent.com/Kodria/agentic-workflow/master/install.sh | bash
```

Once installed, verify it's working:
```bash
awm --help
```

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

- [Architecture & Design](docs/architecture.md): Understand the logical monorepo and how AWM routes artifacts.
- [CLI Reference](docs/cli-reference.md): Detailed usage of all `awm` commands and non-interactive flags.
- [Registry Contributor Guide](docs/registry-guide.md): Learn how to build your own Skills (`SKILL.md`) and bundle them into Processes.
- [CLI Developer Guide](cli/README.md): Instructions for working on the core AWM CLI source code.

## 🤝 Why AWM?

As teams adopt AI coding assistants, knowledge gets scattered. One developer has a great prompt for writing Next.js components, another has a workflow for migrating legacy databases. AWM brings the "Package Manager" experience to AI context: Let your most experienced engineers codify their best practices into Skills, and distribute them instantly to the rest of the team.
