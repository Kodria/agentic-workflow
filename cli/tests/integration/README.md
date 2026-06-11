# AWM Hooks — End-to-End Test Protocol

Manual / opt-in CI test that verifies the bootstrap hook actually changes agent behavior in a real Claude Code session.

## Why manual

The hook activates inside Claude Code's runtime, and the only way to verify it works as intended is to run a real session and observe the agent's response. This requires the `claude` CLI and a live API key, consumes tokens, and is therefore not part of the default `npm test` suite.

## Prerequisites

- Claude Code CLI installed and on PATH (`which claude`)
- `ANTHROPIC_API_KEY` env var set (or equivalent auth)
- AWM CLI installed globally (`npm i -g agentic-workflow-manager` or `cd cli && npm run build && npm link`)

## Protocol

```bash
# 1. Set up an isolated HOME and bootstrap AWM
export TMPHOME=$(mktemp -d)
export AWM_HOME="$TMPHOME/.awm"
export HOME_BACKUP="$HOME"
export HOME="$TMPHOME"

# Bootstrap: seeds the baseline registry under $AWM_HOME/registries/baseline
# (Use AWM_BASE_REMOTE to point to a fixture registry instead of the live remote)
awm init

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
