# 2026-02-25-AWM-Exhaustive-Testing-Strategy-Design

## Overview
This document outlines an exhaustive manual testing strategy for the Agentic Workflow Manager (AWM). The goal is to validate the CLI tool from a clean state, covering the happy path, edge cases, error handling, and complete cleanup.

## Test Environment
- **OS**: macOS
- **Context**: Clean state (No AWM installed globally, no `~/.awm` directory)

## Test Scenarios

### 1. Installation Phase
- **P1.1 Fresh Install**: Execute the one-liner `curl` install script.
  - *Expected*: Repository clones to `~/.awm/cli-source`, dependencies install, `awm` links globally, and bootstrap runs successfully (pulling registry to `~/.awm/registry`).
- **P1.2 Re-installation (Idempotency)**: Re-execute the `curl` install script.
  - *Expected*: Script detects existing installation, pulls the latest changes via `git pull --ff-only`, reinstalls dependencies, and links without failing.

### 2. General CLI Usage
- **P2.1 Help Command**: Run `awm --help` and `awm add --help`.
  - *Expected*: Displays correct, readable help text with all non-interactive flags documented.
- **P2.2 List Command**: Run `awm list`.
  - *Expected*: Displays a formatted table of all available skills, workflows, and processes currently in the `Kodria` repository.

### 3. Interactive Installation (`awm add`)
- **P3.1 Single Skill (Symlink)**: Run `awm add` interactively. Select a skill (e.g., `brainstorming`), target `antigravity`, scope `local`, method `symlink`.
  - *Expected*: Success message. Verify a valid symlink exists in `.agents/skills/brainstorming` pointing to `~/.awm/registry/...`.
- **P3.2 Repeat Installation Error**: Attempt to install the same skill again.
  - *Expected*: Graceful error message indicating the artifact already exists, without throwing an unhandled exception.
- **P3.3 Process Installation (Copy)**: Run `awm add` interactively. Select a process (e.g., `docs-system-orchestrator`), target `opencode` (to test alternate path), scope `global`, method `copy`.
  - *Expected*: Success message. Verify the physical files are copied to `~/.gemini/opencode/global_workflows/...`.

### 4. Non-Interactive Installation (Flags)
- **P4.1 Full Flags**: Run `awm add "project-context-init" --type workflow --agent antigravity --scope local --method copy --yes`.
  - *Expected*: Installs instantly without prompting the user. Files verified in local `.agents/workflows/`.
- **P4.2 Missing Flags**: Run `awm add "some-skill" --yes`.
  - *Expected*: Fallback to config preferences (likely `antigravity`, `local`, `symlink`) and install successfully.

### 5. Config Management
- **P5.1 Preferences Creation**: Verify that running commands created the `~/.awm/preferences.json` file.
  - *Expected*: File exists and contains default JSON values.

### 6. Updates & Network Edge Cases
- **P6.1 Registry Update**: Run `awm update`.
  - *Expected*: Synchronizes `~/.awm/registry` with remote repository.
- **P6.2 Offline Simulation**: Temporarily disable Wi-Fi and run `awm update`.
  - *Expected*: Fails gracefully with a network error, not an unhandled crash. (We can skip this if disruptive, or test a simulated network failure).

### 7. Uninstallation Phase
- **P7.1 Remote Uninstall**: Run `curl -fsSL https://raw.githubusercontent.com/Kodria/agentic-workflow/master/uninstall.sh | bash`.
  - *Expected*: Removes `awm` global binary and `~/.awm` directory. Leaves `.agents` intact.
- **P7.2 Post-Uninstall Verification**: Run `awm list`.
  - *Expected*: `zsh: command not found: awm`.
