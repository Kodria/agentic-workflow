# Agentic Workflow Manager (AWM) CLI Design

## 1. Goal
Design a professional, scalable, and interactive Command Line Interface (CLI) to manage personal AI agent skills and workflows. The tool must support distribution across a team, allow installing complete "processes" (bundles of skills), and provide an excellent user experience similar to `npx skills`, supporting multiple AI IDEs (Antigravity, OpenCode, etc.).

## 2. Architecture

### 2.1 Logical Monorepo (CLI & Registry)
`awm` uses a logical monorepo approach for team distribution:
- **`cli/` Directory**: Contains the TypeScript source code for the `awm` CLI tool.
- **`registry/` Directory**: Contains the actual skills, workflows, and process definitions.
- **Local Cache (`~/.awm/registry/`)**: When `awm` is installed or updated, it maintains a local clone of the entire repository. The CLI logic will specifically look inside `~/.awm/registry/registry/` to find and install the artifacts.

### 2.2 Interactive TUI (Text User Interface)
Instead of relying on complex configuration files or forcing the user to memorize command-line arguments, `awm` will feature a visual, interactive terminal interface (using libraries like `@clack/prompts`, `inquirer`, or `Rich`). 
The CLI will guide the user through:
1. Selecting the Artifact (Skill or Process).
2. Selecting target Agents (Antigravity, OpenCode).
3. Selecting Scope (Global or Local to the current project).
4. Selecting Installation Method (Symlink or Copy).

Local preferences (e.g., last used Agent or Installation Method) will be saved in `~/.awm/preferences.json` to speed up future executions.

### 2.3 Multi-Target Support (Providers)
`awm` routes generated artifacts to specific paths based on the selected AI agent destination:

- **Antigravity**:
  - Global Skills: `~/.agents/skills/`
  - Local Skills: `./.agents/skills/`
  - Global Workflows: `~/.gemini/antigravity/global_workflows/`
  - Local Workflows: `./.agents/workflows/`

- **OpenCode**:
  - Global Skills: `~/.agents/skills/`
  - Local Skills: `./.agents/skills/`
  - Workflows: Ignored (not natively supported in the same way).

## 3. Key Concepts

### 3.1 Skills vs. Processes
- **Skill**: A single directory containing `SKILL.md` and associated scripts (e.g., `cscti-template-manager`).
- **Process (Bundle)**: A logical grouping defined in a `processes.json` manifest in the central registry. For instance, the "documentacion" process bundles multiple skills (`cscti-docs-assistant`, `business-documenting-modules`) and workflows into a single installation command.

### 3.2 Symlinks vs. Copy
- **Symlink (Default/Recommended)**: Creates a symbolic link from the target agent's directory (e.g., `./.agents/skills/my-skill`) pointing directly to the `awm` registry (`~/.awm/registry/skills/my-skill`). This ensures that running an `awm update` instantly updates all local repositories using that skill.
- **Copy**: Physically copies the files. Useful if the user intends to modify the skill locally for a specific project without affecting the global registry.

## 4. Core Commands

### `awm add [name]`
Initiates the interactive installation flow. If `[name]` is omitted, it prompts the user to select from a searchable list of available skills and processes.
*Example non-interactive usage:* `awm add documentacion --agent antigravity --local --symlink`

### `awm update`
Updates the local registry (`~/.awm/registry/`) via `git pull`. Because most installations use symlinks, this single command instantly updates skills and processes across all of the user's projects and global agents.

### `awm remove [name]`
Interactively removes a skill or process from the selected agents and scopes.

## 5. Rollout Strategy
1. **Repository Setup**: Create the `agentic-workflow` repository structure (`skills/`, `workflows/`, `docs/`, `processes.json`).
2. **CLI Development**: Develop the `awm` Node.js or Python CLI script with the interactive TUI.
3. **Distribution**: Create a one-liner installation script (`curl | bash`) that installs the CLI binary and clones the initial registry to `~/.awm/registry/`.
4. **Migration**: Move the existing global skills and workflows from the user's machine into the new repository and commit them.
