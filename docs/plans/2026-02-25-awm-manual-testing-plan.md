# 2026-02-25 AWM Exhaustive Manual Testing Plan

> **Note**: This plan is designed for manual execution by the user, step-by-step in the provided `zsh` terminal. The Agent will observe, evaluate, and assist as needed during each step.

---

## Phase 1: Installation from Scratch

**Context:** The terminal should be completely clean (no `awm` binary, no `~/.awm` directory).

### Step 1.1: Run Remote Installer
Test the fresh installation process using the `curl` installer.

**Action (User):**
```bash
curl -fsSL https://raw.githubusercontent.com/Kodria/agentic-workflow/main/install.sh | bash
```

**Evaluation (Agent):**
- Verify the script clones `cli-source`, installs NPM dependencies, links the global binary, and bootstraps the `~/.awm/registry`.
- Confirm no errors occurred during the NPM install or build process.

### Step 1.2: Check Installation Idempotency
Verify that running the installer again gracefully updates and reinstalls without breaking.

**Action (User):**
```bash
curl -fsSL https://raw.githubusercontent.com/Kodria/agentic-workflow/main/install.sh | bash
```

**Evaluation (Agent):**
- Verify `git pull --ff-only` logic triggers correctly in both `cli-source` and `registry`.

---

## Phase 2: CLI Fundamentals

### Step 2.1: Verify Global Context and Help
Check if `awm` is exposed and the help command works.

**Action (User):**
```bash
awm --help
awm add --help
```

**Evaluation (Agent):**
- Ensure all recent flags (type, agent, scope, method, yes) are documented correctly in the help text.

### Step 2.2: Verify Registry Index
Check if the local cache was populated correctly during bootstrap.

**Action (User):**
```bash
awm list
```

**Evaluation (Agent):**
- Output should be a structured table showing available skills, workflows, and processes from the Kodria remote.

---

## Phase 3: Artifact Installation (Interactive & Flags)

### Step 3.1: Interactive Skill Installation (Symlink)
Test the interactive TUI for a standard skill.

**Action (User):**
```bash
awm add
```
- Select: `brainstorming`
- Agent: `antigravity`
- Scope: `local`
- Method: `symlink`

**Evaluation (Agent):**
- Confirm the operation succeeds. Use the terminal to verify the symlink exists in `.agents/skills/brainstorming`.

### Step 3.2: Duplicate Artifact Handling
Verify the explicit error message for existing artifacts.

**Action (User):**
```bash
awm add
```
- Try to install `brainstorming` again.

**Evaluation (Agent):**
- Ensure a clean error message is displayed (e.g., "Artifact already exists") without unhandled exceptions.

### Step 3.3: Non-Interactive Installation (Full Flags)
Test the `--yes` flag to bypass the TUI entirely.

**Action (User):**
```bash
awm add "project-context-init" --type workflow --agent antigravity --scope local --method copy --yes
```

**Evaluation (Agent):**
- Confirm instant installation without prompts.
- Ensure the method respected `copy` instead of `symlink` in `.agents/workflows/project-context-init`.

---

## Phase 4: Updates and Configuration

### Step 4.1: Verify Config Fallbacks
Test installing an artifact without specifying all options, relying on defaults or generated `preferences.json`.

**Action (User):**
```bash
awm add "commit-name" --yes
```

**Evaluation (Agent):**
- Verify it installs successfully using defaults (typically `antigravity`, `local`, `symlink`).

### Step 4.2: Registry Update Mechanism
Test the sync functionality.

**Action (User):**
```bash
awm update
```

**Evaluation (Agent):**
- Confirm the update finishes correctly, pulling latest changes on the `~/.awm/registry` folder.

---

## Phase 5: Cleanup and Uninstallation

### Step 5.1: Remote Uninstall
Test the updated uninstall script from the remote master branch.

**Action (User):**
```bash
curl -fsSL https://raw.githubusercontent.com/Kodria/agentic-workflow/main/uninstall.sh | bash
```

**Evaluation (Agent):**
- Verify the output log says "AWM has been uninstalled successfully".
- Check that `~/.awm` is gone.
- Verify `awm list` returns `zsh: command not found`.

## Execution Handoff
Since the user requested **Manual Execution**, the agent will act as a co-pilot, reading the terminal outputs after each step the user performs, verifying the 'Evaluation' criteria, and giving the green light for the next step.
