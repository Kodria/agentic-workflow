# AWM Architecture

This document outlines the high-level architecture of the Agentic Workflow Manager (AWM).

## 1. CLI + Content separation

AWM separates the **CLI tool** from its **content** into distinct repos:

- **CLI** (`cli/` in this repo): the TypeScript source for the global `awm` binary, published to npm as `agentic-workflow-manager`.
- **Content repos** (separate git repos):
  - [`awm-baseline-registry`](https://github.com/Kodria/awm-baseline-registry) — Skills, bundles, sensor-packs, hooks seeded by default on `awm init`.
  - [`awm-documentation-registry`](https://github.com/Kodria/awm-documentation-registry) — Documentation-focused skills (opt-in: `awm registry add <url>`).

## 2. The Local Cache (`~/.awm/registries/`)

When you run `awm init`, AWM clones each configured registry into `~/.awm/registries/<name>/`.

- `~/.awm/registries/baseline/` — the baseline registry clone
- `~/.awm/registries/<name>/` — any additional registered registries

Every time you run `awm add`, the CLI looks inside these directories to find and parse available skills, workflows, and process bundles. It does *not* hit the GitHub API directly.

When you run `awm update`, the CLI fetches the latest commits for each registry clone and rebuilds the CLI binary (you never run `npm build`).

## 3. Content Discovery

The CLI discovers content via `contentRoots()`, which returns the list of configured registry paths under `~/.awm/registries/`. Each artifact (skill, bundle, sensor-pack) carries a `contentRoot` stamp pointing to the registry it came from, so install/use logic always resolves the correct absolute path.

## 4. Providers & Multi-Target Support

AWM is not tied to a single AI IDE or agent interface. Depending on the `Provider` selected during installation, artifacts are routed to different target locations on the user's filesystem.

Currently supported Providers:

### 4.1 Claude Code
- **Global Skills paths**: `~/.claude/skills/` (symlinks into `~/.awm/registries/<name>/skills/`)

### 4.2 OpenCode
- **Global Skills paths**: `~/.agents/skills/`

### 4.3 Antigravity
Google Deepmind's internal engineering agent platform.
- **Global Skills paths**: `~/.agents/skills/`
- **Global Workflows paths**: `~/.gemini/antigravity/global_workflows/`

## 5. Symlinks vs. Copy Implementation

AWM supports **Symlink Installation (Default)**.

When you install a skill globally via symlink, AWM creates a symbolic link from the target destination back to the registry clone in `~/.awm/registries/<name>/skills/skill-name/`.

Because the target is a window to the registry clone, anytime an upstream maintainer updates a skill and the user runs `awm update` (fetching the registry), the change propagates through the symlink instantly.

The **Copy** installation method exists for "ejecting" a skill — if a user wants to fork and modify it locally, `copy` creates a hard clone that disconnects it from future `awm update` syncs.
