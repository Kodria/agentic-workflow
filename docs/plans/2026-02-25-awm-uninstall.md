# AWM Remote Uninstall Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a remote bash script to safely uninstall the AWM CLI and its internal cache without deleting personal user data, symmetric to the installation process.

**Architecture:** A root-level `uninstall.sh` script hosted in the repository, invoked via `curl | bash`. It removes the global npm link and the `~/.awm` directory, while explicitly leaving `~/.agents` intact.

**Tech Stack:** Bash, npm, git

---

### Task 1: Create `uninstall.sh` Script

**Files:**
- Create: `uninstall.sh`

**Step 1: Write the script**

```bash
#!/usr/bin/env bash

set -e

echo "🗑️  Uninstalling Agentic Workflow Manager (AWM)..."

# 1. Remove the global npm link
echo "🔗 Unlinking global npm package..."
if command -v npm &> /dev/null; then
    npm rm -g agentic-workflow-manager || true
else
    echo "⚠️ npm not found, skipping global unlink."
fi

# 2. Remove the internal AWM cache directory
AWM_CONFIG_DIR="$HOME/.awm"
if [ -d "$AWM_CONFIG_DIR" ]; then
    echo "📂 Removing AWM configuration and cache directory ($AWM_CONFIG_DIR)..."
    rm -rf "$AWM_CONFIG_DIR"
else
    echo "✅ No local cache found at $AWM_CONFIG_DIR."
fi

echo ""
echo "✅ AWM has been uninstalled successfully."
echo "--------------------------------------------------------"
echo "🛡️  NOTE: Your installed skills and workflows located in "
echo "    ~/.agents/ and ~/.gemini/antigravity/global_workflows"
echo "    have been kept intact to protect your personal files."
echo "    If you wish to remove them, please delete the specific"
echo "    directories or symlinks manually."
echo "--------------------------------------------------------"
```

**Step 2: Make executable**

Run: `chmod +x uninstall.sh`
Expected: PASS (no output)

**Step 3: Commit**

```bash
git add uninstall.sh
git commit -m "feat: add remote uninstall bash script"
```

---

### Task 2: Update Documentation

**Files:**
- Modify: `README.md`

**Step 1: Update README.md section**

Locate the `## 🗑️ Uninstallation` section in `README.md` and replace its content to instruct the user to use the `curl` command instead of a local `./uninstall.sh`.

```markdown
## 🗑️ Uninstallation

To safely remove the AWM CLI and its internal cache without deleting your personal skills or workflows, run the uninstall script using curl:

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/Kodria/agentic-workflow/master/uninstall.sh | bash
\`\`\`

> **Note**: Your installed artifacts in `~/.agents` and `~/.gemini/antigravity/global_workflows` are intentionally left intact to protect personal files. If you wish to remove them, please delete the specific directories or symlinks manually.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update uninstallation instructions to use curl"
```
