# Agentic Workflow Manager (AWM) Documentation Design

## 1. Goal
Implement a comprehensive, modular documentation strategy for the AWM repository (a CLI and Registry for AI Agent skills and workflows). The documentation must cater to both end-users (who only want to install and use skills) and developers (who want to contribute to the CLI or the Registry).

## 2. Approach: Exhaustive Modular
We will use a modular approach centered around a primary `README.md` at the root, with detailed technical documentation decentralized into a `docs/` folder and sub-READMEs where appropriate.

## 3. Structure

### 3.1 Root `README.md` (The Landing Page)
The primary entry point. It must be visual, concise, and focused on value proposition and immediate usage.
- **Header**: Title, badges (version, build status), and a clear one-sentence description.
- **What is AWM?**: Brief explanation of managing skills/workflows for multiple AI agents (Antigravity, OpenCode).
- **Quick Start**:
  - The `curl | bash` installation command.
  - Adding a process: `awm add <name>`
  - Updating: `awm update`
- **Why AWM?**: The problem it solves (knowledge sharing, standardizing workflows across a team).
- **Navigation Links**: Clear links to the deeper documentation in `docs/`.

### 3.2 The `docs/` Directory
Contains the deep-dive documentation.

- `docs/architecture.md`:
  - Logical monorepo structure (`cli/` vs `registry/`).
  - How local caching (`~/.awm/registry`) works.
  - Providers (Antigravity, OpenCode) paths and sync mechanisms (Symlinks vs. Copy).
- `docs/cli-reference.md`:
  - Detailed breakdown of all commands: `add` (and its non-interactive flags), `list`, `update`, `remove`.
- `docs/registry-guide.md` (How to contribute):
  - Anatomy of a Skill (`SKILL.md`).
  - Anatomy of a Workflow (`.md` with Yaml frontmatter).
  - How to create a bundle/process in `processes.json`.

### 3.3 Component READMEs (Optional but Recommended)
- `cli/README.md`: specifically for developers running `npm install`, `npm run build`, and running tests locally on the CLI source code.

## 4. Implementation Steps
1. Create the root `README.md` with the new structure.
2. Create/update `docs/architecture.md` (we can base this heavily on the existing `2026-02-24-awm-cli-design.md` but format it for the final repo).
3. Create `docs/cli-reference.md`.
4. Create `docs/registry-guide.md`.
5. Create `cli/README.md`.
6. Review and commit.

## 5. Non-Goals
- We will not document every single skill currently in the registry in the main `README.md` (they should be self-documenting via their own `SKILL.md` or the `awm list` command).
