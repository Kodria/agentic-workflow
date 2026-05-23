# Bootstrap Hook Port to AWM CLI — Design

**Date:** 2026-05-22
**Status:** Approved (brainstorming phase complete)
**Scope:** Claude Code only (single-harness in this version)
**Branch:** `feature/update-versions`
**Next:** `writing-plans` → implementation

---

## Goal

Close the principal discipline gap in AWM: today the CLI distributes skills, but nothing forces the agent to invoke them at session start, after `/clear`, or after `/compact`. As a result, the agent often answers directly and skips discipline gates like `brainstorming` or `development-process`. This port adds a SessionStart hook that injects a bootstrap skill (`using-awm`) into every relevant turn, making the "1% chance → MUST invoke" rule load-bearing instead of advisory.

## Why this matters

Without this hook, AWM is functionally inferior to superpowers in process discipline. Superpowers ships a SessionStart hook in its plugin that injects `using-superpowers/SKILL.md` at startup, clear, and compact — this is the mechanism that makes the agent obey the skill system instead of treating skills as optional reference. AWM has the skills installed but the imperative bootstrap missing.

The user investigation in `tmp/investigation-harness.md` framed this as the "feedforward" layer of harness engineering: skills are guides, hooks deliver them at the right moment. Without the delivery mechanism, the guides exist but don't fire.

## Key decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Hook payload | Inline full content of `using-awm` (~2-3KB) | Canon pattern. Disciplina garantizada porque el imperativo vive en cada turno relevante. |
| Bootstrap skill name | `using-awm` (adapted vocabulary) | Coherente con la marca del CLI. References to other skills keep the `superpowers:` prefix because that's how the registry shipped after the v5.1 sync. |
| Install mechanism | Opt-in command `awm hooks install` | Control total, cero sorpresas. `install.sh` solo menciona el comando. |
| Script location | `~/.awm/hooks/` (Approach B) | Independent of clone location. `awm update` re-syncs scripts from `~/.awm/cli-source/registry/hooks/`. |
| Settings file | `~/.claude/settings.json` (merge in `hooks.SessionStart`) | Claude Code does NOT support `~/.claude/hooks.json` for user-level hooks. All user hooks live inside `settings.json`. |
| Target harness | Claude Code only | Antigravity 2.0 and OpenCode deferred. Their `hooks` config in `ProviderConfig` stays `null`. |

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Registry (versioned in repo)                                  │
│    registry/skills/using-awm/SKILL.md      ← bootstrap source  │
│    registry/hooks/session-start            ← bash script       │
│    registry/hooks/run-hook.cmd             ← polyglot wrapper  │
└──────────────────────────┬─────────────────────────────────────┘
                           │ awm hooks install
                           ▼
┌────────────────────────────────────────────────────────────────┐
│  User machine (~/.awm/)                                        │
│    ~/.awm/hooks/session-start              ← copy or symlink   │
│    ~/.awm/hooks/run-hook.cmd               ← copy or symlink   │
│    ~/.awm/hooks/using-awm.md               ← symlink to skill  │
└──────────────────────────┬─────────────────────────────────────┘
                           │ referenced from
                           ▼
┌────────────────────────────────────────────────────────────────┐
│  Claude Code config                                            │
│    ~/.claude/settings.json (hooks.SessionStart entry)          │
│      command: ~/.awm/hooks/run-hook.cmd session-start          │
└──────────────────────────┬─────────────────────────────────────┘
                           │ on startup|clear|compact
                           ▼
┌────────────────────────────────────────────────────────────────┐
│  Claude Code session                                           │
│    Hook reads using-awm.md → emits JSON with                   │
│    hookSpecificOutput.additionalContext → injected into        │
│    conversation as first message of the turn                   │
└────────────────────────────────────────────────────────────────┘
```

## Components

### A) Skill `using-awm`

**Path:** `registry/skills/using-awm/SKILL.md`

Port of canon `superpowers/skills/using-superpowers/SKILL.md` (source of truth — implementer reads it and applies the diff below) with these adaptations:
- Brand: AWM (not "superpowers")
- No "Platform Adaptation" section (single-harness scope)
- No dot graph (the orchestrator and child skills already provide graphs)
- New "Orchestration" section pointing to `development-process` as the default entry point for development tasks
- No references to Gemini CLI, Codex, or Copilot
- References to other skills keep the `superpowers:` prefix (matches the registry post-v5.1 sync)

Frontmatter:
```yaml
---
name: using-awm
description: Use when starting any conversation - establishes how to find and use skills, requiring Skill tool invocation before ANY response including clarifying questions
---
```

Body retains the canon's imperative blocks:
- `<SUBAGENT-STOP>` (prevent recursion when dispatched by `subagent-driven-development`)
- `<EXTREMELY-IMPORTANT>` with the 1% rule
- Instruction Priority hierarchy (User > AWM skills > default system prompt)
- "How to Access Skills" (use Skill tool, never Read)
- "Red Flags" with rationalization patterns

### B) Hook scripts

**Path:** `registry/hooks/`

| File | Purpose | Source |
|---|---|---|
| `session-start` | Bash script that reads `${AWM_HOOKS_ROOT}/using-awm.md`, escapes for JSON, emits `{hookSpecificOutput: {hookEventName, additionalContext}}` to stdout | Port of canon `superpowers/hooks/session-start` with 2 patches: read `using-awm.md` instead of plugin-rooted path; emit only the Claude Code branch (no Cursor/Copilot fallbacks) |
| `run-hook.cmd` | Cross-platform polyglot wrapper (cmd.exe batch + bash shebang) that invokes the named script | Verbatim copy from canon |

**Not imported** from canon (out of scope):
- `hooks.json` (plugin-only format; user-level hooks go inside `settings.json`)
- `hooks-cursor.json` (single-harness scope)

### C) CLI command `awm hooks`

**Path:** `cli/src/commands/hooks/`

Subcommands:

| Command | Purpose |
|---|---|
| `awm hooks install` | Sync scripts to `~/.awm/hooks/`, symlink `using-awm.md`, merge entry into `~/.claude/settings.json`, backup the previous settings |
| `awm hooks uninstall` | Remove only the AWM entry from `settings.json` (preserve other plugins' entries); optionally remove `~/.awm/hooks/` with confirmation |
| `awm hooks status` | Verify scripts exist + executable, symlink resolves, settings entry present, dry-run the bash script for valid JSON output |

**`install` flow:**

1. Verify clone exists at `~/.awm/cli-source/registry/hooks/`
2. Sync scripts to `~/.awm/hooks/` (method follows `getPreferences().installMethod`)
3. Symlink `registry/skills/using-awm/SKILL.md` → `~/.awm/hooks/using-awm.md` (always symlink, never copy — UX choice so `awm update` propagates bootstrap changes without reinstalling the hook)
4. Read `~/.claude/settings.json` (create with `{}` if missing)
5. Backup → `~/.awm/backups/settings.json.YYYY-MM-DD-HHMMSS.bak`
6. Merge the AWM entry into `hooks.SessionStart[]`. Identification marker: `matcher === "startup|clear|compact"` AND `command` contains `~/.awm/hooks/`. If marker matches existing entry → replace; else → append.
7. Write `settings.json` with indent=2
8. Report paths, backup location, suggest restart

**`uninstall` flow:**

1. Read settings.json
2. Find entry by marker (same as install)
3. Remove only that entry from the array
4. If `SessionStart` array becomes empty → remove the key
5. Backup and write
6. Optionally prompt to delete `~/.awm/hooks/`

### D) `ProviderConfig` extension

**Path:** `cli/src/providers/index.ts`

```typescript
type HookConfig = {
    type: 'cc-settings-merge';
    settingsPath: string;    // ~/.claude/settings.json
    scriptsDir: string;      // ~/.awm/hooks/
    matcher: string;         // 'startup|clear|compact'
    eventName: string;       // 'SessionStart'
};

export type ProviderConfig = {
    label: string;
    skill: ArtifactConfig;
    workflow: ArtifactConfig | null;
    agent: ArtifactConfig | null;
    hooks?: HookConfig;       // new, optional
};
```

Only `'claude-code'` populates `hooks`. `'antigravity'` and `'opencode'` remain `null` (deferred).

### E) `install.sh` message

Add a final block (no auto-execution):

```bash
echo "  💡 Optional: Enable session-start bootstrap"
echo ""
echo "     Run: awm hooks install"
```

## Data Flow

### Scenario 1 — Fresh session (`startup`)

1. User opens Claude Code
2. Claude Code reads `~/.claude/settings.json`, sees SessionStart entry with matcher `startup|clear|compact`
3. Claude Code spawns `~/.awm/hooks/run-hook.cmd session-start`
4. Polyglot wrapper routes to bash, executes `~/.awm/hooks/session-start`
5. Script reads `~/.awm/hooks/using-awm.md`, escapes it for JSON, emits `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<EXTREMELY_IMPORTANT>...</EXTREMELY_IMPORTANT>"}}` to stdout, exit 0
6. Claude Code injects `additionalContext` as the first message of the turn
7. Agent receives the imperative bootstrap before processing the user's first message
8. For a development request, agent invokes `development-process` (or `brainstorming` directly) instead of jumping to code

### Scenario 2 — `/clear` or `/compact` mid-session

Identical to Scenario 1 but matcher is `clear` or `compact`. The bootstrap is re-injected, restoring discipline that would otherwise be lost in the compaction summary. **This is the principal value of the hook** — without it, the agent post-`/compact` knows skills exist but no longer feels obligated to invoke them.

### Scenario 3 — Subagent dispatch

When the orchestrator dispatches a subagent via Task tool, SessionStart does NOT fire (it's an agent within the existing session, not a new session). The `<SUBAGENT-STOP>` block at the top of `using-awm/SKILL.md` ensures that even if a subagent somehow sees the bootstrap, it skips it. This prevents `brainstorming` from recursively dispatching itself.

### Failure modes during runtime

| Failure | Behavior |
|---|---|
| `using-awm.md` symlink broken | Script emits JSON with empty `additionalContext`, exits 0 (session continues unbootstrapped). Better than crashing the session. |
| Hook exceeds 5s | Indicates a bug; script is normally <50ms. Claude Code's `async: false` will block waiting; the user notices a slow startup. Mitigated by Level 2 test case 3 (performance bound). |

(`settings.json` being malformed is not a hook-runtime failure — Claude Code refuses to load the entry before the hook fires. Surfaced by `awm hooks status` as a separate concern.)

## Error Handling (install/uninstall)

| Scenario | Behavior |
|---|---|
| Existing SessionStart entry from another plugin | Merge: append AWM entry; preserve the other entry |
| `settings.json` doesn't exist | Create it with the hook entry only |
| `settings.json` is invalid JSON | Abort, backup with `.broken-<timestamp>.bak` suffix, instruct user to fix manually |
| `~/.claude/` not writable | Error with chown suggestion |
| `~/.awm/cli-source/` missing | Error: instruct user to run `awm update` first |
| Re-running install | Idempotent: replace AWM entry in-place if changed; report "already up-to-date" if not |
| Manually edited AWM entry | Uninstall reports "no AWM entry found"; doesn't touch file |
| Non-TTY stdin (CI) | Auto-confirm "merge" default; flag `--yes` or `--force` for explicit non-interactive mode |
| Backup collision | Append `-1`, `-2` to timestamp suffix |

Successful install output:

```
✓ AWM bootstrap hook installed.

  Scripts:        ~/.awm/hooks/session-start
                  ~/.awm/hooks/run-hook.cmd
                  ~/.awm/hooks/using-awm.md → registry/skills/using-awm/SKILL.md

  Settings file:  ~/.claude/settings.json
  Backup:         ~/.awm/backups/settings.json.<timestamp>.bak

  Active on:      startup | /clear | /compact

  Verify:         awm hooks status
  Remove:         awm hooks uninstall

  ⚠ Restart Claude Code to activate the hook in existing sessions.
```

## Testing Strategy

Four-level pyramid; each level covers a different link in the chain.

### Level 1 — Unit tests of the CLI command (Jest)

In-process tests with `tmp-promise` for an isolated fake `HOME`. Cases:

1. Install on clean system creates settings.json with correct entry
2. Install merges with pre-existing non-AWM SessionStart entry
3. Install is idempotent (run twice → no duplication)
4. Install replaces a stale AWM entry in-place
5. Install with corrupted settings.json aborts without touching the file
6. Install without `~/.awm/cli-source/` fails fast with a clear error
7. Install without write permission to `~/.claude/` reports a chown hint
8. Uninstall removes only the AWM entry; other entries survive
9. Uninstall on settings without AWM entry is a no-op
10. Status detects a broken `using-awm.md` symlink

### Level 2 — Bash script tests

`cli/tests/hooks/test-session-start.sh`. Cases:

1. Happy path: ASCII content → valid JSON with matching decoded text
2. Special chars: `"`, `\`, newlines, tabs, unicode → correctly escaped
3. Large skill (10KB) → completes in <100ms, valid JSON
4. Missing `using-awm.md` → emits empty-context JSON, exit 0 (failure-safe)
5. Polyglot wrapper on Unix routes to the bash script correctly

Cross-platform Windows tests are skipped — we trust the canon's prior validation (PR #1121) and verify only that we didn't break the Unix branch.

### Level 3 — End-to-end with Claude Code (manual + opt-in CI)

Lives in `cli/tests/integration/`. Process:

1. Set up a tmp project with a git repo
2. Run `awm hooks install` pointed at the tmp `HOME`
3. Run `claude -p "Make a React todo list"`
4. Capture stdout
5. Assert: the agent's output mentions invoking `brainstorming` (or `development-process`) **before** proposing code

Requires `claude` CLI and a live API key. Gated behind `AWM_E2E=1`. Documented in `cli/tests/integration/README.md` with the exact command and golden output. Run manually whenever the hook or `using-awm` changes.

### Level 4 — Smoke test via `awm hooks status`

User-facing diagnostic, runs in <1s. Output:

```
$ awm hooks status

  Bootstrap skill:    ✓ ~/.awm/hooks/using-awm.md → registry/skills/using-awm/SKILL.md
  Session-start:      ✓ ~/.awm/hooks/session-start (executable)
  Run-hook wrapper:   ✓ ~/.awm/hooks/run-hook.cmd
  Settings entry:     ✓ ~/.claude/settings.json
                        matcher: startup|clear|compact
                        command: ~/.awm/hooks/run-hook.cmd session-start

  Dry-run test:       ✓ session-start produced valid JSON (2143 bytes)

  Status: HEALTHY
```

The dry-run invokes the bash script with `AWM_HOOKS_ROOT=~/.awm/hooks/` and validates the JSON output. This catches install corruption without needing Claude Code.

### Out of testing scope

- Claude Code's own matcher pattern correctness (we trust it)
- Token-level model behavior verification (implicit in Level 3)
- Cross-harness (Antigravity, OpenCode, Cursor, Copilot)
- Performance benchmarks (the <100ms target is enforced by Level 2 case 3)

### Minimum bar to call the port "done"

| Level | Bar |
|---|---|
| 1 | All 10 unit tests pass |
| 2 | All 5 bash tests pass on Linux + macOS |
| 3 | Documented and executed once manually; golden output saved |
| 4 | `awm hooks status` reports HEALTHY on a clean install |

## Files affected

| File | Action | Approx. lines |
|---|---|---|
| `registry/skills/using-awm/SKILL.md` | New | ~40 |
| `registry/hooks/session-start` | New (port) | ~50 |
| `registry/hooks/run-hook.cmd` | New (verbatim copy) | ~30 |
| `cli/src/commands/hooks/install.ts` | New | ~120 |
| `cli/src/commands/hooks/uninstall.ts` | New | ~50 |
| `cli/src/commands/hooks/status.ts` | New | ~30 |
| `cli/src/commands/hooks/index.ts` | New (router) | ~20 |
| `cli/src/providers/index.ts` | Modified (HookConfig field) | +15 |
| `cli/src/index.ts` | Modified (register `hooks` command) | +5 |
| `install.sh` | Modified (final message) | +6 |
| `cli/tests/hooks/*` | New (unit + bash tests) | ~200 |
| `cli/tests/integration/README.md` | New (E2E protocol) | ~30 |

Total: roughly 370 lines of production code + 230 lines of tests across ~12 files. No existing registry skill is touched.

## Out of scope (deferred)

- Antigravity 2.0 hook port (different format; requires investigating Antigravity 2.0 docs)
- OpenCode plugin port (requires distributing a JS/TS plugin file, not just JSON config)
- Cursor port
- Distributing AWM as a formal Claude Code plugin (would replace the `settings.json` merge with native plugin hooks)
- Auto-detection of harnesses by `install.sh`
- Cross-harness `awm hooks install --target <all|cc|...>`
- Telemetry on hook invocation (whether the user receives the bootstrap as expected)

## Risks

| Risk | Mitigation |
|---|---|
| User edits AWM entry manually → marker-based identification fails | `install` reports "adding new" vs "replacing"; status command flags drift |
| Symlink to `using-awm.md` breaks when user moves the clone | `awm hooks status` detects; user runs `awm hooks install` to re-sync |
| `settings.json` merge corrupts user's other settings | Always backup before write; abort on invalid JSON; preserve key order with indent=2 |
| Hook script changes between releases but user doesn't reinstall | `awm update` should re-sync `~/.awm/hooks/` (out of scope for this port but flagged as follow-up) |
| User on a non-CC harness runs `awm hooks install` | Command errors with clear message: "Claude Code only in this version" |
