#!/usr/bin/env bash

set -e

LOG_FILE="/tmp/awm-install.log"
> "$LOG_FILE" # clear previous log

# ── Spinner utilities ─────────────────────────────────────────────────
spinner() {
    local pid=$1
    local delay=0.1
    local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    while kill -0 "$pid" 2>/dev/null; do
        for (( i=0; i<${#chars}; i++ )); do
            printf "\r  %s " "${chars:$i:1}"
            sleep $delay
        done
    done
    printf "\r      \r"
}

run_step() {
    local message="$1"
    shift

    printf "  ◌  %s" "$message"
    "$@" >> "$LOG_FILE" 2>&1 &
    local pid=$!

    spinner $pid

    wait $pid
    local status=$?
    if [ $status -ne 0 ]; then
        printf "\r  ❌ %s\n" "$message"
        echo ""
        echo "  Error details (last 15 lines of $LOG_FILE):"
        echo "  ─────────────────────────────────────────────"
        tail -n 15 "$LOG_FILE" | sed 's/^/  /'
        exit $status
    fi
    printf "\r  ✅ %s\n" "$message"
    return 0
}

# ── Header ─────────────────────────────────────────────────────────────
echo ""
echo "  🚀 Agentic Workflow Manager (AWM) Installer"
echo "  ─────────────────────────────────────────────"
echo ""

# ── Requirements check ─────────────────────────────────────────────────
missing=0
for cmd in git node npm; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "  ❌ Required: $cmd is not installed."
        missing=1
    fi
done
if [ $missing -ne 0 ]; then
    echo ""
    echo "  Please install the missing dependencies and try again."
    exit 1
fi

REPO_URL="https://github.com/Kodria/agentic-workflow.git"
INSTALL_DIR="$HOME/.awm/cli-source"

# ── Clone or update ────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
    cd "$INSTALL_DIR"
    run_step "Updating repository..." git pull --ff-only origin main
else
    run_step "Cloning repository..." git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# ── Install, build & link ─────────────────────────────────────────────
cd "$INSTALL_DIR/cli"
run_step "Installing dependencies..." npm install --production=false
run_step "Building CLI..." npm run build
run_step "Linking globally..." npm link

# ── Bootstrap registry ─────────────────────────────────────────────────
run_step "Bootstrapping registry..." awm update

# ── Done ───────────────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────────────"
echo "  ✅ AWM installed successfully!"
echo ""
echo "  Get started:"
echo "    awm --help     Show all commands"
echo "    awm list       Browse available artifacts"
echo "    awm add        Install skills, workflows, or processes"
echo ""
