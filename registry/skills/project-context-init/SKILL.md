---
name: project-context-init
description: "Initialize or intelligently update the AGENTS.md context contract by analyzing a repository's codebase, inferring its purpose, and applying the agents.md standard (https://agents.md/)."
---

# Project Context Evaluator

You are the **Project Context Architect**. Your job is to initialize or intelligently update the `AGENTS.md` file in the repository root. This file is the primary context contract between humans and AI agents — a living document that follows the [agents.md standard](https://agents.md/).

**Announce at start:** "I'm using the project-context-init skill to evaluate and update the project context."

## Inputs

Before reasoning, you MUST gather the raw project data by running the data extraction script:

```bash
python3 ~/.agents/skills/project-context-init/scripts/gather_raw_context.py
```

This outputs structured JSON to stdout containing:
- `project_root` / `project_name`: Where the project lives
- `structure`: Simplified directory tree
- `dependencies`: Parsed dependency files (npm, python, go, rust, java, ruby, php, makefile)
- `readme`: First 200 lines of README.md
- `gitignore`: Contents of .gitignore
- `existing_agents_md`: Full content of current AGENTS.md (empty if first run)
- `config_files`: Which config files exist in the project
- `env_vars`: Environment variable names from .env template files
- `skills`: Available global and local skills with names and descriptions
- `community_docs`: Whether CONTRIBUTING.md, CODEOWNERS, LICENSE, etc. exist

Save the output to a temporary file for analysis:
```bash
python3 ~/.agents/skills/project-context-init/scripts/gather_raw_context.py > /tmp/project_context_dump.json
```

Then read the file with `view_file`.

## State Machine

Check whether `existing_agents_md` in the JSON dump is empty or not. This determines your execution mode.

---

### State A: First-Run Mode (AGENTS.md does NOT exist)

When `existing_agents_md` is empty, you are creating the document from scratch.

**Steps:**
1. **Analyze** the raw context dump to infer:
   - The repository's **purpose** (from README, dependencies, directory structure).
   - The **tech stack** (from dependency files, config files).
   - The **project type** (frontend app, backend API, library, documentation hub, monorepo, CLI tool, infrastructure, etc.).
   - The **primary programming language**.
   - The **repository language** (es/en) by analyzing the README content.

2. **Draft** a new `AGENTS.md` following the standard structure below.

3. **Proactively add** context-specific sections if the repository's nature warrants it. For example:
   - A backend API repo should include an "API Design Conventions" section.
   - A documentation-only repo should include "Document Types" and "Writing Style" sections.
   - A monorepo should include "Package/Service Boundaries" section.
   - An infrastructure repo should include "Deployment Conventions" section.

4. **Write** the file using `write_to_file` to `AGENTS.md` in the project root.

---

### State B: Evolution Mode (AGENTS.md ALREADY exists)

When `existing_agents_md` is NOT empty, you are performing a **non-destructive intelligent merge**.

**Steps:**
1. **Read** the existing `AGENTS.md` carefully. Understand its structure and content.

2. **Cross-reference** the existing document with the new raw context dump. Identify:
   - **Outdated information**: Dependencies removed, scripts renamed, directories restructured.
   - **Missing information**: New dependencies added, new config files, new skills installed, new env vars.
   - **Structure gaps**: Standard sections that are missing or have non-standard headings.

3. **Apply Format Enforcement**: Ensure the headings match the standard structure (see below). Rename or reorganize sections if needed, but **preserve their content**.

4. **🔴 CRITICAL PRESERVATION RULE**: You MUST **strictly preserve** any human-written context that cannot be inferred from the raw data. This includes but is not limited to:
   - Governance rules (CODEOWNERS descriptions, MR checklists).
   - Custom writing style guidelines.
   - Business-specific constraints and boundaries.
   - Contribution workflow details.
   - Commit message conventions.
   - Custom conventions or rules the human deliberately wrote.
   - Any section the human added that is not auto-generated.

   **How to identify human-written content**: If a piece of content is NOT directly derivable from the raw context dump (dependencies, tree, configs), it was written by a human. **Do not remove it.**

5. **Gap Analysis Report**: Before making modifications, mentally list:
   - What will be **updated** (and why).
   - What will be **added** (and why).
   - What will be **preserved as-is** (and why).

6. **Idempotency**: If after this analysis you conclude that the existing `AGENTS.md` is already perfectly in sync with the raw context and follows the standard structure, **do NOT modify the file**. Report that no changes were needed.

7. **Write** the updated file using `write_to_file` with `Overwrite: true`, or use `replace_file_content` / `multi_replace_file_content` for surgical updates.

---

## Standard AGENTS.md Structure

The following is the canonical section order. Not all sections are mandatory — include only those relevant to the repository. Sections marked with 🤖 can be auto-populated from the raw context. Sections marked with 👤 are typically human-written and must be preserved.

```markdown
# AGENTS.md

## Repository Overview                    🤖 (from README + dependencies)
## Build / Lint / Test Commands            🤖 (from scripts, Makefile)
## Directory Structure                     🤖 (from tree scan)
## File and Directory Naming Conventions   👤 (human convention)
## Writing Style Guidelines                👤 (human convention)
## Commit Message Convention               👤 (human convention)
## Contribution Workflow                   👤 (human convention, reference CONTRIBUTING.md)
## MR / PR Checklist                       👤 (human convention)
## CODEOWNERS / Governance                 👤 (human convention, reference CODEOWNERS file)
## Gitignored Paths                        🤖 (from .gitignore)
## Configuration Files                     🤖 (from config scan)
## Environment Variables                   🤖 (from .env template files)
## Available Skills / AI Assistants        🤖 (from skill discovery)
## Conventions                             👤 (human: code style, patterns, constraints)
## Important Constraints                   👤 (human: critical rules for agents)
## Common Agent Tasks                      👤 (human: examples of frequent tasks)
```

### Section Guidelines

- **Repository Overview**: One-paragraph summary. Include purpose, tech stack (main technologies, not every dependency), hosting/deployment target if known.
- **Build / Lint / Test Commands**: List actual commands from `package.json` scripts, `Makefile` targets, or equivalent. If none exist, explicitly state "No build/test commands configured."
- **Directory Structure**: Use the simplified tree from the raw dump. Add brief descriptions for key directories.
- **Available Skills**: Auto-populate from the skills discovered in the raw context. Format as a bullet list: `- **\`skill-name\`**: Description`.
- **Conventions**: This is the most critical human section. Always preserve and never overwrite.

## Cleanup

After writing or updating `AGENTS.md`, clean up any temporary files:
```bash
rm -f /tmp/project_context_dump.json
```

## Rules

1. **NEVER** remove human-written content without explicit user consent.
2. **ALWAYS** follow the `agents.md` standard for structure and naming.
3. **ALWAYS** use the repository's detected language (es/en) for new auto-generated content.
4. **DO NOT** include raw dependency tables with versions — summarize the tech stack at a high level.
5. **DO NOT** include the YAML frontmatter (`agent_context:`) unless the repository already uses it. The standard `agents.md` format is plain Markdown.
6. Prefer concise, actionable instructions over verbose documentation.
7. Write for an AI agent audience: be specific about file paths, exact commands, and precise conventions.
