---
name: business-documenting-modules
description: "Use this skill AFTER completing development to document functional business modules into Notion-ready formats in `docs/business-knowledge`. Intelligently distinguishes between technical tasks and actual business features."
---

# Business Documenting Modules

## Overview

This skill automates the creation of high-level, business-focused documentation primarily intended for the project's Notion knowledge repository. Unlike standard technical documentation, this skill emphasizes business value, rules, user flows, and integrations.

## When to Use

Use this skill when:
- You have completed a development cycle, especially one involving a new functional feature or significant business logic update.
- The user requests business documentation or asks to document the module for Notion.
- You are transitioning a completed feature to a state where stakeholders or non-technical team members need to understand its functionality.

## The Process

### Step 0: Read Repository Contract

1.  **Read `AGENTS.md`** in the project root. Parse the YAML frontmatter block (`agent_context`) to extract:
    - `level` — the documentation context level (`area`, `project`, or `component`).
    - `docs_path` — the relative path where documentation lives (defaults to `docs`).
2.  **Use `docs_path`** for all subsequent path references instead of hardcoding `docs/`.

### Step 1: Intelligent Filtering (Crucial Step)

Before generating any documentation, you **MUST** analyze the recent context (e.g., from `task.md`, recent conversations, or `{docs_path}/plans`) to determine the nature of the work.

1.  **Is it a Functional Business Module?** Does it add or significantly alter a feature that end-users or the business interacts with? Examples: "Weekly Planning", "Checkout Flow", "User Onboarding".
2.  **Is it a Technical Task?** Is it purely infrastructural, refactoring, or a minor cosmetic change? Examples: "Refactoring API", "Responsive UI fixes", "Updating Dependencies".

**Decision:**
- If the work is purely a **Technical Task**, politely inform the user that the recent changes do not constitute a core business module and therefore business documentation will not be generated. *Stop execution here.*
- If the work is a **Functional Business Module**, proceed to Step 2.

### Step 2: Gather Structured Business Data

Analyze the codebase, plans, and recent context to extract the following structured information:

| Data Point | Source |
|-----------|--------|
| Module Name | Plan title, feature name, or user input |
| Business Purpose & Value | Plan context, user stories, README features |
| Key Business Rules | Code constraints, validation logic, domain rules |
| User Journey | UI components flow, API interactions, user stories |
| Integration Points | Service calls, external APIs, cross-module dependencies |

**Do NOT write the final document yet.** Collect the data and proceed to Step 3.

### Step 3: Delegate Formatting to Template Wizard

1.  **Locate the template dynamically**: Use your file search tools (e.g., `find_by_name`) to find `template-wizard/resources/templates/business-knowledge-template.md` across your skill directories (`.agents/skills/`, `.agent/skills/`, `~/.gemini/antigravity/skills/`, `~/.agents/skills/`). Read the template from the discovered path.
2.  **Extract the YAML metadata** (`template_purpose`, `interview_questions`) from the template.
3.  **Auto-fill** each section of the template body using the structured data gathered in Step 2. Since the data was already collected, you do NOT need to ask the user the interview questions — fill them programmatically.
4.  **Generate the final document** as a clean Markdown file (without YAML frontmatter) and save it to `{docs_path}/business-knowledge/<category>/<module-name>.md`. Create the necessary directories if they don't exist.

-   **Category**: Group by high-level business domain (e.g., `planning`, `financials`, `core-operations`).
-   **Filename**: Use a descriptive, human-readable name in kebab-case (e.g., `weekly-planning-system.md`).

### Step 4: Update Index

1.  **Update `README.md`**: If there is a section for "Business Knowledge" or "Notion Knowledge Base", add a link to this new document. If not, consider adding a brief note or creating an index file in `{docs_path}/business-knowledge/README.md`.

## Rules

-   **Language**: Write the documentation in **Spanish** (or as declared in `agent_context.language`).
-   **Tone**: Keep it professional, accessible to non-technical stakeholders, and focused on business outcomes.
-   **Focus**: Absolutely **NO** deep technical details (like specific database queries, class names, or component structures) unless strictly necessary to explain a business rule. Focus on the *What* and *Why*, not the *How*.
-   **Template Source**: Always use the official template from `template-wizard/resources/templates/business-knowledge-template.md` (located dynamically via file search). Never invent your own structure.

