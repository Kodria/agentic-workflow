# Bootstrap Hook Port Implementation Plan
<!-- awm-plan-closed: 2026-06-09 — ejecutado; cierre administrativo retroactivo, verificado contra historial de git (previo a la existencia del marcador awm-qa-complete) -->

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a SessionStart hook that injects the `using-awm` bootstrap skill into Claude Code at startup/clear/compact, enforcing the "1% chance → MUST invoke" discipline that AWM today lacks.

**Architecture:** New skill `using-awm` + bash hook scripts in `registry/hooks/` + new CLI subcommand `awm hooks {install,uninstall,status}` that syncs scripts to `~/.awm/hooks/` and merges the entry into `~/.claude/settings.json`. Single-harness (Claude Code) in this iteration; the `ProviderConfig` is extended with an optional `hooks` field for future harnesses. Override-friendly via `AWM_HOME` env var for tests.

**Tech Stack:** Node.js + TypeScript (commander + @clack/prompts + picocolors), Jest + ts-jest for unit tests, bash for the hook script itself, bash test harness for the script.

**Spec:** [2026-05-22-bootstrap-hook-port-design.md](2026-05-22-bootstrap-hook-port-design.md)

**Branch:** `feature/update-versions` (no worktree — continues on the existing branch alongside the v5.1 sync changes; commits will be grouped at the end).

---

## Task 1: Skill `using-awm`

**Files:**
- Create: `registry/skills/using-awm/SKILL.md`
- Create: `cli/tests/registry/using-awm.test.ts`

**Step 1: Write the failing test**

Create `cli/tests/registry/using-awm.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';

describe('using-awm skill', () => {
    const skillPath = path.join(__dirname, '../../../registry/skills/using-awm/SKILL.md');

    it('exists at the expected path', () => {
        expect(fs.existsSync(skillPath)).toBe(true);
    });

    it('has a valid frontmatter with required fields', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        expect(match).not.toBeNull();

        const frontmatter = match![1];
        expect(frontmatter).toMatch(/^name:\s*using-awm\s*$/m);
        expect(frontmatter).toMatch(/^description:\s*.+$/m);
    });

    it('does NOT contain a model: field (aligned with canon)', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).not.toMatch(/^model:\s*/m);
    });

    it('contains the imperative bootstrap rule (1% pattern)', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toMatch(/1%/);
        expect(content).toMatch(/MUST invoke/i);
    });

    it('contains SUBAGENT-STOP block (prevents recursion)', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toMatch(/<SUBAGENT-STOP>/);
    });

    it('points to development-process as default orchestrator', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toMatch(/development-process/);
    });
});
```

**Step 2: Run test to verify it fails**

```
cd cli && npm test -- --testPathPattern using-awm
```
Expected: FAIL — `SKILL.md does not exist`.

**Step 3: Write the skill**

Create `registry/skills/using-awm/SKILL.md`:

```markdown
---
name: using-awm
description: Use when starting any conversation - establishes how to find and use skills, requiring Skill tool invocation before ANY response including clarifying questions
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## Instruction Priority

AWM skills override default system prompt behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **AWM skills** — override default system behavior where they conflict
3. **Default system prompt** — lowest priority

If CLAUDE.md or AGENTS.md says "don't use TDD" and a skill says "always use TDD," follow the user's instructions. The user is in control.

## How to Access Skills

Use the `Skill` tool. When you invoke a skill, its content is loaded and presented to you — follow it directly. **Never use the Read tool on skill files.**

# Using Skills

## The Rule

**Invoke relevant or requested skills BEFORE any response or action.** Even a 1% chance a skill might apply means that you should invoke the skill to check. If an invoked skill turns out to be wrong for the situation, you don't need to use it.

## Orchestration

For development tasks, your default entry point is the `development-process` skill — it routes to brainstorming, writing-plans, execution, and finishing based on project state. Invoke it on any new development work unless the user explicitly says otherwise.

For documentation tasks, the equivalent entry point is `docs-system-orchestrator`.

## Red Flags

These thoughts mean STOP — you're rationalizing:

- "I know what to do, I don't need the skill" → **INVOKE IT**
- "It's a simple request, the skill is overkill" → **INVOKE IT**
- "I'll just answer first, then check if a skill applies" → **INVOKE IT FIRST**
- "The skill description doesn't exactly match" → **INVOKE IT IF THERE'S 1% CHANCE**
- "The user just asked a question, no skill needed" → **CHECK FIRST**

The skill decides if it applies, not you.

## Announcing Skill Use

When you invoke a skill, announce it briefly: *"I'm using the {skill-name} skill to {purpose}."* This makes the process visible to the user and confirms to yourself that you're following the discipline.

## Checklist-Driven Skills

If a skill provides a checklist, create a task for each item with the task tool and complete them in order. Skills are designed to be followed exactly — do not skip steps or reorder them.
```

**Step 4: Run test to verify it passes**

```
cd cli && npm test -- --testPathPattern using-awm
```
Expected: PASS — all 6 cases green.

**Step 5: Commit**

```bash
git add registry/skills/using-awm/SKILL.md cli/tests/registry/using-awm.test.ts
git commit -m "feat(registry): add using-awm bootstrap skill"
```

---

## Task 2: Hook scripts (`session-start` + `run-hook.cmd`)

**Files:**
- Create: `registry/hooks/session-start`
- Create: `registry/hooks/run-hook.cmd`
- Create: `cli/tests/hooks/test-session-start.sh`

**Step 1: Write the failing bash test**

Create `cli/tests/hooks/test-session-start.sh` (executable):

```bash
#!/usr/bin/env bash
# Test harness for registry/hooks/session-start
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="${SCRIPT_DIR}/../../../registry/hooks/session-start"

TMPDIR=$(mktemp -d)
trap "rm -rf '$TMPDIR'" EXIT

pass=0
fail=0
fail_messages=()

assert_json_valid() {
    local json="$1"
    local label="$2"
    if echo "$json" | python3 -c 'import sys, json; json.load(sys.stdin)' 2>/dev/null; then
        echo "  ✓ $label"
        pass=$((pass + 1))
    else
        echo "  ✗ $label"
        fail=$((fail + 1))
        fail_messages+=("$label — invalid JSON: $json")
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local label="$3"
    if echo "$haystack" | python3 -c "import sys, json; obj=json.load(sys.stdin); ctx=obj.get('hookSpecificOutput',{}).get('additionalContext',''); sys.exit(0 if '$needle' in ctx else 1)" 2>/dev/null; then
        echo "  ✓ $label"
        pass=$((pass + 1))
    else
        echo "  ✗ $label"
        fail=$((fail + 1))
        fail_messages+=("$label — decoded context did not contain: $needle")
    fi
}

echo "Test 1: Happy path (ASCII content)"
AWM_HOOKS_ROOT="$TMPDIR" SKILL_DIR="$TMPDIR"
printf 'hello world\n' > "$SKILL_DIR/using-awm.md"
output=$(AWM_HOOKS_ROOT="$AWM_HOOKS_ROOT" bash "$HOOK_SCRIPT" 2>/dev/null)
assert_json_valid "$output" "produces valid JSON"
assert_contains "$output" "hello world" "decoded context contains skill body"

echo ""
echo "Test 2: Special characters (quotes, backslashes, newlines)"
printf '%s\n' 'has "quotes" and \backslashes and' 'multi-line' > "$SKILL_DIR/using-awm.md"
output=$(AWM_HOOKS_ROOT="$AWM_HOOKS_ROOT" bash "$HOOK_SCRIPT" 2>/dev/null)
assert_json_valid "$output" "produces valid JSON with special chars"
assert_contains "$output" "quotes" "decoded context preserves quoted text"

echo ""
echo "Test 3: Missing using-awm.md (failure-safe)"
rm -f "$SKILL_DIR/using-awm.md"
output=$(AWM_HOOKS_ROOT="$AWM_HOOKS_ROOT" bash "$HOOK_SCRIPT" 2>/dev/null)
exit_code=$?
assert_json_valid "$output" "still produces valid JSON when skill missing"
if [ "$exit_code" = "0" ]; then
    echo "  ✓ exits 0 (failure-safe)"
    pass=$((pass + 1))
else
    echo "  ✗ exit code was $exit_code, expected 0"
    fail=$((fail + 1))
fi

echo ""
echo "Test 4: Large skill (10KB)"
python3 -c "print('x' * 10000)" > "$SKILL_DIR/using-awm.md"
start_ms=$(python3 -c "import time; print(int(time.time() * 1000))")
output=$(AWM_HOOKS_ROOT="$AWM_HOOKS_ROOT" bash "$HOOK_SCRIPT" 2>/dev/null)
end_ms=$(python3 -c "import time; print(int(time.time() * 1000))")
elapsed=$((end_ms - start_ms))
assert_json_valid "$output" "handles 10KB skill"
if [ "$elapsed" -lt 500 ]; then
    echo "  ✓ completed in ${elapsed}ms (<500ms)"
    pass=$((pass + 1))
else
    echo "  ✗ took ${elapsed}ms (slower than 500ms)"
    fail=$((fail + 1))
fi

echo ""
echo "Test 5: Output structure (hookSpecificOutput.additionalContext)"
printf 'content\n' > "$SKILL_DIR/using-awm.md"
output=$(AWM_HOOKS_ROOT="$AWM_HOOKS_ROOT" bash "$HOOK_SCRIPT" 2>/dev/null)
if echo "$output" | python3 -c "import sys, json; obj=json.load(sys.stdin); assert 'hookSpecificOutput' in obj; assert obj['hookSpecificOutput']['hookEventName'] == 'SessionStart'; assert 'additionalContext' in obj['hookSpecificOutput']" 2>/dev/null; then
    echo "  ✓ JSON has expected Claude Code hook structure"
    pass=$((pass + 1))
else
    echo "  ✗ JSON missing expected structure"
    fail=$((fail + 1))
fi

echo ""
echo "================================"
echo "Results: $pass passed, $fail failed"
if [ "$fail" -gt 0 ]; then
    echo ""
    echo "Failures:"
    for msg in "${fail_messages[@]}"; do
        echo "  - $msg"
    done
    exit 1
fi
```

Make executable: `chmod +x cli/tests/hooks/test-session-start.sh`.

**Step 2: Run test to verify it fails**

```bash
bash cli/tests/hooks/test-session-start.sh
```
Expected: FAIL — hook script does not exist.

**Step 3: Write `session-start` script**

Create `registry/hooks/session-start` (no extension):

```bash
#!/usr/bin/env bash
# SessionStart hook for AWM bootstrap.
# Reads ${AWM_HOOKS_ROOT}/using-awm.md and emits a Claude Code-compatible JSON.

set -euo pipefail

# Determine hooks root. Set via env var so tests can override.
# Defaults to the directory containing this script (assumes installed at ~/.awm/hooks/).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AWM_HOOKS_ROOT="${AWM_HOOKS_ROOT:-$SCRIPT_DIR}"

SKILL_FILE="${AWM_HOOKS_ROOT}/using-awm.md"

# Failure-safe: missing skill produces empty context instead of crashing.
if [ -f "$SKILL_FILE" ]; then
    using_awm_content=$(cat "$SKILL_FILE")
else
    using_awm_content=""
fi

# Escape string for JSON via bash parameter substitution (orders of magnitude
# faster than character loops). Same approach as superpowers canon.
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

using_awm_escaped=$(escape_for_json "$using_awm_content")

# Wrap with the imperative envelope, then escape the whole thing again
# (the envelope itself doesn't need re-escaping — it's plain ASCII).
session_context="<EXTREMELY_IMPORTANT>\nYou have AWM.\n\n**Below is the full content of your 'using-awm' skill — your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_awm_escaped}\n</EXTREMELY_IMPORTANT>"

# Emit Claude Code format using printf (avoids bash 5.3+ heredoc hang).
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context"

exit 0
```

Make executable: `chmod +x registry/hooks/session-start`.

**Step 4: Create `run-hook.cmd` (verbatim port from canon)**

Create `registry/hooks/run-hook.cmd`:

```bash
: << 'CMDBLOCK'
@echo off
REM Cross-platform polyglot wrapper for hook scripts.
REM On Windows: cmd.exe runs the batch portion, which finds and calls bash.
REM On Unix: the shell interprets this as a script (: is a no-op in bash).
REM
REM Hook scripts use extensionless filenames (e.g. "session-start") so Claude
REM Code's Windows auto-detection — which prepends "bash" to any command
REM containing .sh — doesn't interfere.
REM
REM Usage: run-hook.cmd <script-name> [args...]

if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)

set "HOOK_DIR=%~dp0"

REM Try Git for Windows bash in standard locations
if exist "C:\Program Files\Git\bin\bash.exe" (
    "C:\Program Files\Git\bin\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
if exist "C:\Program Files (x86)\Git\bin\bash.exe" (
    "C:\Program Files (x86)\Git\bin\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)

REM Try bash on PATH (Git Bash, MSYS2, Cygwin)
where bash >nul 2>nul
if %ERRORLEVEL% equ 0 (
    bash "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)

REM No bash found — exit silently rather than error
exit /b 0
CMDBLOCK

# Unix: run the named script directly
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
shift
exec bash "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@"
```

Make executable: `chmod +x registry/hooks/run-hook.cmd`.

**Step 5: Run test to verify it passes**

```bash
bash cli/tests/hooks/test-session-start.sh
```
Expected: PASS — `Results: 7 passed, 0 failed`.

**Step 6: Commit**

```bash
git add registry/hooks/ cli/tests/hooks/test-session-start.sh
git commit -m "feat(hooks): add session-start bash script and polyglot wrapper"
```

---

## Task 3: Extend `ProviderConfig` with `HookConfig`

**Files:**
- Modify: `cli/src/providers/index.ts`
- Create: `cli/tests/providers/hooks-config.test.ts`

**Step 1: Write the failing test**

Create `cli/tests/providers/hooks-config.test.ts`:

```typescript
import { PROVIDERS, getHookConfig } from '../../src/providers';

describe('Hook configuration in providers', () => {
    it('claude-code provider defines a HookConfig', () => {
        const cc = PROVIDERS['claude-code'];
        expect(cc.hooks).toBeDefined();
        expect(cc.hooks?.type).toBe('cc-settings-merge');
        expect(cc.hooks?.eventName).toBe('SessionStart');
        expect(cc.hooks?.matcher).toBe('startup|clear|compact');
    });

    it('claude-code settingsPath resolves to ~/.claude/settings.json', () => {
        const cc = PROVIDERS['claude-code'];
        expect(cc.hooks?.settingsPath).toMatch(/\.claude\/settings\.json$/);
    });

    it('claude-code scriptsDir resolves to ~/.awm/hooks/', () => {
        const cc = PROVIDERS['claude-code'];
        expect(cc.hooks?.scriptsDir).toMatch(/\.awm\/hooks$/);
    });

    it('antigravity and opencode have no hooks (single-harness scope)', () => {
        expect(PROVIDERS['antigravity'].hooks).toBeUndefined();
        expect(PROVIDERS['opencode'].hooks).toBeUndefined();
    });

    it('getHookConfig returns config for supported target', () => {
        const config = getHookConfig('claude-code');
        expect(config).toBeDefined();
        expect(config?.type).toBe('cc-settings-merge');
    });

    it('getHookConfig returns undefined for unsupported target', () => {
        const config = getHookConfig('antigravity');
        expect(config).toBeUndefined();
    });

    it('respects AWM_HOME env var override for scriptsDir', () => {
        const originalEnv = process.env.AWM_HOME;
        process.env.AWM_HOME = '/tmp/awm-test';

        // Re-import to pick up env change
        jest.resetModules();
        const { PROVIDERS: P } = require('../../src/providers');
        expect(P['claude-code'].hooks.scriptsDir).toBe('/tmp/awm-test/hooks');

        if (originalEnv === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalEnv;
    });
});
```

**Step 2: Run test to verify it fails**

```
cd cli && npm test -- --testPathPattern hooks-config
```
Expected: FAIL — `hooks` field doesn't exist on `ProviderConfig`, `getHookConfig` not exported.

**Step 3: Modify `cli/src/providers/index.ts`**

Replace the file content with:

```typescript
// src/providers/index.ts
import os from 'os';
import path from 'path';

export type AgentTarget = 'antigravity' | 'opencode' | 'claude-code';
export type Scope = 'global' | 'local';
export type ArtifactType = 'skill' | 'workflow' | 'agent';

type ArtifactConfig = {
    global: string;
    local: string;
};

export type HookConfig = {
    type: 'cc-settings-merge';
    settingsPath: string;
    scriptsDir: string;
    matcher: string;
    eventName: string;
};

export type ProviderConfig = {
    label: string;
    skill: ArtifactConfig;
    workflow: ArtifactConfig | null;
    agent: ArtifactConfig | null;
    hooks?: HookConfig;
};

const homedir = os.homedir();
const awmHome = process.env.AWM_HOME || path.join(homedir, '.awm');

export const PROVIDERS: Record<AgentTarget, ProviderConfig> = {
    antigravity: {
        label: 'Antigravity',
        skill:    { global: path.join(homedir, '.gemini/antigravity/skills'),           local: '.agent/skills' },
        workflow: { global: path.join(homedir, '.gemini/antigravity/global_workflows'), local: '.agent/workflows' },
        agent:    null
    },
    opencode: {
        label: 'OpenCode',
        skill:    { global: path.join(homedir, '.agents/skills'),          local: '.agents/skills' },
        workflow: null,
        agent:    { global: path.join(homedir, '.config/opencode/agents'), local: '.agents/profiles' }
    },
    'claude-code': {
        label: 'Claude Code',
        skill:    { global: path.join(homedir, '.claude/skills'),  local: '.claude/skills' },
        workflow: null,
        agent:    { global: path.join(homedir, '.claude/agents'),  local: '.claude/agents' },
        hooks: {
            type: 'cc-settings-merge',
            settingsPath: path.join(homedir, '.claude/settings.json'),
            scriptsDir: path.join(awmHome, 'hooks'),
            matcher: 'startup|clear|compact',
            eventName: 'SessionStart'
        }
    }
};

export function getTargetPath(type: ArtifactType, agent: AgentTarget, scope: Scope): string {
    const provider = PROVIDERS[agent];
    if (!provider) throw new Error(`Unknown agent target: ${agent}`);

    const config = provider[type];
    if (!config) throw new Error(`${type}s are not supported by ${provider.label}.`);

    return config[scope];
}

export function getHookConfig(agent: AgentTarget): HookConfig | undefined {
    const provider = PROVIDERS[agent];
    return provider?.hooks;
}
```

**Step 4: Run test to verify it passes**

```
cd cli && npm test -- --testPathPattern hooks-config
```
Expected: PASS — 7 tests green.

**Step 5: Commit**

```bash
git add cli/src/providers/index.ts cli/tests/providers/hooks-config.test.ts
git commit -m "feat(providers): add HookConfig to claude-code provider"
```

---

## Task 4: Implement `awm hooks status` command (core logic)

**Files:**
- Create: `cli/src/commands/hooks/status.ts`
- Create: `cli/tests/commands/hooks/status.test.ts`

**Step 1: Write the failing test**

Create `cli/tests/commands/hooks/status.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import { computeHookStatus } from '../../../src/commands/hooks/status';

describe('computeHookStatus', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    function setupInstalledHook(scriptContent = '#!/usr/bin/env bash\necho "{}"') {
        const hooksDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(hooksDir, { recursive: true });
        fs.writeFileSync(path.join(hooksDir, 'session-start'), scriptContent, { mode: 0o755 });
        fs.writeFileSync(path.join(hooksDir, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        fs.writeFileSync(path.join(hooksDir, 'using-awm.md'), '# using-awm\nMUST invoke skills.\n');

        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
            hooks: {
                SessionStart: [{
                    matcher: 'startup|clear|compact',
                    hooks: [{ type: 'command', command: `${hooksDir}/run-hook.cmd session-start`, async: false }]
                }]
            }
        }, null, 2));
    }

    it('reports HEALTHY when everything is in place', () => {
        setupInstalledHook();
        const { computeHookStatus: fn } = require('../../../src/commands/hooks/status');
        const result = fn('claude-code');
        expect(result.overall).toBe('HEALTHY');
        expect(result.checks.bootstrapSkill.ok).toBe(true);
        expect(result.checks.sessionStartScript.ok).toBe(true);
        expect(result.checks.runHookWrapper.ok).toBe(true);
        expect(result.checks.settingsEntry.ok).toBe(true);
    });

    it('reports DEGRADED when bootstrap skill is missing', () => {
        setupInstalledHook();
        fs.unlinkSync(path.join(tmpHome, '.awm/hooks/using-awm.md'));
        const { computeHookStatus: fn } = require('../../../src/commands/hooks/status');
        const result = fn('claude-code');
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.bootstrapSkill.ok).toBe(false);
    });

    it('reports NOT_INSTALLED when settings.json has no AWM entry', () => {
        setupInstalledHook();
        const claudeDir = path.join(tmpHome, '.claude');
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({}, null, 2));
        const { computeHookStatus: fn } = require('../../../src/commands/hooks/status');
        const result = fn('claude-code');
        expect(result.overall).toBe('NOT_INSTALLED');
        expect(result.checks.settingsEntry.ok).toBe(false);
    });

    it('reports DEGRADED when script is missing executable bit', () => {
        setupInstalledHook();
        fs.chmodSync(path.join(tmpHome, '.awm/hooks/session-start'), 0o644);
        const { computeHookStatus: fn } = require('../../../src/commands/hooks/status');
        const result = fn('claude-code');
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.sessionStartScript.ok).toBe(false);
    });

    it('throws when agent target has no hooks config', () => {
        const { computeHookStatus: fn } = require('../../../src/commands/hooks/status');
        expect(() => fn('antigravity')).toThrow(/hooks not supported/i);
    });
});
```

**Step 2: Run test to verify it fails**

```
cd cli && npm test -- --testPathPattern hooks/status
```
Expected: FAIL — module does not exist.

**Step 3: Implement `computeHookStatus`**

Create `cli/src/commands/hooks/status.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { AgentTarget, getHookConfig } from '../../providers';

export type CheckResult = {
    ok: boolean;
    detail: string;
};

export type HookStatus = {
    overall: 'HEALTHY' | 'DEGRADED' | 'NOT_INSTALLED';
    checks: {
        bootstrapSkill: CheckResult;
        sessionStartScript: CheckResult;
        runHookWrapper: CheckResult;
        settingsEntry: CheckResult;
    };
};

function checkExecutable(file: string): CheckResult {
    if (!fs.existsSync(file)) {
        return { ok: false, detail: `missing: ${file}` };
    }
    try {
        fs.accessSync(file, fs.constants.X_OK);
        return { ok: true, detail: file };
    } catch {
        return { ok: false, detail: `not executable: ${file}` };
    }
}

function checkFile(file: string): CheckResult {
    if (!fs.existsSync(file)) {
        return { ok: false, detail: `missing: ${file}` };
    }
    // Follow symlinks: if broken, fs.existsSync still returns false; here we check that the link target resolves.
    try {
        fs.statSync(file);
        return { ok: true, detail: file };
    } catch {
        return { ok: false, detail: `broken link: ${file}` };
    }
}

function checkSettingsEntry(settingsPath: string, scriptsDir: string, matcher: string): CheckResult {
    if (!fs.existsSync(settingsPath)) {
        return { ok: false, detail: `settings.json not found: ${settingsPath}` };
    }
    let parsed: any;
    try {
        parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
        return { ok: false, detail: 'settings.json is not valid JSON' };
    }
    const entries: any[] = parsed?.hooks?.SessionStart ?? [];
    const awmEntry = entries.find((e) =>
        e?.matcher === matcher &&
        (e?.hooks ?? []).some((h: any) => typeof h?.command === 'string' && h.command.includes(scriptsDir))
    );
    if (!awmEntry) {
        return { ok: false, detail: `no AWM SessionStart entry in ${settingsPath}` };
    }
    return { ok: true, detail: settingsPath };
}

export function computeHookStatus(agent: AgentTarget): HookStatus {
    const config = getHookConfig(agent);
    if (!config) {
        throw new Error(`hooks not supported for agent target: ${agent}`);
    }

    const checks = {
        bootstrapSkill: checkFile(path.join(config.scriptsDir, 'using-awm.md')),
        sessionStartScript: checkExecutable(path.join(config.scriptsDir, 'session-start')),
        runHookWrapper: checkExecutable(path.join(config.scriptsDir, 'run-hook.cmd')),
        settingsEntry: checkSettingsEntry(config.settingsPath, config.scriptsDir, config.matcher)
    };

    const allOk = Object.values(checks).every((c) => c.ok);
    const settingsOnlyMissing = !checks.settingsEntry.ok && checks.bootstrapSkill.ok && checks.sessionStartScript.ok && checks.runHookWrapper.ok;

    let overall: HookStatus['overall'];
    if (allOk) overall = 'HEALTHY';
    else if (settingsOnlyMissing) overall = 'NOT_INSTALLED';
    else overall = 'DEGRADED';

    return { overall, checks };
}
```

**Step 4: Run test to verify it passes**

```
cd cli && npm test -- --testPathPattern hooks/status
```
Expected: PASS — 5 tests green.

**Step 5: Commit**

```bash
git add cli/src/commands/hooks/status.ts cli/tests/commands/hooks/status.test.ts
git commit -m "feat(cli): add hooks status core logic"
```

---

## Task 5: Implement `awm hooks install` core logic (happy path + merge)

**Files:**
- Create: `cli/src/commands/hooks/install.ts`
- Create: `cli/tests/commands/hooks/install.test.ts`

This task implements the install logic with TWO test cases: happy path and merge. Edge cases come in Task 6.

**Step 1: Write the failing test**

Create `cli/tests/commands/hooks/install.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('installHook (happy path + merge)', () => {
    let tmpHome: string;
    let tmpRegistry: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-install-'));
        tmpRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-registry-'));

        // Mock registry layout: registry/hooks/{session-start,run-hook.cmd} + registry/skills/using-awm/SKILL.md
        const regHooks = path.join(tmpRegistry, 'registry/hooks');
        const regSkill = path.join(tmpRegistry, 'registry/skills/using-awm');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.mkdirSync(regSkill, { recursive: true });
        fs.writeFileSync(path.join(regHooks, 'session-start'), '#!/usr/bin/env bash\necho "{}"', { mode: 0o755 });
        fs.writeFileSync(path.join(regHooks, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        fs.writeFileSync(path.join(regSkill, 'SKILL.md'), '---\nname: using-awm\n---\nMUST invoke skills.');

        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRegistry, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it('installs on a clean system, creating settings.json with the AWM entry', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        const result = installHook({
            agent: 'claude-code',
            registryRoot: tmpRegistry,
            installMethod: 'symlink'
        });

        expect(result.status).toBe('installed');

        // Scripts synced
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        expect(fs.existsSync(path.join(scriptsDir, 'session-start'))).toBe(true);
        expect(fs.existsSync(path.join(scriptsDir, 'run-hook.cmd'))).toBe(true);
        // Skill symlinked (regardless of installMethod)
        expect(fs.lstatSync(path.join(scriptsDir, 'using-awm.md')).isSymbolicLink()).toBe(true);

        // Settings.json has the AWM entry
        const settings = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf-8'));
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].matcher).toBe('startup|clear|compact');
        expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('run-hook.cmd');

        // Backup created (if pre-existing settings was empty, no backup needed; check no crash)
        expect(result.backupPath).toBeNull();
    });

    it('merges with pre-existing SessionStart entry from another plugin', () => {
        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const preExisting = {
            theme: 'dark',
            hooks: {
                SessionStart: [{
                    matcher: 'startup',
                    hooks: [{ type: 'command', command: '/some/other/plugin/hook' }]
                }]
            }
        };
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(preExisting, null, 2));

        const { installHook } = require('../../../src/commands/hooks/install');
        const result = installHook({
            agent: 'claude-code',
            registryRoot: tmpRegistry,
            installMethod: 'symlink'
        });

        expect(result.status).toBe('installed');
        expect(result.backupPath).not.toBeNull();
        expect(fs.existsSync(result.backupPath!)).toBe(true);

        const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));
        // Preserved
        expect(settings.theme).toBe('dark');
        expect(settings.hooks.SessionStart).toHaveLength(2);
        // Order: original first, AWM appended
        expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('/some/other/plugin/hook');
        expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('run-hook.cmd');
    });
});
```

**Step 2: Run test to verify it fails**

```
cd cli && npm test -- --testPathPattern hooks/install
```
Expected: FAIL — module does not exist.

**Step 3: Implement `installHook`**

Create `cli/src/commands/hooks/install.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { AgentTarget, getHookConfig } from '../../providers';

export type InstallOptions = {
    agent: AgentTarget;
    registryRoot: string;        // path to the cloned registry (e.g. ~/.awm/cli-source)
    installMethod: 'symlink' | 'copy';
};

export type InstallResult = {
    status: 'installed' | 'already-up-to-date';
    scriptsDir: string;
    settingsPath: string;
    backupPath: string | null;
};

function syncFile(source: string, dest: string, method: 'symlink' | 'copy'): void {
    if (fs.existsSync(dest) || fs.existsSync(path.dirname(dest))) {
        try { fs.unlinkSync(dest); } catch { /* not exists, fine */ }
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (method === 'symlink') {
        fs.symlinkSync(source, dest);
    } else {
        fs.copyFileSync(source, dest);
        // Preserve executable bit if source had it
        const srcMode = fs.statSync(source).mode;
        fs.chmodSync(dest, srcMode);
    }
}

function backupSettings(settingsPath: string): string | null {
    if (!fs.existsSync(settingsPath)) return null;
    const awmHome = process.env.AWM_HOME || path.join(process.env.HOME!, '.awm');
    const backupDir = path.join(awmHome, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
    const backupPath = path.join(backupDir, `settings.json.${ts}.bak`);
    fs.copyFileSync(settingsPath, backupPath);
    return backupPath;
}

function isAwmEntry(entry: any, scriptsDir: string, matcher: string): boolean {
    return (
        entry?.matcher === matcher &&
        Array.isArray(entry?.hooks) &&
        entry.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes(scriptsDir))
    );
}

export function installHook(options: InstallOptions): InstallResult {
    const config = getHookConfig(options.agent);
    if (!config) {
        throw new Error(`hooks not supported for agent target: ${options.agent}`);
    }

    // 1. Verify registry hook sources exist
    const sourceHooks = path.join(options.registryRoot, 'registry/hooks');
    const sourceSkill = path.join(options.registryRoot, 'registry/skills/using-awm/SKILL.md');
    if (!fs.existsSync(path.join(sourceHooks, 'session-start'))) {
        throw new Error(`AWM registry not found at ${sourceHooks}. Run 'awm update' to refresh the registry.`);
    }
    if (!fs.existsSync(sourceSkill)) {
        throw new Error(`using-awm skill not found at ${sourceSkill}. Run 'awm update' first.`);
    }

    // 2. Sync scripts to scriptsDir
    fs.mkdirSync(config.scriptsDir, { recursive: true });
    syncFile(path.join(sourceHooks, 'session-start'), path.join(config.scriptsDir, 'session-start'), options.installMethod);
    syncFile(path.join(sourceHooks, 'run-hook.cmd'), path.join(config.scriptsDir, 'run-hook.cmd'), options.installMethod);

    // 3. Symlink the skill (ALWAYS symlink, never copy — so awm update propagates)
    const skillDest = path.join(config.scriptsDir, 'using-awm.md');
    try { fs.unlinkSync(skillDest); } catch { /* not exists */ }
    fs.symlinkSync(sourceSkill, skillDest);

    // 4. Backup settings if it exists with content
    const backupPath = backupSettings(config.settingsPath);

    // 5. Read or initialize settings
    let settings: any = {};
    if (fs.existsSync(config.settingsPath)) {
        const raw = fs.readFileSync(config.settingsPath, 'utf-8');
        try {
            settings = JSON.parse(raw);
        } catch {
            throw new Error(`${config.settingsPath} is not valid JSON. Backup created at ${backupPath}. Fix the file manually, then re-run.`);
        }
    } else {
        fs.mkdirSync(path.dirname(config.settingsPath), { recursive: true });
    }

    // 6. Merge AWM entry
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks[config.eventName]) settings.hooks[config.eventName] = [];

    const entries: any[] = settings.hooks[config.eventName];
    const awmEntryIdx = entries.findIndex((e) => isAwmEntry(e, config.scriptsDir, config.matcher));
    const newEntry = {
        matcher: config.matcher,
        hooks: [{
            type: 'command',
            command: `${path.join(config.scriptsDir, 'run-hook.cmd')} session-start`,
            async: false
        }]
    };

    let status: InstallResult['status'];
    if (awmEntryIdx >= 0) {
        // Compare deep equality; if identical, skip the write
        if (JSON.stringify(entries[awmEntryIdx]) === JSON.stringify(newEntry)) {
            return {
                status: 'already-up-to-date',
                scriptsDir: config.scriptsDir,
                settingsPath: config.settingsPath,
                backupPath: null
            };
        }
        entries[awmEntryIdx] = newEntry;
        status = 'installed';
    } else {
        entries.push(newEntry);
        status = 'installed';
    }

    // 7. Write settings.json with indent=2
    fs.writeFileSync(config.settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

    return {
        status,
        scriptsDir: config.scriptsDir,
        settingsPath: config.settingsPath,
        backupPath
    };
}
```

**Step 4: Run test to verify it passes**

```
cd cli && npm test -- --testPathPattern hooks/install
```
Expected: PASS — 2 tests green.

**Step 5: Commit**

```bash
git add cli/src/commands/hooks/install.ts cli/tests/commands/hooks/install.test.ts
git commit -m "feat(cli): add hooks install core logic with merge support"
```

---

## Task 6: Harden `install` with edge cases

**Files:**
- Modify: `cli/tests/commands/hooks/install.test.ts` (add tests)
- Modify: `cli/src/commands/hooks/install.ts` (fix logic where needed)

**Step 1: Add edge case tests**

Append to `cli/tests/commands/hooks/install.test.ts` (inside the same `describe` block):

```typescript
    it('is idempotent — second install does not duplicate', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' });
        const result2 = installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' });

        expect(result2.status).toBe('already-up-to-date');

        const settings = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf-8'));
        expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it('replaces a stale AWM entry when paths change', () => {
        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        // Pre-existing stale entry with same paths but different async flag
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
            hooks: {
                SessionStart: [{
                    matcher: 'startup|clear|compact',
                    hooks: [{ type: 'command', command: `${scriptsDir}/old-script session-start`, async: true }]
                }]
            }
        }, null, 2));

        const { installHook } = require('../../../src/commands/hooks/install');
        const result = installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' });

        expect(result.status).toBe('installed');
        const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('run-hook.cmd');
        expect(settings.hooks.SessionStart[0].hooks[0].async).toBe(false);
    });

    it('aborts and backs up when settings.json is invalid JSON', () => {
        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{ this is not json');

        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' }))
            .toThrow(/not valid JSON/);

        // Original file untouched
        expect(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8')).toBe('{ this is not json');
        // Backup created
        const backups = fs.readdirSync(path.join(tmpHome, '.awm/backups'));
        expect(backups.length).toBeGreaterThan(0);
    });

    it('fails fast when registry is missing', () => {
        fs.rmSync(path.join(tmpRegistry, 'registry'), { recursive: true });

        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' }))
            .toThrow(/registry not found/);

        // Did not create settings.json
        expect(fs.existsSync(path.join(tmpHome, '.claude/settings.json'))).toBe(false);
    });

    it('symlinks using-awm.md even when installMethod is copy (UX choice)', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'copy' });
        const skillPath = path.join(tmpHome, '.awm/hooks/using-awm.md');
        expect(fs.lstatSync(skillPath).isSymbolicLink()).toBe(true);
    });

    it('throws for unsupported agent target', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook({ agent: 'antigravity', registryRoot: tmpRegistry, installMethod: 'symlink' }))
            .toThrow(/not supported/);
    });
```

**Step 2: Run tests to verify (some may pass, some fail)**

```
cd cli && npm test -- --testPathPattern hooks/install
```
Expected: most should pass against the current implementation. If any fail, fix the implementation in `install.ts`.

Likely fixes needed:
- The `JSON.parse` error case may not have access to `backupPath` (since the throw happens before write). The implementation already creates the backup BEFORE parsing — verify the order.
- The "fails fast" case requires the registry check to happen FIRST, before backup. Verify the order in `installHook`.

**Step 3: Verify all 8 tests pass**

```
cd cli && npm test -- --testPathPattern hooks/install
```
Expected: PASS — 8 tests green (2 from Task 5 + 6 new).

**Step 4: Commit**

```bash
git add cli/tests/commands/hooks/install.test.ts cli/src/commands/hooks/install.ts
git commit -m "feat(cli): harden hooks install with edge cases (idempotency, replace, error paths)"
```

---

## Task 7: Implement `awm hooks uninstall`

**Files:**
- Create: `cli/src/commands/hooks/uninstall.ts`
- Create: `cli/tests/commands/hooks/uninstall.test.ts`

**Step 1: Write the failing test**

Create `cli/tests/commands/hooks/uninstall.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('uninstallHook', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-uninstall-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    function writeSettings(content: any) {
        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(content, null, 2));
    }

    function readSettings(): any {
        return JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf-8'));
    }

    it('removes only the AWM entry, preserves other SessionStart entries', () => {
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        writeSettings({
            theme: 'dark',
            hooks: {
                SessionStart: [
                    { matcher: 'startup', hooks: [{ type: 'command', command: '/other/plugin' }] },
                    { matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: `${scriptsDir}/run-hook.cmd session-start`, async: false }] }
                ]
            }
        });

        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        const result = uninstallHook({ agent: 'claude-code' });
        expect(result.status).toBe('uninstalled');

        const settings = readSettings();
        expect(settings.theme).toBe('dark');
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('/other/plugin');
    });

    it('removes the SessionStart key entirely if AWM was the only entry', () => {
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        writeSettings({
            hooks: {
                SessionStart: [
                    { matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: `${scriptsDir}/run-hook.cmd session-start`, async: false }] }
                ]
            }
        });

        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        uninstallHook({ agent: 'claude-code' });

        const settings = readSettings();
        expect(settings.hooks?.SessionStart).toBeUndefined();
    });

    it('is a no-op when no AWM entry exists', () => {
        writeSettings({
            hooks: {
                SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '/other/plugin' }] }]
            }
        });

        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        const result = uninstallHook({ agent: 'claude-code' });
        expect(result.status).toBe('not-installed');

        const settings = readSettings();
        expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it('is a no-op when settings.json does not exist', () => {
        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        const result = uninstallHook({ agent: 'claude-code' });
        expect(result.status).toBe('not-installed');
    });

    it('creates a backup before modifying', () => {
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        writeSettings({
            hooks: {
                SessionStart: [
                    { matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: `${scriptsDir}/run-hook.cmd session-start`, async: false }] }
                ]
            }
        });

        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        const result = uninstallHook({ agent: 'claude-code' });
        expect(result.backupPath).not.toBeNull();
        expect(fs.existsSync(result.backupPath!)).toBe(true);
    });
});
```

**Step 2: Run test to verify it fails**

```
cd cli && npm test -- --testPathPattern hooks/uninstall
```
Expected: FAIL — module does not exist.

**Step 3: Implement `uninstallHook`**

Create `cli/src/commands/hooks/uninstall.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { AgentTarget, getHookConfig } from '../../providers';

export type UninstallOptions = {
    agent: AgentTarget;
};

export type UninstallResult = {
    status: 'uninstalled' | 'not-installed';
    backupPath: string | null;
};

function backupSettings(settingsPath: string): string | null {
    if (!fs.existsSync(settingsPath)) return null;
    const awmHome = process.env.AWM_HOME || path.join(process.env.HOME!, '.awm');
    const backupDir = path.join(awmHome, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
    const backupPath = path.join(backupDir, `settings.json.${ts}.bak`);
    fs.copyFileSync(settingsPath, backupPath);
    return backupPath;
}

function isAwmEntry(entry: any, scriptsDir: string, matcher: string): boolean {
    return (
        entry?.matcher === matcher &&
        Array.isArray(entry?.hooks) &&
        entry.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes(scriptsDir))
    );
}

export function uninstallHook(options: UninstallOptions): UninstallResult {
    const config = getHookConfig(options.agent);
    if (!config) {
        throw new Error(`hooks not supported for agent target: ${options.agent}`);
    }

    if (!fs.existsSync(config.settingsPath)) {
        return { status: 'not-installed', backupPath: null };
    }

    let settings: any;
    try {
        settings = JSON.parse(fs.readFileSync(config.settingsPath, 'utf-8'));
    } catch {
        throw new Error(`${config.settingsPath} is not valid JSON. Manual cleanup required.`);
    }

    const entries: any[] = settings?.hooks?.[config.eventName] ?? [];
    const beforeLength = entries.length;
    const filtered = entries.filter((e) => !isAwmEntry(e, config.scriptsDir, config.matcher));

    if (filtered.length === beforeLength) {
        // Nothing to remove
        return { status: 'not-installed', backupPath: null };
    }

    const backupPath = backupSettings(config.settingsPath);

    if (filtered.length === 0) {
        delete settings.hooks[config.eventName];
        if (Object.keys(settings.hooks).length === 0) {
            delete settings.hooks;
        }
    } else {
        settings.hooks[config.eventName] = filtered;
    }

    fs.writeFileSync(config.settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

    return { status: 'uninstalled', backupPath };
}
```

**Step 4: Run test to verify it passes**

```
cd cli && npm test -- --testPathPattern hooks/uninstall
```
Expected: PASS — 5 tests green.

**Step 5: Commit**

```bash
git add cli/src/commands/hooks/uninstall.ts cli/tests/commands/hooks/uninstall.test.ts
git commit -m "feat(cli): add hooks uninstall command"
```

---

## Task 8: CLI router and command registration

**Files:**
- Create: `cli/src/commands/hooks/index.ts`
- Modify: `cli/src/index.ts`

**Step 1: Write a smoke test for the router**

Create `cli/tests/commands/hooks/router.test.ts`:

```typescript
import { Command } from 'commander';

describe('hooks command router', () => {
    it('registers install, uninstall, and status subcommands', () => {
        const program = new Command();
        const { registerHooksCommand } = require('../../../src/commands/hooks');
        registerHooksCommand(program);

        const hooks = program.commands.find((c: any) => c.name() === 'hooks');
        expect(hooks).toBeDefined();
        const subNames = hooks!.commands.map((c: any) => c.name());
        expect(subNames).toEqual(expect.arrayContaining(['install', 'uninstall', 'status']));
    });
});
```

**Step 2: Run test to verify it fails**

```
cd cli && npm test -- --testPathPattern hooks/router
```
Expected: FAIL — module does not exist.

**Step 3: Create the router**

Create `cli/src/commands/hooks/index.ts`:

```typescript
import { Command } from 'commander';
import pc from 'picocolors';
import path from 'path';
import os from 'os';
import { confirm, isCancel } from '@clack/prompts';
import { getPreferences } from '../../utils/config';
import { installHook } from './install';
import { uninstallHook } from './uninstall';
import { computeHookStatus } from './status';
import type { AgentTarget } from '../../providers';

const DEFAULT_REGISTRY_ROOT = path.join(os.homedir(), '.awm/cli-source');

export function registerHooksCommand(program: Command): void {
    const hooks = program.command('hooks').description('Manage SessionStart bootstrap hooks');

    hooks.command('install')
        .description('Install the AWM bootstrap hook into the target harness')
        .option('-t, --target <target>', 'Target harness (claude-code only in this version)', 'claude-code')
        .option('-y, --yes', 'Skip interactive confirmations', false)
        .action(async (options: { target?: string; yes?: boolean }) => {
            const agent = (options.target ?? 'claude-code') as AgentTarget;
            const prefs = getPreferences();

            try {
                const result = installHook({
                    agent,
                    registryRoot: DEFAULT_REGISTRY_ROOT,
                    installMethod: prefs.installMethod
                });

                if (result.status === 'already-up-to-date') {
                    console.log(pc.green('✓ Hook already installed and up-to-date.'));
                    return;
                }

                console.log('');
                console.log(pc.green('✓ AWM bootstrap hook installed.'));
                console.log('');
                console.log(`  Scripts:        ${result.scriptsDir}/session-start`);
                console.log(`                  ${result.scriptsDir}/run-hook.cmd`);
                console.log(`                  ${result.scriptsDir}/using-awm.md → registry/skills/using-awm/SKILL.md`);
                console.log('');
                console.log(`  Settings file:  ${result.settingsPath}`);
                if (result.backupPath) {
                    console.log(`  Backup:         ${result.backupPath}`);
                }
                console.log('');
                console.log('  Active on:      startup | /clear | /compact');
                console.log('');
                console.log(`  Verify:         ${pc.cyan('awm hooks status')}`);
                console.log(`  Remove:         ${pc.cyan('awm hooks uninstall')}`);
                console.log('');
                console.log(pc.yellow('  ⚠ Restart Claude Code to activate the hook in existing sessions.'));
            } catch (e: any) {
                console.error(pc.red(`✗ ${e.message}`));
                process.exit(1);
            }
        });

    hooks.command('uninstall')
        .description('Remove the AWM bootstrap hook')
        .option('-t, --target <target>', 'Target harness (claude-code only in this version)', 'claude-code')
        .option('-y, --yes', 'Skip interactive confirmations', false)
        .action(async (options: { target?: string; yes?: boolean }) => {
            const agent = (options.target ?? 'claude-code') as AgentTarget;

            if (!options.yes && process.stdin.isTTY) {
                const ok = await confirm({ message: 'Remove AWM bootstrap hook from settings.json?' });
                if (isCancel(ok) || ok !== true) {
                    console.log('Cancelled.');
                    return;
                }
            }

            try {
                const result = uninstallHook({ agent });
                if (result.status === 'not-installed') {
                    console.log(pc.yellow('No AWM hook entry found. Nothing to uninstall.'));
                    return;
                }
                console.log(pc.green('✓ AWM bootstrap hook removed.'));
                if (result.backupPath) {
                    console.log(`  Backup: ${result.backupPath}`);
                }
            } catch (e: any) {
                console.error(pc.red(`✗ ${e.message}`));
                process.exit(1);
            }
        });

    hooks.command('status')
        .description('Check the bootstrap hook installation status')
        .option('-t, --target <target>', 'Target harness (claude-code only in this version)', 'claude-code')
        .action((options: { target?: string }) => {
            const agent = (options.target ?? 'claude-code') as AgentTarget;
            try {
                const result = computeHookStatus(agent);
                const symbol = (ok: boolean) => ok ? pc.green('✓') : pc.red('✗');
                console.log('');
                console.log(`  Bootstrap skill:    ${symbol(result.checks.bootstrapSkill.ok)} ${result.checks.bootstrapSkill.detail}`);
                console.log(`  Session-start:      ${symbol(result.checks.sessionStartScript.ok)} ${result.checks.sessionStartScript.detail}`);
                console.log(`  Run-hook wrapper:   ${symbol(result.checks.runHookWrapper.ok)} ${result.checks.runHookWrapper.detail}`);
                console.log(`  Settings entry:     ${symbol(result.checks.settingsEntry.ok)} ${result.checks.settingsEntry.detail}`);
                console.log('');
                const overall = result.overall === 'HEALTHY' ? pc.green(result.overall) :
                                result.overall === 'NOT_INSTALLED' ? pc.yellow(result.overall) :
                                pc.red(result.overall);
                console.log(`  Status: ${overall}`);
                if (result.overall !== 'HEALTHY') {
                    process.exit(1);
                }
            } catch (e: any) {
                console.error(pc.red(`✗ ${e.message}`));
                process.exit(1);
            }
        });
}
```

**Step 4: Register the router in `cli/src/index.ts`**

Add the import near the top of `cli/src/index.ts` (after existing imports):

```typescript
import { registerHooksCommand } from './commands/hooks';
```

Then, just before `program.parse(...)` (or wherever the command registration block ends), add:

```typescript
registerHooksCommand(program);
```

**Step 5: Run tests and verify**

```
cd cli && npm test -- --testPathPattern hooks/router
cd cli && npm run build
cd cli && node dist/index.js hooks --help
```
Expected: tests pass, build succeeds, help shows `install`, `uninstall`, `status` subcommands.

**Step 6: Commit**

```bash
git add cli/src/commands/hooks/index.ts cli/src/index.ts cli/tests/commands/hooks/router.test.ts
git commit -m "feat(cli): register hooks command router"
```

---

## Task 9: Update `install.sh` with optional hook hint

**Files:**
- Modify: `install.sh`

**Step 1: Read the current end of install.sh**

The "Done" block in `install.sh` ends with:

```bash
echo "    awm --help     Show all commands"
echo "    awm list       Browse available artifacts"
echo "    awm add        Install skills, workflows, or processes"
echo ""
```

**Step 2: Append the hook hint**

Add immediately after the existing block (before the closing of the file):

```bash
echo "  💡 Optional: Enable session-start bootstrap"
echo ""
echo "     The bootstrap enforces 'invoke skills before any action' discipline."
echo "     Run: awm hooks install"
echo ""
```

**Step 3: Verify the script still parses**

```bash
bash -n install.sh
```
Expected: no syntax errors, exit code 0.

**Step 4: Commit**

```bash
git add install.sh
git commit -m "docs(install): add optional hook bootstrap hint to install.sh output"
```

---

## Task 10: E2E test documentation

**Files:**
- Create: `cli/tests/integration/README.md`

**Step 1: Write the documentation**

Create `cli/tests/integration/README.md`:

```markdown
# AWM Hooks — End-to-End Test Protocol

Manual / opt-in CI test that verifies the bootstrap hook actually changes agent behavior in a real Claude Code session.

## Why manual

The hook activates inside Claude Code's runtime, and the only way to verify it works as intended is to run a real session and observe the agent's response. This requires the `claude` CLI and a live API key, consumes tokens, and is therefore not part of the default `npm test` suite.

## Prerequisites

- Claude Code CLI installed and on PATH (`which claude`)
- `ANTHROPIC_API_KEY` env var set (or equivalent auth)
- AWM CLI built (`cd cli && npm run build && npm link`)

## Protocol

```bash
# 1. Set up an isolated HOME and registry
export TMPHOME=$(mktemp -d)
export AWM_HOME="$TMPHOME/.awm"
export HOME_BACKUP="$HOME"
export HOME="$TMPHOME"
mkdir -p "$AWM_HOME/cli-source"
cp -R /path/to/agentic-workflow/registry "$AWM_HOME/cli-source/"

# 2. Install the hook
awm hooks install

# 3. Verify installation
awm hooks status
# Expected: Status: HEALTHY

# 4. Create a tiny project and run Claude Code
mkdir "$TMPHOME/test-project" && cd "$TMPHOME/test-project"
git init -q

claude -p "Make a React todo list" > /tmp/awm-e2e-output.txt

# 5. Restore env
export HOME="$HOME_BACKUP"
unset AWM_HOME HOME_BACKUP

# 6. Verify acceptance criteria
grep -i "brainstorming\|development-process" /tmp/awm-e2e-output.txt
# Expected: at least one match — the agent invoked the orchestrator
# or brainstorming skill BEFORE proposing code.
```

## Acceptance criteria

The agent output (`/tmp/awm-e2e-output.txt`) MUST satisfy at least one of:

- Mentions invoking `development-process` skill
- Mentions invoking `brainstorming` skill
- Asks clarifying questions instead of immediately writing code

If the agent jumps straight to writing React component code without acknowledging the skill system, the bootstrap is NOT firing — investigate `awm hooks status` and the contents of `~/.awm/hooks/using-awm.md`.

## Golden output

Once you confirm the E2E passes locally, save the agent response to:

```
cli/tests/integration/golden-output-<YYYY-MM-DD>.txt
```

Commit it as a reference for future regressions. The golden output is informational, not asserted automatically.

## Gating in CI

If running in CI, gate behind:

```yaml
env:
  AWM_E2E: "1"
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

And skip if `AWM_E2E != 1`.
```

**Step 2: Commit**

```bash
git add cli/tests/integration/README.md
git commit -m "docs(test): add E2E test protocol for bootstrap hook"
```

---

## Final verification

After all 10 tasks are complete, run the full suite once:

```bash
cd cli && npm test
bash cli/tests/hooks/test-session-start.sh
cd cli && npm run build
node cli/dist/index.js hooks --help
```

Expected:
- Jest: ~25 tests pass (7 hooks-config + 6 using-awm + 5 status + 8 install + 5 uninstall + 1 router = 32 new tests, plus the existing executor/discovery/registry/etc. suites)
- Bash test: 7/7 pass
- Build: clean
- Help: shows the three subcommands

If all green, the port is done. Run the E2E protocol manually once and save the golden output to confirm functional acceptance.

---

## Out of scope (deferred follow-ups)

- `awm update` re-syncing `~/.awm/hooks/` automatically (mentioned in design doc Risks)
- Antigravity 2.0, OpenCode, Cursor harness ports
- Distributing AWM as a formal Claude Code plugin (replaces settings.json merge with native plugin hooks)
- Auto-running `awm hooks install` from `install.sh` (intentionally kept opt-in per design)
