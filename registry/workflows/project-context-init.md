---
description: Initialize or intelligently update the project context contract (AGENTS.md)
---

# Project Context Init Workflow

> [!IMPORTANT]
> This workflow uses AI reasoning to initialize or update `AGENTS.md`. It is NOT a blind script—it analyzes the repository and performs a non-destructive merge.

## Steps

1. Read the skill instructions at `~/.agents/skills/project-context-init/SKILL.md`. Use `view_file` to read the full skill manifest.

2. Follow **all** the steps defined in the skill exactly as documented:
   - Run the data extraction script (`gather_raw_context.py`) to collect raw project data.
   - Determine the execution state (First-Run vs Evolution Mode).
   - Apply the agents.md standard and the rules for preservation / gap analysis.
   - Write or update `AGENTS.md` accordingly.

3. Clean up any temporary files created during the process.

4. Notify the user about what was done:
   - If First-Run: "AGENTS.md has been created. Please review and customize the human-written sections."
   - If Evolution: "AGENTS.md has been updated. Here's a summary of changes: [list changes]."
   - If Idempotent: "AGENTS.md is already up to date. No changes were needed."

## Restrictions

- **OBLIGATORIO**: Use ONLY the skill `project-context-init` for this workflow. Do not combine with other skills.
- The skill's preservation rules have absolute priority: NEVER remove human-written content.
- Obey the state machine logic strictly. Do not skip the analysis phase.
