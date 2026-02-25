# AWM Architecture

This document outlines the high-level architecture of the Agentic Workflow Manager (AWM) and its registry design pattern.

## 1. Logical Monorepo Pattern

AWM utilizes a "Logical Monorepo" approach to keep the CLI tool and the artifact registry tightly coupled.

The repository is structured into two main components:
- `cli/`: Contains the TypeScript source code that builds the global `awm` Node binary.
- `registry/`: Contains the actual content (Skills, Workflows, Processes) that `awm` manages and distributes.

## 2. The Local Cache (`~/.awm/registry/`)

When you run the initial installation script (`install.sh`), AWM clones the *entire* github repository into a clean workspace directory located at `~/.awm/cli-source/`.

During installation:
1. The `cli/` folder is built and the binary is linked to your system's global `npm` bin path.
2. The CLI uses the `registry/` folder inside this clone as the **"Local Cache"**.

Every time you run `awm add`, the CLI actually looks inside `~/.awm/cli-source/registry/` to find and parse available skills, workflows, and process bundles. It does *not* hit the GitHub API directly.
When you run `awm update`, the CLI executes an internal `git pull` inside `~/.awm/cli-source/`, instantly syncing your local cache with the latest remote version.

## 3. Providers & Multi-Target Support

AWM is not tied to a single AI IDE or agent interface. Depending on the `Provider` selected during installation, artifacts are routed to different target locations on the user's filesystem.

Currently supported Providers:

### 3.1 Antigravity
Google Deepmind's internal engineering agent platform.
- **Global Skills paths**: `~/.agents/skills/`
- **Local Skills paths**: `./.agents/skills/`
- **Global Workflows paths**: `~/.gemini/antigravity/global_workflows/`
- **Local Workflows paths**: `./.agents/workflows/`

### 3.2 OpenCode
An open-source or separate ecosystem target point.
- **Global Skills paths**: `~/.agents/skills/`
- **Local Skills paths**: `./.agents/skills/`
- *Workflows*: OpenCode natively utilizes different configuration conventions. Workflows from AWM are currently ignored for OpenCode deployments to prevent path pollution.

## 4. Symlinks vs. Copy Implementation

The most powerful feature of AWM is its support for **Symlink Installation (Default)**.

When you install a skill globally via symlink, AWM does not copy the file contents from `~/.awm/cli-source/registry/skills/skill-name/` to `~/.agents/skills/skill-name/`.

Instead, it creates a hard symbolic link pointing from the target destination back to the Local Cache.

#### Why is this important?
Because the target is simply a window to the Local Cache, anytime an upstream maintainer updates a skill's behavior and the user runs `awm update` (processing the `git pull`), the change instantly propagates through the Symlink. All projects across the machine instantly benefit from the updated skill without requiring a re-install loop.

The **Copy** installation method exists solely for "ejecting" a skill. If a user wishes to fork a skill and modify it aggressively for a highly specific local project, `copy` creates a hard clone that disconnects it from future upstream `awm update` syncs.
