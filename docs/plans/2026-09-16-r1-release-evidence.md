# R1 release evidence — source checkpoint

At this source checkpoint, publication and installed-pair acceptance are pending.
Actual subsequent artifact versions, immutable commits and installed acceptance are
tracked in [issue 126](https://github.com/Kodria/agentic-workflow/issues/126).
This document distinguishes source verification, native historical provenance,
and actual release evidence; source phase markers do not close R1 availability.

## Final source verification and native closure — 2026-09-16

- Immutable code/test candidate `c72b42bb6e754e8b40d898892131c9f147bc2ad0`:
  289 Jest suites PASS, 2 skipped; 3,848 tests PASS, 21 skipped, zero failures.
  Build and enabled CLI sensors PASS. Disabled sensors are not claimed as coverage.
- Final specification/fidelity, code quality and applicable robustness, logic and
  tests QA findings are reconciled against current regressions; no open source
  findings remain. Native/manual review is not journal-driven execution.
- The pristine, unused bootstrap was archived by the real
  `awm watch archive-unused --plan docs/plans/2026-09-15-compact-only-r1-cli-plan.md`.
  Its original IN_PROGRESS bytes retain SHA-256
  `df09c2f511c3fc7d98db18911e7b43a5c1cdcc97a9aaf39fdb6e26af4e73f4ac`.
  Archive directory: `.awm/journal-unused/codex_2Fissue-126-compact-only.7d668d1d-a064-4246-a036-92278cd21dbf`.
  Current branch journal query is `missing`; cycle evidence capture was explicitly
  skipped, never fabricated COMPLETE. Actual ledger archive succeeded and list is `[]`.
- The CLI project has no registry manifest; none was invented. This approved
  development bootstrap provides source/runtime evidence, not a published CLI
  version or permission to bypass installed acceptance or unattended custody.
- The public CLI reference reflects the real commands, identities and supplier
  checks. Retro cures are executable regressions rather than extra context rules.
  No measured token, price, quota savings or six-provider execution parity is claimed.

## Issue 148: recovered existing native T1 review provenance

Read-only native audit on 2026-09-16; no historical plan, ledger, journal, task,
or review was rewritten, and development was not resumed.

| Role | Native review task | Reviewed commit | Existing ledger event | Result |
| --- | --- | --- | --- | --- |
| Specification, T1 re-review | `01a0a1e7-ae05-7911-a0fa-79b200428193` | `91047f5041a447b85243ea25b91652aef41151bd` | `2026-09-14T21:53:36.988Z`, `facts-command-placeholder-traversal`, `cli/src/core/facts/contract.ts:75` | compliant, 0 findings, 1 win |
| Quality, T1 final re-review | `01a0a1ef-e2f0-79c0-9e99-c36d8d622d44` | `1207e61c5b206ad8693f5c5d6b9ab5ab19cd8a6f` | `2026-09-14T22:02:34.749Z`, `facts-contract-json-and-literal-validation`, `cli/src/core/facts/contract.ts:37` | approved, 0 findings, sensors PASS, 1 win |

Both existing ledger events have branch `codex/issue-148-awm-facts`, phase
`review`, polarity `win`, and source_skill `requesting-code-review`. That field
identifies the invoked skill, not the caller's actor role. The native specification
task's original assignment and final compliant verdict establish its role; its
actual ledger command and output establish the exact existing timestamp and ref.
The adapter recovers only these audited tuples; other task wins cannot substitute.

The original plan SHA-256 remains
`c11477dd59cb19094983c671cc0b760f1d1e51b9679e13dba90f1b0c2cba48e7`.
The original checkpoint is `81c008c5f681e6ecfe30a3fc73bf7b79d094c094`.
Recovery also requires reviewed commits/checkpoint in current Git ancestry,
all declared T1 files in that checkpoint, matching current worktree and index,
and no later T1-owned adverse ledger event. It is not generic completion injection.
T2 remains pending quality review; T3–T14 remain unstarted.
