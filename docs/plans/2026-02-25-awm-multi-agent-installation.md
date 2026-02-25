# Implementation Plan: AWM Multi-Agent Installation

**Description:** Allow users to seamlessly install skills, workflows, and processes to multiple agents (e.g., Antigravity and OpenCode) simultaneously in a single `awm add` command execution.

## Tasks

### Task 1: Refactor Agent Selection Prompt to Multiselect

**Files:**
- `cli/src/index.ts`

**Code:**
1. Refactor the `targetAgent` variable parsing to become an array: `let targetAgents: AgentTarget[];`
2. If `options.agent` is passed via CLI flags:
   - Split the string by comma (`options.agent.split(',').map(a => a.trim())`).
   - Validate each value against `['antigravity', 'opencode']`.
   - Assign valid agents to `targetAgents`.
3. If no flag is passed, map to interactive mode:
   - Use `@clack/prompts`'s `multiselect()` instead of `select()`.
   - Provide the options: `Antigravity` and `OpenCode`.
   - Ensure the user selects at least one agent. If length is `0`, show an error and exit.
4. Replace existing variables `targetAgent` downstream with `targetAgents`.

**Tests:** 
N/A (CLI logic, interactive prompt verification required after build)

**Commit:**
`git commit -m "feat(cli): allow multiple agent selection via multiselect prompt and comma separated flags"`

---

### Task 2: Adapt Artifact Filtering and Execute Installation Loop

**Files:**
- `cli/src/index.ts`

**Code:**
1. Update Artifact type filtering block:
   - Change `if (targetAgent === 'antigravity')` to `if (targetAgents.includes('antigravity'))` when determining if `workflow` options should be presented.
2. Update the dynamic complementary workflow prompt:
   - Inside the 'skill' selection block, check `if (targetAgents.includes('antigravity'))` before suggesting the complementary workflow.
3. Completely rewrite the final execution block (where `installArtifact` is called):
   - Wrap the execution in an outer loop iterating over `targetAgents`.
   - Wrap the inner loop over `artifactsToInstall`.
   - Add compatibility checks before `installArtifact`:
     - If `currentAgent === 'opencode'` and `artifact.type === 'workflow'`, `console.warn(pc.yellow(`⚠️ Skipping workflow "${artifact.name}" for OpenCode (not supported)`))` and `continue`.
   - Ensure `installArtifact(artifact.name, artifact.sourcePath, currentAgent, scopeVal, methodVal)` correctly receives the loop's `currentAgent`.
   - Summarize the final output: iterate a log line per successful install in the format `Installed: {name} -> {agent} ({scope})`.

**Tests:**
N/A (CLI logic, manual testing required for compatibility skips and multi-agent installs)

**Commit:**
`git commit -m "feat(cli): execute artifact installation across multiple chosen agents safely"`

---

## Execution Handoff

Please tell me: **"Which approach?"**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration
**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints
