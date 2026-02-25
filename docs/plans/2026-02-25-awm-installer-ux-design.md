# Design: AWM Installer UX Improvements (Bash Native)

## Problem Statement
The current `install.sh` for Agentic Workflow Manager (AWM) is extremely verbose. The user sees `git pull` details, verbose `npm install` warnings, and TypeScript compiler (`tsc`) outputs. This visual noise detracts from the professional feel of the tool. The user wants a clean, quiet, and polished installation experience.

## Selected Approach: Native Bash Spinner
We will implement a pure bash background spinner that runs concurrently with the heavy installation tasks, suppressing all normal output to a log file but gracefully reporting errors if they occur.

## Design Details

### 1. Spinner Implementation
- **Function `spinner()`**: We will add a bash function that takes a PID and an optional message.
- It will loop over an array of characters (`⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`) printing them over the same line using `\r`.
- It will run in the background while the main blocking command runs in the foreground.

### 2. Output Redirection & Logging
- All potentially noisy commands (`git clone`, `git pull`, `npm install`, `npm run build`, `npm link`, and `awm update`) will have their standard output and standard error redirected to a temporary build log (`/tmp/awm-install.log` or similar).

### 3. Execution Flow Example
```bash
# 1. Start the noisy command in the background
npm install --production=false > "$LOG_FILE" 2>&1 &
PID=$!

# 2. Start the spinner in the foreground watching the noisy command's PID
spinner $PID "📦 Installing dependencies..."

# 3. Check exit status
wait $PID
if [ $? -ne 0 ]; then
    echo -e "\n❌ Error installing dependencies. Check $LOG_FILE for details."
    cat "$LOG_FILE" | tail -n 20
    exit 1
fi
```

### 4. Helper Function `run_with_spinner`
To keep the script DRY, we will encapsulate this pattern into a function:
```bash
run_with_spinner() {
    local message="$1"
    shift
    local cmd=("$@")

    # Run command in background redirected to log
    "${cmd[@]}" > "$LOG_FILE" 2>&1 &
    local pid=$!

    # Run spinner
    spinner $pid "$message"

    wait $pid
    return $?
}
```

### 5. Error Handling
If any step fails, we must:
1. Stop the spinner.
2. Show a red `❌ Error` message.
3. Automatically print the last 15-20 lines of the `$LOG_FILE` to the terminal so the user can see exactly why the `git` or `npm` command failed without having to manually hunt down the log file.

### 6. Cleanup
At the end of a successful installation, we can either delete the temporary log file or leave it in a known location (e.g., `~/.awm/install.log`) for debugging purposes.

## Testing Strategy
- **Success Path**: Run the script and verify that only elegant spinner text and final success echoes are seen.
- **Error Path**: Introduce an intentional error (e.g., changing npm install to fail) to verify the spinner stops, the error is printed, and the log tail is shown.
