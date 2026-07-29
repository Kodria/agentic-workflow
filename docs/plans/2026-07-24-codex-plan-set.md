# Codex Full-Parity Plan Set

This index coordinates the three implementation plans derived from
`2026-07-24-codex-full-parity-design.md`. It is intentionally not named
`*-plan.md`, so `development-process` does not mistake the index for an active
execution plan.

## Execution order

1. [`2026-07-24-codex-cli-provider-plan.md`](./2026-07-24-codex-cli-provider-plan.md)
   — provider, enabled-agent state, planner, transactions, hooks, context and
   diagnostics.
2. [`2026-07-24-codex-baseline-portability-plan.md`](./2026-07-24-codex-baseline-portability-plan.md)
   — current stable registry (`v1.5.2`, 37 skills including `product`), canonical
   vocabulary, Codex reference and recovery hook.
3. [`2026-07-24-codex-e2e-rollout-plan.md`](./2026-07-24-codex-e2e-rollout-plan.md)
   — isolated packaging, public releases, real local/cloud/GitHub evidence and
   controlled live activation. **Partially superseded as of 2026-07-29** — plans
   1 and 2 shipped (`agentic-workflow-manager@3.2.1`, registry `v1.7.0`) and the
   end-to-end verification was done manually with a GO verdict, so most of this
   plan's scaffolding is discarded scope. Only the cloud bootstrap task stays
   live, gated on whether Codex Cloud is actually adopted. See its "Estado —
   2026-07-29" section before executing anything from it.

The CLI and baseline plans can be reviewed independently, but their release
order is fixed: CLI stable release first, then baseline `minCliVersion` is set
to that observed stable version, then the baseline registry is released. The
live-home gate occurs only after both public releases pass isolated verification.

## Global traceability

| Req | Implementation task(s) | Verification |
|---|---|---|
| R1 | CLI T2/T8; E2E T1 | init integration and isolated package E2E |
| R2 | CLI T2/T8/T9; E2E T4 | version probe matrix, mutation-order test, public package smoke |
| R3 | CLI T3/T7; baseline T2/T5; E2E T5/T7 | managed context, hook matcher, real local/cloud responses |
| R3.1 | CLI T7; baseline T5; E2E T5 | hook recovery fixture, `/compact`, plan/ledger heartbeat |
| R4 | CLI T3 | managed global block preservation/idempotence tests |
| R5 | CLI T3 | managed project block preservation/idempotence tests |
| R6 | CLI T3; baseline T4/T5; E2E T5/T7 | constitution delivery tests and observed rule |
| R7 | CLI T2/T9; E2E T1 | call-time path and isolated symlink evidence |
| R8 | CLI T4/T9; baseline T1/T5; E2E T1/T5 | deterministic TOML, canonical agent checks, real availability |
| R9 | CLI T4; baseline T1–T6 | canonical parser plus 37-skill portability validator |
| R10 | CLI T1 | atomic legacy preference migration tests |
| R11 | CLI T1/T8; E2E T1/T6 | enable-without-disable tests and coexistence evidence |
| R12 | CLI T1/T5/T8/T9 | resolver and five-command parameterized tests |
| R13 | CLI T1/T5/T8 | exact explicit subset tests |
| R14 | CLI T5/T8 | shared-domain pre-write abort tests |
| R15 | CLI T5/T6/T8; E2E T1/T6 | physical dedup tests and observed shared target |
| R15.1 | CLI T5/T6/T8 | report-per-owner tests |
| R16 | CLI T5/T8 | owner-aware removal tests |
| R17 | CLI T3/T4/T6/T7 | malformed blocks/TOML/JSON, staging and duplicate-hook tests |
| R18 | CLI T7/T9; baseline T5; E2E T5 | pending-trust/healthy/stale tests and real heartbeat |
| R19 | CLI T2/T7/T8/T9; baseline T1/T4/T6; E2E T1/T6 | Claude characterization and before/after comparison |
| R19.1 | CLI T2/T3/T8/T9; baseline T1/T4/T6; E2E T1/T6 | OpenCode characterization and preserved instructions |
| R20 | CLI T1/T8/T9 | single-enabled resolver and command tests |
| R21 | baseline T6; E2E T2/T4/T7 | public-only bootstrap tests and cloud evidence |
| R21.1 | E2E T2/T7 | tracked-guidance diff gate |
| R21.2 | E2E T2/T7 | generated-artifact reconstruction call log/evidence |
| R22 | E2E T4/T7 | real `@codex review` URL and repository-rule evidence |
| R23 | CLI T9; E2E T1–T3/T5 | dual-temp tests and isolated `CODEX_HOME` |
| R24 | E2E T3/T6 | read-only live preflight snapshot |
| R24.1 | CLI T6; E2E T6 | transaction order and live backup manifest |
| R25 | CLI T6; E2E T3/T6 | rollback unit test and live restore/recompare path |
| R26 | E2E T1/T5/T6/T7 | isolated, local-real, live, cloud and GitHub evidence |

## Analyze result

- Forward gaps: none; every requirement has at least one implementation task
  and one requirement-specific verification.
- Backward gaps: none; every task belongs to provider behavior, canonical
  portability, safety, release coordination or required E2E evidence.
- UI tasks: none.
- External-state pauses: public merges/releases and live-home activation remain
  interactive and require the approvals stated in the corresponding plan.
