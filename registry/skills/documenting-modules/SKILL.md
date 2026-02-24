---
name: documenting-modules
description: "Use this skill AFTER completing development or improvements to document the changes. It analyzes plans and code to generate system documentation in `docs/modules` and updates the README."
---

# Documenting Modules

## Overview

This skill automates the process of creating system documentation after development. It ensures that every new module or improvement is properly documented in the `docs/modules` directory and referenced in the `README.md`.

## When to Use

Use this skill when:
- You have just finished implementing a feature or module (e.g., after `executing-plans`).
- The user asks you to "document this" or "update documentation".
- You are closing a development cycle and need to leave the codebase in a clean state.

## The Process

### Step 0: Read Repository Contract

1.  **Read `AGENTS.md`** in the project root. Parse the YAML frontmatter block (`agent_context`) to extract:
    - `level` — the documentation context level (`area`, `project`, or `component`).
    - `docs_path` — the relative path where documentation lives (defaults to `docs`).
2.  **Use `docs_path`** for all subsequent path references instead of hardcoding `docs/`.

### Step 1: Analyze Context

1.  **Read Plans**: Look into `{docs_path}/plans` for the most recent design and implementation plans related to the work just finished.
2.  **Identify Scope**: Determine if the work is a new standalone module (e.g., "Weekly Planning") or an improvement to an existing one (e.g., "Responsive UI").

### Step 2: Gather Structured Data

Analyze the codebase and plans to extract the following structured information about the module:

| Data Point | Source |
|-----------|--------|
| Module Name | Plan title or user input |
| Overview | Plan context + code analysis |
| Key Features | Plan goals + implemented functionality |
| Technical Architecture | Component analysis, data flow, key logic |
| Usage | User-facing behavior from UI components or API endpoints |

**Do NOT write the final document yet.** Collect the data and proceed to Step 3.

### Step 3: Delegate Formatting to Template Wizard

1.  **Read the template** at `~/.agents/skills/cscti-template-wizard/resources/templates/module-template.md`.
2.  **Extract the YAML metadata** (`template_purpose`, `interview_questions`) from the template.
3.  **Auto-fill** each section of the template body using the structured data gathered in Step 2. Since the data was already collected, you do NOT need to ask the user the interview questions — fill them programmatically.
4.  **Generate the final document** as a clean Markdown file (without YAML frontmatter) and save it to `{docs_path}/modules/<category>/<module-name>.md`.

-   **Category**: Group by domain (e.g., `task-management`, `ui-ux`, `integrations`).
-   **Filename**: Use descriptive names in kebab-case (e.g., `weekly-planning.md`).

### Step 4: Update Index

1.  **Update `README.md`**: Add a link to the new documentation file in the "Documentación del Sistema" section.
2.  **Verify**: Ensure the link is relative and works (e.g., `[Label]({docs_path}/modules/category/file.md)`).

## Rules

-   **Language**: Write documentation in **Spanish** (as per project convention, or as declared in `agent_context.language`).
-   **Conciseness**: Focus on "what it is" and "how it works", not "how we built it" (that's in the plans).
-   **Location**: Always use `{docs_path}/modules`. Do not create loose files in `{docs_path}/` root.
-   **Template Source**: Always use the official template from `~/.agents/skills/cscti-template-wizard/resources/templates/module-template.md`. Never invent your own structure.

