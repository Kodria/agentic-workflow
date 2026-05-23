# Registry References

Cross-skill reference documents that don't belong to any single skill. They describe how superpowers-family skills map onto each AI harness (tool naming, dispatch semantics, environment quirks).

## Files

- `codex-tools.md` — Codex CLI tool equivalence table (Bash, Read, Edit, Task → Codex tools, parallel subagent flag).
- `copilot-tools.md` — GitHub Copilot CLI tool equivalence table.
- `gemini-tools.md` — Gemini CLI tool equivalence (`@agent-name` dispatch, parallel subagent calls).

## Status

Imported from `obra/superpowers` v5.1.0 (`skills/using-superpowers/references/`). Not yet wired into the AWM CLI distribution: when `awm add <skill>` runs, only the skill directory is symlinked. If a skill needs to reference one of these files, link to it explicitly inside the SKILL.md or copy the relevant excerpt.

When multi-harness installs land in the CLI, this directory becomes the source of truth for per-harness adapters.
