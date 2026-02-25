# Registry Contributor Guide

The value of the AWM comes from the centralized Registry: A unified location where developers can write `SKILL.md` operating procedures and workflows, and instantly distribute them across a team.

This guide explains how to define and add artifacts to the AWM core `registry/`.

All PRs contributing new organizational practices should focus on adding folders/files to the `registry/skills/` and `registry/workflows/` directories.

---

## 🏗 Anatomy of a Skill

A Skill is a specialized set of instructions and tools that extends an AI Agent's capabilities for specialized engineering tasks.

To add a new skill to the registry, create a new folder under `registry/skills/[your-skill-name]/`.

Inside that folder, you must define:
- `SKILL.md` (Required): The primary instruction document.
- `scripts/` (Optional): Helper scripts for data gathering or validation.
- `examples/` (Optional): Implementation references to ground the LLM's context.

### The `SKILL.md` File

This document must use Markdown and include a YAML frontmatter block at the top containing a clear `name` and `description`.

```yaml
---
name: [your-skill-name]
description: [Short definition (1-3 sentences) explaining WHEN the agent should use this skill.]
---

# Your Skill Title

Detailed Markdown instructions. Use `<HARD-GATE>` XML tags or code blocks to enforce strict rules on the Agent.
```
*(When a user runs `awm list`, the CLI parses this YAML frontmatter to display the skill's description).*

---

## 🛠 Anatomy of a Workflow

A Workflow is a well-defined sequence of steps to achieve a specific outcome, meant to be triggered interactively by the user (unlike Skills which the Agent chooses autonomously).

To add a new workflow, create a single Markdown file under `registry/workflows/[your-workflow-name].md`.

The name of the file (`your-workflow-name`) will become the `/slash-command` used to invoke it in IDEs like Antigravity.

### Workflow File Requirements

Like skills, a workflow needs a YAML frontmatter `description` block. The rest of the file should contain a step-by-step numbered guide.

```yaml
---
description: [Short title describing what this workflow achieves]
---

# My Workflow Title

1. Step one instructions.
// turbo
2. Step two instructions (the `// turbo` configures the Agent to auto-run this step's shell commands if safe).
```

---

## 📦 Defining Processes (Bundling)

Instead of forcing users to install 5 separate skills for a single context domain, AWM supports "Processes" — logically bundled collections of features.

To define a Process, open the `registry/processes.json` file.

Add a new key-value entry mapped to your domain:

```json
{
  "processes": [
    {
      "name": "domain-docs",
      "description": "Essential skills required for documenting domain service architectures.",
      "artifacts": [
        { "type": "skill", "name": "documenting-modules" },
        { "type": "skill", "name": "business-documenting-modules" },
        { "type": "workflow", "name": "docs-system-orchestrator.md" }
      ]
    }
  ]
}
```

A user can now run `awm add domain-docs`, and the CLI will silently install all 3 artifacts via Symlink in a single execution.
