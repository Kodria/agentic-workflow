# Design: Project-Local Template Overrides

## Goal
Implement a mechanism that allows individual projects to define and manage their own local documentation templates. These local templates can either introduce new project-specific formats or override (shadow) existing global templates provided by the `template-wizard` and `template-manager` skills from the AWM registry.

## Context and Constraints
- Global templates reside in the AWM registry (`~/.awm/registry/skills/template-wizard/resources/templates/`) and are distributed via `awm update`.
- Modifying global templates directly via user-facing skills breaks the local git clone of the registry and causes conflicts during `awm update`.
- Therefore, the global registry is meant to be **read-only** for end users. They must contribute new global templates via Pull Requests to the central `agentic-workflow` repository.

## Proposed Architecture

### 1. Template Localizations
We establish a strict convention: Local templates for any project reside in `./docs/templates/` relative to the project root.

### 2. Template Wizard Modifications
The `template-wizard` skill will be updated to respect local overrides during its discovery phase.

**Algorithm:**
1.  **Global Discovery:** Scan `TEMPLATES_DIR` (global skill resources) and index templates by their `template_purpose` metadata field.
2.  **Local Discovery:** Check for the existence of `./docs/templates/` in the current project directory.
3.  **Conflict Resolution (Shadowing):** If `./docs/templates/` exists, scan it. For each local template, extract its `template_purpose`. If this purpose already exists in the global index, the local template path *replaces* the global path in memory. If not, it is added to the available pool.
4.  The rest of the wizard proceeds normally with this consolidated list.

### 3. Template Manager Modifications
The `template-manager` skill will be heavily refactored to align with the read-only nature of the AWM registry and shift its focus entirely to empowering local customization.

**Algorithm:**
1.  **Scope Enforcement:** The skill evaluates if it's being run within a valid project context (e.g., checking for `AGENTS.md` or a standard repo structure). If not, it halts.
2.  **Target Directory:** All write operations (create/update) are hardcoded to target `./docs/templates/` in the local project.
3.  **Creation Flow:** New templates requested by the user are scaffolded and saved directly to the local `./docs/templates/` folder.
4.  **Edit Flow:**
    *   The skill compares the user's intent with templates in the *global* and *local* pools.
    *   If editing a *local* template, changes are saved back to `./docs/templates/`.
    *   If targeting a *global* template for editing, the skill automatically performs a "Local Override" operation: it copies the global template's structure into `./docs/templates/`, applies the user's requested changes to the copy, and saves it locally. This shields the global registry from unintended mutations.

## Verification Plan
1. Testing `template-wizard` in a project with local templates shadowing global ones to ensure the correct prompt flow triggers.
2. Testing `template-manager` creation flow to assert it creates files only in `./docs/templates/`.
3. Testing the "Local Override" extraction of a global template via `template-manager`.
