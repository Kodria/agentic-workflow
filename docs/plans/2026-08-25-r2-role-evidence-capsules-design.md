# R2 Stable Prefixes and Role Evidence Capsules — Design

**Status:** Approved

**Source brief:** [`2026-08-25-performance-tokens-brief.md`](./2026-08-25-performance-tokens-brief.md)

**Trace:** [agentic-workflow#126](https://github.com/Kodria/agentic-workflow/issues/126)

**Prior release:** R1 baseline registry `v3.7.0`; exact observed skill closure reduced from
48,103 to 11,382 bytes without removing quality gates.

## Owner Decision: DA-2

The R2–R5 release sequence itself is the real longitudinal evaluation corpus. The owner
will evaluate economic impact from observed Codex quota consumption after those releases,
using the established reference that two or three normal developments of approximately
10–12 tasks consume the weekly quota. At R2 design time, the completed R1 cycle has consumed
8% of that quota.

This resolves DA-2 for staged execution without pretending that AWM can observe provider
billing. The minimum sample is every normal R2, R3, R4, and R5 development cycle; none may be
omitted from the final longitudinal comparison. Each release must preserve quality and record
exact structural evidence; the final economic decision remains owner-reported. No release may
convert quota percentage into token or cost values, or claim the initiative's 50% target,
without provider or owner evidence.

The non-inferiority margin is zero: no blocker/important defect may escape the cycle, no
rollback may occur, and no human correction may be attributable to omitted context. Every existing
implementation, review, QA, sensor, security, and robustness gate remains mandatory through
R4. R5 is the only release allowed to consider adapting review roles.

## Requirements

- **R2.1** — WHEN the controller dispatches a repeated role, THE prompt SHALL place a
  byte-stable role contract before every dynamic value so a cache-capable provider can reuse
  the eligible prefix without changing behavior on providers with opaque or absent caching.
- **R2.2** — WHEN a role is dispatched, THE controller SHALL append one deterministic
  `Evidence Capsule v1` containing role, scope, applicable requirement clauses (or explicit
  `n/a` for a plan-agnostic role), changed surfaces,
  authoritative sources, applicable evidence, retrieval history, and fallback state.
- **R2.3** — THE capsule builder SHALL use a role allowlist: implementer, specification
  reviewer, code-quality reviewer, Track A fidelity, and each Track B lens SHALL receive only
  fields justified by that role's contract.
- **R2.4** — WHEN a Track B lens is dispatched, THE initial capsule SHALL NOT contain the
  complete plan; it SHALL contain the relevant diff/evidence and requirement IDs only when
  that lens's own contract needs them.
- **R2.5** — IF a role cannot reach a justified verdict from its initial capsule, THEN THE
  role SHALL return `NEEDS_CONTEXT` with the exact missing source and reason; THE controller
  SHALL record the request in `retrieval history` and re-dispatch with that evidence.
- **R2.6** — IF a task is ambiguous, changes security/robustness, root configuration, a
  public contract, has uncertain cross-cutting impact, or requests context a second time,
  THEN THE controller SHALL select `full-context` fallback and state the trigger visibly.
- **R2.7** — WHEN R2 changes dispatch assembly, THE workflow SHALL retain every current
  implementer, specification review, code-quality review, Track A, applicable Track B,
  sensor, TDD, documentation, retro, and completion obligation.
- **R2.8** — THE same capsule and fallback contract SHALL govern Codex and Claude Code;
  provider-specific cache behavior MAY be reported but SHALL NOT alter required evidence.
- **R2.9** — WHEN R2 is evaluated, THE registry SHALL mechanically compare current and
  candidate initial dispatch bytes using the same committed multi-file plan/diff corpus and
  SHALL demonstrate at least 40% aggregate reduction without a model invocation.
- **R2.10** — THE evaluation SHALL separately report static-prefix bytes, dynamic-capsule
  bytes, retrieval additions, fallback additions, dispatch count, and unavailable provider
  usage; gross byte reduction SHALL NOT be called billed-token savings.
- **R2.11** — THE capsule and its evidence SHALL be ephemeral prompt content; R2 SHALL NOT
  add a telemetry store or persist prompt bodies, source bodies, secrets, credentials, or
  unrestricted model responses.
- **R2.12** — IF a project or plan lacks R2 metadata, THEN THE workflow SHALL use the safe
  full-context path and all existing quality gates without requiring migration.
- **R2.13** — WHEN a capsule field is absent, malformed, or cannot be sourced
  authoritatively, THE controller SHALL fail loudly or select full-context fallback; it SHALL
  NOT invent, silently omit, or coerce required evidence.
- **R2.14** — WHEN a release checkpoint closes, THE initiative SHALL link exact bytes,
  dispatches, retrievals, fallbacks, quality outcomes, commit, and PR from issue #126, plus
  the owner's quota observation when supplied.

## Architecture

R2 is a baseline-registry content release. It changes the instructions and prompt templates
that assemble SDD and final-QA dispatches; it adds no CLI command, daemon, provider adapter,
database, dependency, or paid infrastructure.

Each dispatched prompt has exactly two top-level regions:

1. **Stable Role Contract** — immutable role purpose, safety/quality invariants, evidence
   rules, escalation behavior, and compact report contract. No task name, path, requirement,
   diff, test output, timestamp, model, or provider value may occur before the dynamic marker.
2. **Evidence Capsule v1** — dynamic, role-allowlisted evidence appended after the stable
   marker. Field order is fixed so equivalent inputs produce byte-identical capsules.

The marker is a structural boundary, not a runtime parser or security boundary. Existing
agent-native dispatch remains the execution mechanism. Contract tests inspect templates and
assembled fixtures; no new serialization format is exposed as a public CLI API.

### Evidence Capsule v1

Fields appear in this order:

| Field | Contract |
|---|---|
| `role` | One declared R2 role/lens. |
| `scope` | Task ID or branch-level QA scope. |
| `requirements` | Exact applicable clauses and stable IDs; never an untraceable summary. |
| `surfaces` | Relevant files/components and declared dependencies. |
| `sources` | Authoritative repository paths/commits available for targeted reading. |
| `evidence` | Role-relevant report, diff/hunks, tests, sensors, or design artifacts. |
| `retrieval history` | `none` or ordered source + reason entries from prior attempts. |
| `fallback` | `selective` or `full-context: <trigger>`. |

No arbitrary byte cap may truncate a required clause or finding. Reduction comes from
allowlisting and deduplication, never lossy shortening.

### Role Allowlists

| Role | Initial evidence | Explicitly excluded by default |
|---|---|---|
| Implementer | One cohesive task/slice, exact clauses, files, dependencies, required skills/design, verification | Unrelated plan tasks and unrelated branch history |
| Specification reviewer | Exact task clauses, implementer report, task diff, requirement IDs | Unrelated plan tasks and controller narration |
| Code-quality reviewer | Task diff, tests, sensors, public/robustness constraints | Full plan and implementer chain-of-thought |
| Track A fidelity | All requirement IDs/clauses, branch diff, verification evidence | Process narration and unrelated historical context |
| Track B lens | Branch diff/hunks and evidence relevant to the lens | Complete plan; unrelated requirement prose |
| Design fidelity lens | Affected design artifacts, implementation evidence, relevant diff | Unaffected screens and complete product plan |

### Retrieval and Fallback

`NEEDS_CONTEXT` is a controlled expansion, not a new agent role. The first request names one
or more authoritative sources and a reason. The controller adds only those sources, preserves
the prior retrieval history, and re-dispatches. A second request selects full-context fallback
to avoid an unbounded token-expansion loop.

Full-context is also selected immediately for the R2.6 triggers. Track B remains
plan-agnostic even under normal expansion: it may receive a cited section needed for a
technical verdict, while complete-plan access requires a visible full-context trigger.

## Components and Files

| Repository surface | Responsibility |
|---|---|
| `skills/subagent-driven-development/SKILL.md` | Controller assembly, allowlists, retrieval, fallback, and reconciliation gates. |
| `skills/subagent-driven-development/implementer-prompt.md` | Stable implementer prefix + dynamic capsule. |
| `skills/subagent-driven-development/spec-reviewer-prompt.md` | Stable fidelity-review prefix + dynamic capsule. |
| `skills/subagent-driven-development/code-quality-reviewer-prompt.md` | Stable quality-review prefix + dynamic capsule. |
| `skills/post-implementation-qa/SKILL.md` | Track-specific capsule construction and fallback rules. |
| `skills/post-implementation-qa/deep-review-prompt.md` | Stable Track A/B prefixes and lens-specific capsules. |
| Shared reference under the owning skill | Canonical `Evidence Capsule v1` field order and role allowlists. |
| Registry contract tests | Prefix stability, role allowlists, fallback, parity, mutation strength, byte ledger. |
| `catalog.json`, `bundles/dev/bundle.json` | Required bundle version bump. |

The implementation plan must choose one owning skill for the shared reference and make every
consumer link to that exact file; duplicate capsule contracts are forbidden.

## Measurement Ledger

The R2 plan embeds checkpoints before implementation:

- **T0:** exact current template/skill bytes and current required prompt assembly against one
  committed real multi-file plan/diff corpus.
- **T1:** candidate prefix/capsule bytes before review, with retrieval/fallback at zero unless
  they occurred naturally.
- **T2:** reviewed candidate bytes and all correction/re-dispatch overhead.
- **T3:** final release evidence, quality outcomes, exact dispatch topology, and owner quota
  observation if supplied.
- **T4:** first normal subsequent release cycle using installed R2, recorded without a
  synthetic development or measurement-only model call.

The same corpus and assembly definition are used on both sides of the exact byte comparison.
Provider usage remains `unobservable` unless natively reported. Owner quota percentage is
`owner-reported`, not converted to tokens or currency.

## Verification Strategy

- Contract tests assemble every role twice with different dynamic values and assert the bytes
  before the marker remain identical.
- Role tests reject forbidden fields, especially a complete plan in initial Track B capsules.
- Table-driven tests exercise every full-context trigger and the second-retrieval bound.
- Parity tests apply the same inputs to Codex and Claude Code contracts.
- Mutation tests break marker order, remove a role/gate, inject a forbidden field, and disable
  fallback; each mutation must fail with an actionable message.
- The aggregate byte test uses committed repository artifacts and requires at least 40%
  reduction. It invokes no model and makes no billed-token claim.
- Existing portability, skill-version, bundle-version, and registry validation gates remain
  release-blocking.

## Non-Functional Decisions

- **Define now:** deterministic ordering, bounded retrieval attempts, fail-loud/full-context
  degradation, provider parity, no persisted prompt/source bodies, backward compatibility,
  exact structural measurement, and every existing quality role.
- **Can wait:** general context kernel, cross-role retrieval service, compact planning, cohesive
  task generation, adaptive reviews, model routing, and provider billing integration. These
  belong to R3–R5 or remain owner-observed.

## Out of Scope

- Removing, merging, or conditionally skipping any review/QA role.
- Building CLI telemetry, provider billing adapters, or a durable prompt store.
- General context-kernel/selective-retrieval infrastructure (R3).
- Compact plans and cohesive-slice planning behavior (R4).
- Adaptive review or model routing (R5).
- Claiming token, cost, or quota savings from deterministic byte reduction alone.
- Persisting prompt bodies, source bodies, secrets, or unrestricted model responses.

## Planning Handoff

`writing-plans` must create one cohesive baseline-registry release plan. It must capture T0
before the first template edit, trace every R2 requirement to a contract test, require red →
green → mutation-red evidence, bump every changed skill and the dev bundle, and leave tag
publication to the registry's protected auto-tag workflow after merge.
