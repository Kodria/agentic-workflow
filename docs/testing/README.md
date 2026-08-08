# End-to-end acceptance playbooks

These are the checks that answer one question: **does AWM actually work in this environment?**

They exist because the development machine cannot answer it. CI covers Linux and Windows for the *unit and integration* suite, but nothing in CI installs the real Claude Code, Codex, Cursor, Copilot, OpenCode or Antigravity binaries, and nothing in CI runs on macOS. Those combinations are verified by running these playbooks by hand — or by handing one to an agent and letting it run itself.

## How this is organised, and why

There are 4 OS targets and 6 agents. A document per combination would be 24 files that drift apart within a month, which is exactly the failure mode this project keeps writing retros about. So the split is by **what actually differs**:

| Document | Covers |
|---|---|
| **[core-acceptance.md](core-acceptance.md)** | The suite that must pass identically everywhere — install, init, add, sync, update, sensors, preflight, doctor, export, backup, remove. ~80% of the value. |
| **[os-matrix.md](os-matrix.md)** | Only what differs per OS: symlink permissions on Windows, path separators, WSL, macOS specifics. |
| **[agent-matrix.md](agent-matrix.md)** | Only what differs per agent: what to check, and — critically — **what is supposed to degrade**, so a tester doesn't file a bug against a documented tier limitation. |
| **[../support-matrix.md](../support-matrix.md)** | Not a playbook — the reference these results feed. Says what is supported at what evidence level, and where the install paths actually are (generated from source, locked by a test). Read it before recording a result, and update it after. |

Run **core-acceptance** first. Then the OS section for your machine, then the agent section for each agent you use.

## Before you start

**Isolation is mandatory.** These playbooks install and delete things. Never run them against a machine state you care about without an override:

```bash
# Linux / macOS
export AWM_HOME="$HOME/.awm-e2e"
# Windows PowerShell
$env:AWM_HOME = "$HOME\.awm-e2e"
```

Some checks additionally override `HOME` to fully isolate the global agent directories (`~/.claude`, `~/.agents`, …). Those are marked **[isolated]** and give the exact incantation.

> Do **not** hand-edit anything under `~/.awm` to make a check pass. That directory belongs to the installer (`awm init` / `awm update`); editing it invalidates the result. If a check fails, that is the finding.

**Prerequisites:** Node.js 22+, git, and the agent binary for any agent-specific section.

## How to record a result

Every check has an **ID** (`CORE-03`, `WIN-02`, `CURSOR-01`…), an action, and an explicit expected result. Copy this table and fill it in:

```
| ID | Result | Notes (paste actual output on FAIL) |
|----|--------|-------------------------------------|
| CORE-01 | PASS |  |
| CORE-02 | FAIL | expected exit 0, got 2 — output below |
```

Three outcomes, and the third one matters:

- **PASS** — observed result matches expected.
- **FAIL** — it doesn't. Paste the real output. That's a bug report.
- **BLOCKED** — you couldn't run it (binary not installed, no such OS). **Never record BLOCKED as PASS.** An unverified combination is unverified; saying otherwise is how a support matrix starts lying.

## If you are an agent running this yourself

Prefer the `--json` forms (`awm init --json`, `awm doctor --json`, `awm preflight --json`) and assert on parsed fields plus the process exit code rather than on human-readable text, which is not a stable interface.

Report exactly what you observed. Do not repair the environment to make a check pass and then report PASS — if you had to fix something, that is a FAIL with a note, because a real user would have hit the same thing.
