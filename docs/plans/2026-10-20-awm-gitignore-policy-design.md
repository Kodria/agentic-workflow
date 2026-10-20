# Design: Canonical `.awm/` versioning policy (#218)

**Status:** approved 2026-10-20 (owner)  
**Issue:** https://github.com/Kodria/agentic-workflow/issues/218  
**Diagnosis:** `/opt/cursor/artifacts/issue-218-systematic-diagnosis.md`  
**CLI baseline:** 9.20.4

## Goal

One declared policy for what under `.awm/` is versioned vs local, one managed `.gitignore` block that encodes it, writers on the paths that create project `.awm/` state, and blocking doctor/preflight checks that propose a concrete remedy.

## Owner decisions (locked)

| Fork | Choice |
|------|--------|
| Versioned allowlist | Issue list + `.awm/context-budget.json` |
| Checks | `awm doctor` **and** `awm preflight` — **blocking** (handoff/`ready` fails) |
| Remedies | Always propose fix (`awm …` to regenerate block and/or `git rm --cached …`) |
| Writers | `awm sensors init` + `awm watch init` only (not bare `awm init`) |

## Canonical lists

**Versioned (must be commit-able):**

- `.awm/sensors.json`
- `.awm/sensors.baseline.json`
- `.awm/context/index.json`
- `.awm/profile.json`
- `.awm/context-budget.json`

**Local (must stay ignored / not tracked):**

- `.awm/journal/`
- `.awm/ledger/`
- `.awm/evidence/`
- `.awm/track.json`
- `.awm/sensors/runs/` (also self-ignored via nested `*` from receipt writer)
- any other path under `.awm/` not in the versioned list

Align narrative with existing `RUNTIME_STATE_EXCLUDES` (`cli/src/core/changes/worktree.ts`); the managed block is the git-facing source of truth for the same split.

## Architecture

1. **Decision record** `D-0xx` in `docs/decisions.md` — the two lists above.
2. **Shared helper** (new small module under `cli/src/core/`, e.g. `awm-gitignore.ts`):
   - Marker-delimited managed block (exact begin/end lines).
   - Idempotent upsert: replace existing managed block or migrate bare `.awm` / `.awm/` lines into the block; never delete user rules outside markers; refuse symlink `.gitignore` (same rule as today).
   - Pure builders for block text + check result types (testable without git where possible; git probes for doctor/preflight).
3. **Writers:** call the helper from `ensureJournalGitignored` replacement used by `watch init`, and from the successful path of `sensors init` that creates/updates project `.awm/` (after manifest write succeeds).
4. **Checks:** shared evaluate function used by doctor (project check) and preflight (new non-advisory check id). Fail when:
   - any local path is tracked (`git ls-files`);
   - any versioned path exists on disk (or is required by policy when present) and is ignored (`git check-ignore`), or the managed block is missing/malformed when `.awm/` exists.
5. **`isAwmGitignored`:** keep fail-closed probe; document that the managed block must keep `.awm/probe` (via `.awm/*`) ignored. No behavior change required if the block matches this repo’s allowlist shape.

## Managed block shape (normative)

Exact marker lines (ASCII):

```
# AWM:GITIGNORE:BEGIN
.awm/*
!.awm/sensors.json
!.awm/sensors.baseline.json
!.awm/profile.json
!.awm/context-budget.json
!.awm/context/
.awm/context/*
!.awm/context/index.json
# AWM:GITIGNORE:END
```

Order: ignore-all under `.awm`, then un-ignore files, then context directory pattern (same semantics as this repo’s hand allowlist, plus profile + context-budget).

## Requirements (EARS)

- **GI-1:** WHEN `awm sensors init` successfully writes project sensor state under `.awm/`, THE system SHALL upsert the managed gitignore block in the repository root `.gitignore`.
- **GI-2:** WHEN `awm watch init` runs, THE system SHALL upsert the same managed block (and SHALL NOT append a bare `.awm/` line).
- **GI-3:** IF `.gitignore` is a symlink, THEN THE system SHALL refuse to modify it and SHALL surface an error (existing watch behavior preserved).
- **GI-4:** IF a prior bare `.awm` or `.awm/` ignore line exists outside a managed block, THEN upsert SHALL remove those obsolete blanket lines when installing the managed block (user rules unrelated to `.awm` stay).
- **GI-5:** IF the managed block already matches the canonical text, THEN upsert SHALL be a no-op (idempotent).
- **GI-6:** WHEN `awm preflight` runs on a git project that has `.awm/` (or tracked `.awm` paths), THE system SHALL run a non-advisory check that fails if any local path is tracked or any on-disk versioned path is ignored / block missing when `.awm` config exists.
- **GI-7:** WHEN that preflight check fails, THE system SHALL include a remedy string that names regenerating the block via `awm sensors init` or `awm watch init` and, when runtime is tracked, `git rm --cached` for the offending paths.
- **GI-8:** WHEN `awm doctor` evaluates the project, THE system SHALL report the same policy violations (blocking project check) with the same class of remedies.
- **GI-9:** THE policy SHALL be recorded as a decision in `docs/decisions.md` with the versioned and local lists.
- **GI-10:** `isAwmGitignored` SHALL continue to return true on a worktree whose managed block is installed (probe path remains ignored).

## Non-goals

- Changing `ensureSkillsGitignored` (agent symlink dirs).
- Making `awm init` (machine/agent) write the project `.awm` block.
- Auto-running `git rm --cached` (propose only).
- Re-firing or changing Change Record receipt layout.

## Test plan (design-level)

- Unit: block render, idempotent upsert, migration from bare `.awm/`, symlink refuse, preserve unrelated `.gitignore` lines.
- Integration: sensors init / watch init write block; preflight + doctor fail on tracked journal and on ignored `sensors.json` / `profile.json` with remedy text; pass on allowlist-equivalent tree.
- Tracks: existing `isAwmGitignored` tests stay green with managed block.

## Change Record

Slug: `awm-gitignore-policy`

---

## Self-review

- No TBD/TODO placeholders.
- Forks locked; `context-budget.json` and blocking preflight explicit.
- Writers limited to sensors + watch per owner OK.
- EARS GI-1…GI-10 testable 1:1.
