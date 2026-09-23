# Model routing: closure roadmap

Status: **design decision resolved; implementation not yet admitted**. This
document is the delivery map, not a claim that an AWM compact plan has run.
Source design: `docs/plans/2026-09-23-model-capability-lifecycle-design.md`.

## Outcome and non-goals

Deliver one-time, explicit machine/provider setup for Codex and Claude Code,
followed by normal work that can produce honest routing evidence without a daily
receipt renewal or an extra inference probe on every run. `doctor` and
`preflight` stay read-only. A model catalog or static setting is never proof of
native subagent dispatch, effective model/effort, or backend model identity.
Operational routing can use a verified native dispatch and accepted configured
selection after one-time enrollment. Backend identity and verified savings stay
`UNTESTED` where the provider lacks telemetry; estimates must be labelled.
No code may quietly change a user's approved degradation flags.

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

Owner decision **DA-1** is now recorded as operational readiness with visible
fallback, not a demand for impossible backend telemetry. The current installed
Codex mapping still has
`allowMissingObservedIdentity=false`. The app-server `Thread` schema calls
`thread.model` and `thread.reasoningEffort` thread configuration, **not per-turn
execution telemetry**. Therefore enrollment must first prove native dispatch
and accepted configured selection; the one-time setup then offers an explicit
reviewed policy replacement for operational routing. AWM must not alter the
installed approval implicitly. See the
[Codex protocol schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadListResponse.json).

## Delivery order and proof

| Stage | Owner and surfaces | Exit evidence |
| --- | --- | --- |
| 0. Fix policy semantics | AWM models operational dispatch/selection verification separately from backend identity and provides an explicit reviewed policy approval during setup. `docs/plans/2026-09-23-model-capability-lifecycle-design.md`, `cli/src/core/model-policy/types.ts`, `cli/src/core/model-policy/resolve.ts`. | Tests prove that missing dispatch or accepted model/effort blocks optimized routing; missing backend telemetry can yield only an approved operational/degraded route, with no verified-savings claim. Installed policy is never rewritten automatically. |
| 1. One-time machine setup | AWM CLI owns explicit enrollment and read-only status. Codex adapter reads `model/list`, effective runtime/config and account scope where exposed. Claude adapter reads its own supported native surfaces; unknown fields stay unverified. An optional **one-time**, separately authorized active check proves native dispatch/selection and reports measured or unknown token use. The full-capability fallback is verified at setup too. `doctor`/`preflight` explain exactly what remains. | A clean machine shows `UNENROLLED`, then per-selection `READY_OPERATIONAL` only after the required native proof. Re-running setup without drift is idempotent, no inference. Missing binaries, catalog restrictions, invalid responses, symlinks and no-write diagnostics have tests. |
| 2. Native observations from normal work | Provider adapters ingest only bounded native events. Codex distinguishes a real child thread/dispatch and configured selection from actual backend identity. Claude uses native subagent hooks and validates any provider trace before extracting model evidence. Hook/supervisor integration owns capture; agent-authored summaries cannot promote capabilities. | Fixture and live traces show agent identity, parent linkage, requested versus accepted model/effort, provenance and usage if exposed. Missing actual identity stays `unverified`; mismatches invalidate the affected route. Normal work updates evidence without an extra probe. |
| 3. Event-scoped receipt | AWM core adds a separate v2 evidence/receipt schema and producer. Bind each claim to target, runtime binary/version, account scope, relevant provider config, approved policy digest and selection. Keep the v1 validator/24-hour rule unchanged. `cli/src/core/model-policy/capabilities.ts`, `types.ts`, store and tests. | Same fingerprint plus same approved policy remains current after 24 hours without write, inference or reapproval; drift invalidates only affected claims before dispatch. Unknown fingerprint, forged provenance, stale/native mismatch and unsafe files fail closed. Producer output is tied to validated native observations, not caller-authored capability JSON. |
| 4. Routing, custody and unattended recovery | `resolve`, plan admission, supervisor reservation/observation, job report and gate consume v2 evidence. Preserve v1 compatibility and exact journal digests. A per-run circuit breaker sends affected obligations to the separately verified full-capability selection after an optimized-route fault; no repeated failed low-cost dispatches. If full-capability is also unsafe, only the affected obligation blocks. | First enrollment, unchanged machine, each drift type, provider rejection, model mismatch, repeated failure, interrupted dispatch and recovery pass end-to-end tests. Every fallback has a durable reason, affected count, one alert, status visibility and final report; optimized savings are not silently reported when full capability ran. |
| 5. Registry and operator handoff | After the CLI contract is stable, update baseline-registry setup/routing skills and its versioned tests. Update AWM playbook with one-time setup and read-only status/receipt commands. Keep machine configuration instructions provider-specific, and distinguish Codex defaults from per-role policy. | Fresh Codex VPS/local and Claude cloud/local sessions discover the setup step without a special user prompt. The operator can run normal work and later read a redacted routing report that says what was verified, degraded or untested. Registry minCliVersion and release order are checked. |
| 6. Closure, not a partial PR | CLI and registry maintainers run focused tests, full suite once per final branch, `awm sensors run`, security/robustness review, native acceptance and docs. | One CLI PR only when stages 0–4 plus CLI documentation pass; one dependent registry PR only after compatible CLI release. Merge in that order, publish versions, then validate all available environments. Unavailable remote environments are explicitly `UNTESTED`, never inferred from VPS results. |

The design requirements are accounted for by the following acceptance cases;
these are tests to write or live checks to perform, not claims that they pass
today:

| Requirement | Stage | Required proof |
| --- | --- | --- |
| R-SETUP-1 | 1 | `doctor`/`preflight` show the missing machine/provider step without writes or dispatch. |
| R-SETUP-2 | 1 | No policy leaves ordinary preflight ready and routing optional. |
| R-SETUP-3 | 1 | One-time enrollment validates each role selection and a verified full fallback; unchanged repeat is idempotent. |
| R-NATIVE-1 | 1 | Codex and Claude adapters preserve validated catalog/runtime/account facts and mark unavailable facts unverified. |
| R-NATIVE-2 | 2 | Catalog/config-only fixtures cannot promote dispatch-dependent capabilities. |
| R-LIFE-1 | 3–4 | Each binary/account/config/policy drift invalidates only its affected selection before reservation. |
| R-LIFE-2 | 3 | At +25 hours with unchanged fingerprints, the v2 receipt remains usable without write, renewal or inference. |
| R-LIFE-3 | 2–4 | A real normal-work dispatch supplies one idempotent native observation; no extra test task is launched. |
| R-TRUST-1 | 0, 2–4 | Missing native dispatch or accepted selection blocks optimized routing; missing backend identity stays untested and only approved operational routing may proceed. |
| R-TRUST-2 | 2–4 | A native observed selection mismatch invalidates the affected route and persists a mismatch event. |
| R-OPS-1 | 2 | Without explicit probe opt-in, no active inference; with opt-in, report measured usage or `unknown`. |
| R-OPS-2 | 1, 4 | A simulated unattended routing fault uses only a verified full fallback, persists reason and appears in status/final report; unsafe fallback blocks that obligation. |
| R-OPS-3 | 4 | Repeated same-run faults trigger one alert and a count, without another failed optimized dispatch per task. |
| R-METRIC-1 | 4–5 | Routing report separates configured selection, backend identity, measured usage and estimated versus verified savings. |

## Operating constraints

The operator journey has only these moments (the `setup` invocation below is
the planned CLI contract, **not a command in the released v9.11.12 CLI**):

| Moment | AWM action | Operator action |
| --- | --- | --- |
| New machine/provider or changed model policy | `doctor`/`preflight` reports `UNENROLLED` and a precise remedy. Planned `awm model-policy setup --provider <target>` checks config/catalog/account, verifies the full fallback and offers a one-time native dispatch check with disclosed token cost. | Configure/approve once. Do not hand-author a receipt. |
| Ordinary attended or unattended work | Local read-only fingerprint comparison, then optimized dispatch. Normal native events are captured opportunistically. | None; no daily renewal or probe. |
| Drift, provider rejection or selection mismatch | Persist a reason code; one alert and same-run circuit breaker. Continue at the independently verified full selection, or block only the affected obligation if unsafe. Include count and remedy in final report. | Review the visible incident after the run; no silent fallback. |
| After an actual environment change | Re-enroll the affected machine/provider/selection once. | Run the setup remedy once; unchanged selections keep their evidence. |

- No recurring 24-hour action. A read-only local fingerprint comparison may run
  before routed dispatch; it must not invoke a model or update a receipt just
  because time passed. A provider event can invalidate a previously matching
  selection immediately.
- Active inference probes are separate, opt-in, and disclose token use if the
  provider reports it; otherwise cost is `unknown`, never zero. Ordinary
  development must not contain a daily probe or a test prompt.
- After setup, daily pre-dispatch validation is a local, read-only fingerprint
  check. A matching fingerprint keeps optimized routing ready without touching
  the receipt. Drift/rejection is an event, not a 24-hour timer. The fallback
  decision is durable and visible in the final unattended summary.
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

DA-1 is resolved in the source design. Split stages 0–4 into a **serial compact
AWM implementation plan** with one owner and RED/GREEN/independent review evidence
per requirement, then validate it with `awm plan validate`. Keep stage 5 in the
registry's own plan/worktree because it is a separate repository and release.
No unattended handoff or PR follows from this roadmap alone. The next code
action is the one-time enrollment contract and native evidence capture, not
another catalog-only feature.
