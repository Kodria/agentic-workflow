#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🗑️  Uninstalling Agentic Workflow Manager (AWM)..."

# 1. Remove the global npm link
# We use || true to prevent the script from failing if npm isn't found or 'awm' isn't linked
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
