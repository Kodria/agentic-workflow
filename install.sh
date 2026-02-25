#!/usr/bin/env bash

set -e

echo "🚀 Installing Agentic Workflow Manager (AWM)..."

# Requirements check
if ! command -v git &> /dev/null; then
    echo "❌ Error: git is not installed."
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Error: node is not installed."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed."
    exit 1
fi

REPO_URL="https://github.com/Kodria/agentic-workflow.git"
INSTALL_DIR="$HOME/.awm/cli-source"

# Clone or pull the repository
if [ -d "$INSTALL_DIR" ]; then
    echo "🔄 Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull --ff-only origin main
else
    echo "📥 Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install and link globally from the cli/ directory
echo "📦 Installing dependencies and linking globally..."
cd "$INSTALL_DIR/cli"
npm install --production=false
npm run build
npm link

# Bootstrap the registry
echo "🔄 Bootstrapping local registry..."
awm update 2>/dev/null || echo "⚠️  Registry bootstrap skipped (you can run 'awm update' manually later)."

echo ""
echo "✅ AWM installed successfully!"
echo "   Run 'awm --help' to get started."
echo "   Run 'awm list' to see available artifacts."
echo "   Run 'awm add' to install skills, workflows, or processes."
