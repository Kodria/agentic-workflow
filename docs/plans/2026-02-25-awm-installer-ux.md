# AWM Installer UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide a clean, native bash spinner for the AWM CLI installation script, hiding verbose process outputs while gracefully handling errors.

**Architecture:** Native bash background process taking a PID, combined with a wrapper function to redirect command output to a temporary log file (`/tmp/awm-install.log`).

**Tech Stack:** Bash

---

### Task 1: Add Spinner Utilities and Refactor CLI Commands

**Files:**
- Modify: `install.sh`

**Step 1: Write the spinner functions**

Add the following at the top of `install.sh` after `set -e`:

```bash
LOG_FILE="/tmp/awm-install.log"
> "$LOG_FILE" # clear previous log

spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    while [ "$(ps a | awk '{print $1}' | grep "$pid")" ]; do
        local temp=${spinstr#?}
        printf " [%c]  " "$spinstr"
        local spinstr=$temp${spinstr%"$temp"}
        sleep $delay
        printf "\b\b\b\b\b\b"
    done
    printf "    \b\b\b\b"
}

run_with_spinner() {
    local message="$1"
    shift
    local cmd=("$@")

    printf "%s" "$message"
    "${cmd[@]}" >> "$LOG_FILE" 2>&1 &
    local pid=$!

    spinner $pid

    wait $pid
    local status=$?
    if [ $status -ne 0 ]; then
        echo -e "\n❌ Error: Output logged to $LOG_FILE. Last 15 lines:"
        tail -n 15 "$LOG_FILE"
        exit $status
    fi
    echo -e "\r✅ $message"
    return 0
}
```

**Step 2: Update Clone/Pull**

Replace lines ~27-35 (`git pull` / `git clone`):

```bash
# Clone or pull the repository
if [ -d "$INSTALL_DIR" ]; then
    cd "$INSTALL_DIR"
    run_with_spinner "🔄 Updating existing installation..." git pull --ff-only origin main
else
    run_with_spinner "📥 Cloning repository..." git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi
```

**Step 3: Update NPM Install & Build**

Replace lines ~37-42:

```bash
# Install and link globally from the cli/ directory
echo "📦 Installing dependencies and building..."
cd "$INSTALL_DIR/cli"

run_with_spinner "📦 Installing NPM dependencies..." npm install --production=false
run_with_spinner "🔨 Building TypeScript..." npm run build
run_with_spinner "🔗 Linking CLI globally..." npm link
```

**Step 4: Update Registry Bootstrap**

Replace lines ~44-46:

```bash
# Bootstrap the registry
run_with_spinner "🔄 Bootstrapping local registry..." awm update
```

**Step 5: Test Execution**

Run: `bash install.sh`
Expected: Output is hidden behind spinners, final success messages are printed. No raw `npm` or `tsc` output should be visible unless an error occurs.

**Step 6: Commit**

```bash
git add install.sh
git commit -m "feat(installer): implement native bash spinner for clean ux"
```
