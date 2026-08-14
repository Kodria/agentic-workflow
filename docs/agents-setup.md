# Agent-specific setup

This guide covers provider mechanics only. Start with [installation](installation.md)
to prepare a machine, use [configuration](configuration.md) for defaults and
multiple providers, and use [project setup](project-setup.md) for repository
content.

The generated [support matrix](support-matrix.md) is authoritative for artifact
paths and capability tiers. It is derived from the provider source and checked
in tests; this guide explains the operational differences that matter to a
developer.

## Claude Code

```bash
awm init --agent claude-code --machine-only
```

Claude Code is hooks-native. AWM merges its session hook into the provider's
settings without replacing unrelated user configuration. The hook re-anchors
managed context at session start, clear, and compaction. Check it with:

```bash
awm hooks status
awm doctor --agent claude-code
```

## Codex

```bash
codex --version
awm init --agent codex --machine-only
```

Codex is hooks-native and requires version 0.145.0 or newer. It asks the user to
trust a new or changed hook; approve that trust prompt before expecting the hook
to run. AWM respects `CODEX_HOME` for Codex-managed configuration, while shared
skills remain co-owned with OpenCode. Inspect the resolved state with:

```bash
awm doctor --agent codex
```

## OpenCode

```bash
awm init --agent opencode --machine-only
```

OpenCode receives managed configuration instructions and shares skills with
Codex. It has no session-hook mechanism, so context is delivered rather than
re-anchored automatically during a long session. If the conversation drifts,
ask the provider to reread the relevant project guidance.

## Cursor

```bash
awm init --agent cursor --machine-only
```

Cursor receives rendered rules and project context. Rule relevance is selected
by Cursor, so it does not have the same always-on hook behavior as a
hooks-native provider. AWM does not invent a global context file where Cursor
has no verified file-based equivalent.

## Copilot

```bash
awm init --agent copilot --machine-only
```

Copilot has project-only skill delivery. Machine initialization records the
provider but deliberately defers skills and instructions until normal project
initialization. This is expected, not a failed setup:

```bash
cd <repository>
awm init --agent copilot
```

Commit the resulting project instructions and shared context according to the
[project setup guide](project-setup.md#commit-the-shared-contract).

## Antigravity

```bash
awm init --agent antigravity --machine-only
```

Antigravity receives linked skills and workflows, but has no hooks or managed
context injection. Treat AWM's process material as contextual guidance and use
the deterministic project sensors for mechanical enforcement.

## Verify a provider

```bash
awm agent list
awm doctor --agent <provider>
```

If a provider reports a missing binary, version gate, trust prompt, or deferred
project-only capability, follow the named action rather than creating files by
hand. The [acceptance playbooks](testing/agent-matrix.md) provide provider-level
checks.
