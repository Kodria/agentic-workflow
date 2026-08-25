# R1 Context Footprint Optimization with Embedded R0 — Design

**Status:** Draft for written-spec review

**Source brief:** `docs/plans/2026-08-25-performance-tokens-brief.md`

**Trace:** [agentic-workflow#126](https://github.com/Kodria/agentic-workflow/issues/126)

This design records the owner's decision to replace a standalone telemetry-first R0/R1 sequence with direct context optimization in R1. R0 survives as a zero-model-token measurement ledger embedded in the R1 implementation plan. This decision supersedes the source brief's standalone Release 0 and telemetry-first Release 1 sequencing; later product releases remain unchanged until evidence from this work justifies revisiting them.

## Requirements

- **R1.1** — WHEN the R1 implementation plan is created, THE plan SHALL record checkpoint T0 before the first implementation edit with the source commit, exact mandatory-context bytes, exact required skill bytes, expected dispatch topology, and every provider-native usage field already available.
- **R1.2** — THE embedded R0 ledger SHALL classify every metric as `exact`, `provider-reported`, `estimated`, or `unobservable`, and SHALL preserve its source and collection time.
- **R1.3** — IF a provider metric is unavailable, THEN THE ledger SHALL record `unobservable` and SHALL NOT create an LLM call, zero value, or fabricated measurement to replace it.
- **R1.4** — THE measurement process SHALL add zero model invocations and zero model tokens beyond the development cycle that would occur without measurement.
- **R1.5** — THE R1 implementation SHALL reduce the mandatory orchestration payload by compacting entry skills and loading detailed instructions only when their phase or decision requires them.
- **R1.6** — IF the runtime requires a skill to be reloaded on every turn, THEN THE optimized entry skill SHALL remain self-contained and minimal without relying on cross-turn memory for correctness.
- **R1.7** — THE optimized workflow SHALL preserve all routing, approval, TDD, review, QA, security, robustness, and fail-loud invariants of the current workflow.
- **R1.8** — WHEN research or documentation changes no executable behavior, THE workflow SHALL require only proportional structural verification and SHALL NOT require full tests, sensors, CI monitoring, or a PR solely because an artifact was written.
- **R1.9** — WHEN the cycle reaches its natural design, implementation, review, and QA boundaries, THE plan SHALL update checkpoints T1 through T3 without dispatching a measurement-only agent.
- **R1.10** — THE candidate SHALL reduce by at least 40% the exact bytes mandatory on the observed `using-awm` → `development-process` → active-phase path while preserving R1.7.
- **R1.11** — THE cycle SHALL report savings net of any retrieval, assembly, retry, or additional invocation overhead; gross reductions SHALL NOT be presented as net savings.
- **R1.12** — THE first normal development session after installing R1 SHALL append checkpoint T4 as the first end-to-end provider-reported comparison; no synthetic development cycle is required.
- **R1.13** — THE implementation plan SHALL keep the embedded R0 ledger and its checkpoint tasks as durable content that compacted context, summaries, and session transitions cannot remove.
- **R1.14** — THE change SHALL preserve equivalent required behavior for Codex and Claude Code, with provider limitations stated explicitly rather than hidden by fallback assumptions.

## Scope

R1 changes the baseline registry's orchestration content, not the number of quality roles. The first slice is intentionally narrow:

- Compact `using-awm`, `development-process`, and `brainstorming`, the 699-line path repeatedly loaded during this design session.
- Move phase-specific detail behind explicit references so a turn loads only the detail required for its current decision.
- Clarify phase ownership so the active phase controls until its terminal state. When a runtime still mandates reloading entry skills, compact wrappers preserve correctness at lower byte cost.
- Add proportional verification rules for non-executable research and documentation work.
- Preserve all existing gates and provider-neutral behavior.

No CLI telemetry, remote analytics, new model calls, review removal, model routing, or dynamic retrieval platform is part of R1.

## Architecture

### Compact entry contract

Each affected `SKILL.md` retains only information required on every invocation:

- trigger and termination contract;
- mandatory invariants and hard gates;
- the smallest state/routing checklist needed to choose the next action;
- explicit references to phase-specific detail.

Long explanations, provider examples, post-plan rules, UI-specific guidance, and exceptional recovery procedures move to narrowly named references. A reference is required only when the current state enters that branch. Moving text never deletes its rule: the implementation plan must trace every moved normative statement from its original location to its destination.

### Phase ownership

`using-awm` selects the session orchestrator. `development-process` selects the active phase. Once `brainstorming` owns the phase, entry orchestrators are not conceptually responsible again until the phase terminates, the user explicitly resumes from unknown state, or an inconsistency requires reclassification.

This is an optimization hint, not a memory assumption. If Codex or Claude Code runtime policy requires all three skills on a later turn, their compact entry contracts still carry enough information to route safely and the byte reduction remains measurable.

### No telemetry subsystem

R0 measurement is a plan section maintained at existing workflow checkpoints. Deterministic shell/file measurements may read repository content and provider-generated metadata. They do not call a model, install a daemon, alter provider configuration, or become an AWM product surface.

## Embedded R0 Ledger Contract

The future R1 plan must contain an `## Embedded R0 Measurement Ledger` section before implementation tasks. Compacting or summarizing the plan may not remove it.

| Field | Contract |
|------|----------|
| Checkpoint | `T0`, `T1`, `T2`, `T3`, or `T4` |
| Commit | Exact source commit observed |
| Phase | Baseline, design, implementation, review/QA, or next real cycle |
| Mandatory context | Exact bytes and file list |
| Skill path | Exact required files and bytes for the observed path |
| Dispatches | Exact count by role when mechanically observable |
| Verification | Exact commands/runs already required by the phase |
| Provider usage | Input, output, cache read/write, and cost only when natively reported |
| Classification | `exact`, `provider-reported`, `estimated`, or `unobservable` |
| Source | Command, file, provider export, or owner-supplied billing record |
| Notes | Deviations, uncertainty, and quality findings |

Checkpoint semantics:

- **T0 — baseline:** captured before the first registry edit. It records the current 699-line three-skill path and the exact byte baseline, plus available native session usage.
- **T1 — candidate:** captured after compaction and before review. It compares exact bytes and verifies every normative rule has a destination.
- **T2 — reviewed candidate:** captured after targeted structural/contract review. It records findings, fixes, and any added overhead.
- **T3 — completed development cycle:** captured after normal final QA. It reports the real cost of building R1 but does not claim a clean end-to-end before/after comparison because the cycle began on the old workflow.
- **T4 — first normal cycle on R1:** appended during the next real development, not a synthetic benchmark. It is the first valid full-cycle provider comparison.

## Data Flow

1. `writing-plans` creates the ledger and T0 task before any implementation task.
2. T0 reads exact repository bytes and any already-available provider usage.
3. Implementation changes registry skills and references while a trace table accounts for every moved invariant.
4. T1 compares candidate bytes to T0 using the same deterministic command and path definition.
5. Existing review and QA produce quality evidence; T2 and T3 record it without adding measurement agents.
6. The plan and issue #126 preserve the result across sessions.
7. The next normal AWM development appends T4 and decides whether R1 achieved real billed savings without quality regression.

## Error and Honesty Rules

- Missing provider usage is `unobservable`, never zero.
- A changed path definition invalidates direct byte comparison unless both sides are recalculated under the same definition.
- An inaccessible required reference is a hard failure; the workflow does not continue with silently missing instructions.
- If a moved rule cannot be traced or a quality gate changes behavior, R1 fails regardless of byte reduction.
- If candidate mandatory bytes fall by less than 40%, R1 does not meet its release target.
- T3 may report the cost of this development cycle but may not claim end-to-end savings; that claim waits for T4.

## Verification Strategy

Verification is proportional to the changed repository and surface:

- Structural checks confirm valid skill frontmatter, references, and no broken relative paths.
- Contract checks compare the before/after normative-rule inventory and routing outcomes for representative states.
- Targeted registry tests cover the affected skills and process transitions.
- Existing independent review and final QA remain unchanged for executable/process behavior.
- Agentic Workflow CLI tests, sensors, and CI are not run when that repository receives only research/design artifacts.
- No PR is created until a concrete technical delivery is ready for review.

## Quality Non-Regression

Byte reduction alone is insufficient. R1 acceptance requires:

- identical phase routing for new task, ready brief, resume, execution, QA, docs, retro, and finishing states;
- unchanged interactive approvals and unattended-mode boundaries;
- unchanged TDD, review, final QA, security, validation, and robustness requirements;
- no missing instruction under Codex or Claude Code;
- no blocker or important finding attributable to compacted context.

## Planning Handoff

`writing-plans` must make measurement part of the work rather than a later reminder:

1. Create the embedded ledger.
2. Capture T0 before the first implementation edit.
3. Build a normative-rule trace inventory.
4. Compact one skill at a time with targeted contract evidence.
5. Capture T1 after compaction.
6. Run normal review/QA and capture T2/T3 at those existing boundaries.
7. Record T4 as a post-release follow-up on the next real development cycle.

The plan must not create a separate telemetry implementation track or measurement-only subagents.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Compact text omits a rare but critical rule | Normative-rule trace inventory plus hard failure for missing references |
| Runtime reload policy prevents phase-owner savings | Keep compact entry contracts self-contained; count guaranteed byte reduction without assuming memory |
| Mixed old/new cycle produces a misleading comparison | Separate T3 development cost from T4 end-to-end validation |
| Measurement work adds model consumption | Zero-model-token requirement and no measurement-only agents |
| Smaller prompts weaken quality | Preserve all gates and reject any blocker/important regression |
| Plan compaction removes the experiment record | R1.13 makes the ledger a durable, non-removable plan section |

## Out of Scope

- Building permanent token telemetry or a provider billing adapter.
- Removing, merging, or weakening reviewers and QA lenses.
- Changing model families or routing by risk.
- Creating a synthetic development solely to benchmark R1.
- Optimizing every AWM skill in the first slice.
- Claiming the initiative-wide 50% billed-cost target from static byte reduction alone.
