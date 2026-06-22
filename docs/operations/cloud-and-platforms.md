# AWM — Cloud & Platform Operations

Operational runbooks for running AWM on ephemeral cloud VMs (Claude Code web)
and across operating systems. Companion to WS-C
(`docs/plans/2026-06-22-ws-c-os-sensitivity-design.md`).

## 1. Clean-distro verification (runbook)

Use this to verify AWM works on a fresh Linux (Ubuntu) environment — the path
that runs in Claude Code web. Run in a clean Ubuntu container or a new web session:

```bash
npm i -g agentic-workflow-manager
awm init --yes
awm doctor
```

Expected: `awm doctor` reports Machine (global) healthy — CLI present, hook
SessionStart present, baseline registry present, global skills present — and a
`platform: Linux` line. First recorded run: brief §0 spike (2026-06-22, Ubuntu 24.04).

## 2. Validated cloud flow — private registry via token (D-7)

For private registries from an ephemeral VM, inject a fine-grained, read-only
(`Contents: Read`) GitHub token as the environment variable `AWM_GIT_TOKEN`, and
use this setup script. The token is injected at the git transport layer and is
NEVER persisted to `registries.json` or `.git/config`:

```bash
#!/bin/bash
git config --global url."https://x-access-token:${AWM_GIT_TOKEN}@github.com/".insteadOf "https://github.com/"
npm i -g agentic-workflow-manager
awm init --yes || true
awm registry add "https://github.com/<owner>/<your-registry>.git" --name <name> --no-install || true
```

Verify the token did not leak to disk:

```bash
cat ~/.awm/registries.json          # remote must be the clean https URL, no token
cat ~/.awm/registries/<name>/.git/config   # also clean
```

## 3. Windows — use WSL

Native Windows support is deferred (brief decision D-1, tracked as WS-D). Today,
the supported path on Windows is WSL:

1. Install WSL: https://learn.microsoft.com/windows/wsl/install
2. Open your Linux distro and run AWM there (follow section 1).

If you run AWM on native Windows, the CLI prints a best-effort warning on
`awm init` / `awm sync` orienting you here, and `awm doctor` shows
`platform: Windows (native — not supported yet, use WSL)`. Commands continue
best-effort, but symlink-based steps may fall back to copies or fail.
