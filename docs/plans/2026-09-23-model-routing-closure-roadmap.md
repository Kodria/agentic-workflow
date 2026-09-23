# Model routing: closure roadmap

Status: **planning-required** for the final routing contract. This document is a
decision and delivery map, not an admitted AWM compact implementation plan.
Source design: `docs/plans/2026-09-23-model-capability-lifecycle-design.md`.

## Outcome and non-goals

Deliver one-time, explicit machine/provider setup for Codex and Claude Code,
followed by normal work that can produce honest routing evidence without a daily
receipt renewal or an extra inference probe on every run. `doctor` and
`preflight` stay read-only. A model catalog or static setting is never proof of
native subagent dispatch, effective model/effort, or backend model identity.
Savings are reported only when the evidence required by the approved policy is
present. No code may quietly change a user's approved degradation flags.

Do not make a v1 receipt immortal by removing its 24-hour check, changing its
timestamp, or treating a digest-shaped string as a native observation. Do not
edit global Codex/Claude config during diagnosis. A provider rejection or
identity mismatch must stop the affected routed dispatch before continuation.

## Current checkpoint (2026-09-23)

The diagnostic/catalog work is committed on
`codex/model-routing-setup-diagnostics` (`565fc3c`). It adds a non-mutating
`doctor`/`preflight` routing advisory and explicit Codex `model/list` discovery
with policy coverage. On this VPS, the approved Codex selections all appear in
the catalog; `nativeDispatchVerified=false` and `actualModelVerified=false`.
The full CLI suite passed after building the test native addon (310 suites,
4,129 tests; platform skips excluded); `awm sensors run` returned `overall: pass`.
PR #192 was closed because this checkpoint alone is not mergeable as the
requested solution. Keep it as an antecedent, not an accepted capability proof.

The current approved Codex mapping has
`allowMissingObservedIdentity=false`. The app-server `Thread` schema calls
`thread.model` and `thread.reasoningEffort` thread configuration, **not per-turn
execution telemetry**. Therefore catalog coverage and a thread's configured
selection cannot satisfy the strict backend-identity requirement. The decision
needed before an executable final plan is: retain strict blocking until native
telemetry exists, or allow an explicitly approved degraded outcome with
`observedModelEvidence=unverified` and no savings claim. Neither choice may be
inferred from a previous receipt. See the
[Codex protocol schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadListResponse.json).

## Delivery order and proof

| Stage | Owner and surfaces | Exit evidence |
| --- | --- | --- |
| 0. Resolve policy semantics | Owner approves strict or degraded identity semantics; AWM design fixes the corresponding fail-closed states. `docs/plans/2026-09-23-model-capability-lifecycle-design.md`, `cli/src/core/model-policy/types.ts`, `cli/src/core/model-policy/resolve.ts`. | An explicit policy decision; tests demonstrate strict blocks missing actual identity and degraded is only possible when the matching approved flag permits it. No policy file is rewritten automatically. |
| 1. Machine setup, no inference | AWM CLI owns an explicit setup/status path. Codex adapter reads `model/list`, effective runtime/config identity and account scope if natively exposed. Claude adapter reads its own supported native configuration/identity surfaces; unavailable fields remain `unverified`. `cli/src/commands/model-policy/`, `cli/src/core/model-policy/native-codex.ts`, a separate Claude adapter and provider fixtures. | On a clean machine, commands state the exact missing step and never approve a receipt or spawn an inference. Catalog/config changes cause an explicit mismatch. Tests cover missing binaries, invalid/native response, pagination/limits, symlinks and no writes. |
| 2. Native observations from normal work | Provider adapters ingest only bounded native events. Codex must distinguish a real child thread/dispatch and configured selection from actual per-turn backend identity. Claude must distinguish native subagent start/stop and model evidence actually present in the provider trace. Hook/supervisor integration owns capture; agent-authored summaries cannot promote capabilities. | Fixture and live traces show native agent identity, parent linkage, requested versus accepted model/effort, provenance and usage if exposed. Missing actual identity stays `unverified`; mismatches block. A normal routed task yields the observation without an additional test task. No active probe runs implicitly. |
| 3. Event-scoped receipt | AWM core adds a separate v2 evidence/receipt schema and producer. Bind each claim to target, runtime binary/version, account scope, relevant provider config, approved policy digest and selection. Keep the v1 validator/24-hour rule unchanged. `cli/src/core/model-policy/capabilities.ts`, `types.ts`, store and tests. | Same fingerprint plus same approved policy remains current after 24 hours without write, inference or reapproval; drift invalidates only affected claims before dispatch. Unknown fingerprint, forged provenance, stale/native mismatch and unsafe files fail closed. Producer output is tied to validated native observations, not caller-authored capability JSON. |
| 4. Routing and custody | `resolve`, plan admission, supervisor reservation/observation, job report and gate consume v2 evidence. Preserve v1 compatibility and exact journal digests. | First enrollment, unchanged machine, changed binary/account/config/policy, lost access, mismatched selected model, interrupted dispatch and recovery pass end-to-end tests. Strict/degraded outcomes and savings reporting reflect the owner's approved policy. |
| 5. Registry and operator handoff | After the CLI contract is stable, update baseline-registry setup/routing skills and its versioned tests. Update AWM playbook with one-time setup and read-only status/receipt commands. Keep machine configuration instructions provider-specific, and distinguish Codex defaults from per-role policy. | Fresh Codex VPS/local and Claude cloud/local sessions discover the setup step without a special user prompt. The operator can run normal work and later read a redacted routing report that says what was verified, degraded or untested. Registry minCliVersion and release order are checked. |
| 6. Closure, not a partial PR | CLI and registry maintainers run focused tests, full suite once per final branch, `awm sensors run`, security/robustness review, native acceptance and docs. | One CLI PR only when stages 0–4 plus CLI documentation pass; one dependent registry PR only after compatible CLI release. Merge in that order, publish versions, then validate all available environments. Unavailable remote environments are explicitly `UNTESTED`, never inferred from VPS results. |

The design requirements are accounted for by the following acceptance cases;
these are tests to write or live checks to perform, not claims that they pass
today:

| Requirement | Stage | Required proof |
| --- | --- | --- |
| R-SETUP-1 | 1 | `doctor`/`preflight` show the missing machine/provider step without writes or dispatch. |
| R-SETUP-2 | 1 | No policy leaves ordinary preflight ready and routing optional. |
| R-NATIVE-1 | 1 | Codex and Claude adapters preserve validated catalog/runtime/account facts and mark unavailable facts unverified. |
| R-NATIVE-2 | 2 | Catalog/config-only fixtures cannot promote dispatch-dependent capabilities. |
| R-LIFE-1 | 3–4 | Each binary/account/config/policy drift invalidates only its affected selection before reservation. |
| R-LIFE-2 | 3 | At +25 hours with unchanged fingerprints, the v2 receipt remains usable without write, renewal or inference. |
| R-LIFE-3 | 2–4 | A real normal-work dispatch supplies one idempotent native observation; no extra test task is launched. |
| R-TRUST-1 | 0, 2–4 | Missing provenance/actual identity stays untested; strict blocks and owner-approved degraded mode never claims savings. |
| R-OPS-1 | 2 | Without explicit probe opt-in, no active inference; with opt-in, report measured usage or `unknown`. |

## Operating constraints

- No recurring 24-hour action. A read-only local fingerprint comparison may run
  before routed dispatch; it must not invoke a model or update a receipt just
  because time passed. A provider event can invalidate a previously matching
  selection immediately.
- Active inference probes are separate, opt-in, and disclose token use if the
  provider reports it; otherwise cost is `unknown`, never zero. Ordinary
  development must not contain a daily probe or a test prompt.
- AWM may guide a user to configure machine defaults, but cannot silently edit
  account, provider or policy settings. The selected provider may impose
  organization-level restrictions that local config cannot override.
- Codex and Claude have independent adapters and live acceptance. A missing
  Claude binary on the VPS is not a Claude failure or proof for the cloud/local
  installations. Provide a one-command, redacted evidence handoff for those
  environments after a compatible release.
- Maintain separate status labels: `catalog-available`, `dispatch-observed`,
  `selection-configured`, `actual-identity-observed`, `degraded`, `untested` and
  `blocked`. No status is promoted by a timestamp-only renewal.

## Execution gate and next action

After the owner resolves stage 0, split stages 1–4 into a **serial compact AWM
implementation plan** with one owner and RED/GREEN/independent review evidence
per requirement, then validate it with `awm plan validate`. Keep stage 5 in the
registry's own plan/worktree because it is a separate repository and release.
No unattended handoff or PR follows from this roadmap alone. The next code
action is native evidence capture, not another catalog-only feature.
