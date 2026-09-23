# Machine model routing lifecycle — design

## Problem and decision

R2-B deliberately requires a capability receipt no older than 24 hours, but AWM
only validates and approves a caller-authored JSON document. It neither obtains
native evidence nor tells an operator when to configure a machine. Consequently
the approved policy can be `PASS` while routing remains `UNTESTED`, and a manual
daily renewal would spend operator time (and potentially inference tokens).

Do not extend the v1 expiry or mint a new receipt from a changed timestamp. Keep
v1 strict for compatibility. Introduce a separate, evidence-bound lifecycle:
read-only diagnosis; explicit one-time machine enrollment; opportunistic capture
of real native dispatches; and event-driven invalidation. A provider catalog is
evidence of *availability*, never proof of subagent dispatch, model override,
effort override, or observed identity.

## Requirements

- **R-SETUP-1:** WHEN an effective routing policy exists but the current
  machine/provider lacks usable native evidence, THE CLI SHALL report the exact
  missing setup step in `doctor` and `preflight`, without writing files or
  dispatching agents.
- **R-SETUP-2:** WHEN no routing policy exists, THE diagnostics SHALL keep the
  ordinary harness ready and report routing setup as optional rather than a
  blocking sensor failure.
- **R-SETUP-3:** WHEN the operator explicitly enrolls a machine/provider, THE
  setup flow SHALL validate the approved role selections, runtime, account and
  effective provider configuration, and SHALL finish with a per-selection
  readiness report. Setup is idempotent and is not repeated on ordinary work.
- **R-NATIVE-1:** WHEN a provider exposes a native, read-only model catalog and
  runtime/account identity, THE setup flow SHALL capture their validated values
  without inference; unknown or unsupported fields remain `UNTESTED`.
- **R-NATIVE-2:** IF the provider cannot expose native dispatch evidence, THEN
  THE setup flow SHALL refuse to mark dispatch-dependent capabilities
  `supported`, and SHALL identify the missing observation and its token cost as
  unknown until measured.
- **R-LIFE-1:** WHEN the runtime binary, account scope, selected-model policy, or
  relevant provider configuration changes, THE lifecycle SHALL invalidate only
  affected evidence before the next routed dispatch.
- **R-LIFE-2:** WHEN the environment has not changed, THE lifecycle SHALL NOT
  require a periodic operator action, a daily inference probe, or a reapproval
  caused solely by wall-clock time.
- **R-LIFE-3:** WHEN normal work produces a verifiable native dispatch
  observation, THE lifecycle SHALL record it once for the matching
  machine/provider/selection, without launching an additional task.
- **R-TRUST-1:** IF native dispatch, accepted model/effort or provenance cannot
  be verified, THEN optimized routing for that selection SHALL fail closed.
  Actual backend-model identity is a separate evidence level: when unavailable,
  it remains `UNTESTED` and only an explicitly approved operational/degraded
  policy may route; no verified savings claim or fabricated receipt is allowed.
- **R-TRUST-2:** IF an observed selection differs from the approved one, THEN
  THE current optimized route SHALL stop and record a durable mismatch. A
  catalog entry or static setting never overrides this native observation.
- **R-OPS-1:** WHEN an explicit active probe is necessary, THE CLI SHALL require
  a separate opt-in, state that tokens will be consumed, and report measured
  usage when the provider exposes it (otherwise `unknown`, never zero).
- **R-OPS-2:** WHEN optimized routing cannot be used during an unattended run,
  THE controller SHALL persist the reason and affected selection, surface it in
  status and the final report, and continue with an independently verified
  full-capability fallback when one exists. If no safe fallback exists, only the
  affected obligation blocks and the run reports the required operator action.
- **R-OPS-3:** WHEN the same routing fault recurs in a run, THE controller SHALL
  avoid repeated failed optimized dispatches, count affected obligations, and
  emit one actionable alert for the run rather than silently paying full cost
  on every task.
- **R-METRIC-1:** THE report SHALL distinguish configured/accepted selection,
  actual backend identity and measured token usage. Estimated savings may be
  labelled as estimates; verified savings require provider evidence of the
  effective model and usage. Missing data is `unknown`, never zero.

## Boundaries

`doctor` and `preflight` remain read-only and quick. They surface a setup remedy
but never invoke a provider or silently mutate `$AWM_HOME`. The explicit setup
command is the only machine-initialization entry point. Provider adapters may
read their own catalog and account/config metadata; each has its own native
evidence parser and versioned fixture corpus. A common validator normalizes
only observed facts into capability evidence. Neither an agent-authored JSON
summary nor a digest-shaped string is a native observation.

The persistent approval records operator policy, while evidence records
machine/provider observations. Evidence is scoped to target, runtime kind and
version, account-scope digest, configuration fingerprint, and selection.
Reconciliation is local and deterministic. Model catalog refresh is explicit or
part of setup/diagnostics when requested, never an inference call. Absence of a
refresh does not imply that provider access remains guaranteed: an unexpected
rejection or observed mismatch at dispatch invalidates that selection and stops
continuation. `UNTESTED` remains distinct from `unsupported`.

Codex can expose a model catalog through app-server `model/list`; that catalog
alone does not grant dispatch support. Claude Code's model picker can be
restricted by local and organization settings; a configured alias is not proof
of effective model selection. Claude Code documents `SubagentStart` with an
`agent_id` and `agent_type`, and `SubagentStop` with a separate
`agent_transcript_path`; those hooks establish lifecycle identity, not by
themselves the backend model. Its model restrictions can substitute an allowed
model for a requested restricted one. Provider-specific proof must therefore
be derived from an actual native event/trace, not from a static config file.
Sources: [Claude hooks](https://code.claude.com/docs/en/hooks),
[Claude model configuration](https://code.claude.com/docs/en/model-config).

Codex App Server explicitly labels `thread.model` and `thread.reasoningEffort`
as current/persisted thread configuration, **not per-turn execution telemetry**.
Those fields may establish what the runtime selected, but cannot certify the
backend model that produced a particular turn. Unless Codex exposes stronger
telemetry, `observedModelEvidence` must remain `unverified`; an owner-approved
`allowMissingObservedIdentity` can permit degraded routing without any savings
claim, and an owner who requires actual identity keeps the gate blocked.
Source: [Codex `Thread` protocol schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadListResponse.json).

## Owner decision DA-1: operational readiness without backend telemetry

The owner clarified the desired operation: configure each machine/provider at
specific setup moments, then run optimized daily work without periodic paid
renewal. An unattended run must not stop for an ordinary routing fault, and
must not silently abandon optimization. Treat this as approval of an
**operational evidence level**, not as proof of actual backend identity:

- One-time enrollment must prove the provider accepted a native subagent
  dispatch and the configured model/effort for each routed selection. A
  one-time active check may consume tokens only after explicit setup opt-in;
  its measured usage or `unknown` cost is shown then, not buried in daily work.
- With a matching runtime/account/config/policy fingerprint, normal work uses
  the enrolled optimized route. The receipt has no wall-clock expiry. Actual
  backend identity remains `UNTESTED` where the provider does not expose it;
  reports show configured routing and only estimated, never verified, savings.
- A change or rejection invalidates the affected selection, records a durable
  reason and moves that run to a verified full-capability fallback. It raises
  one actionable alert and a final summary, not a pause on every task. If the
  full-capability path is also unverified, the affected obligation blocks.
- The currently installed approved Codex policy still has
  `degradation.allowMissingObservedIdentity=false`. AWM must not rewrite it
  implicitly. The one-time setup flow presents a reviewed policy replacement
  for explicit approval before operational routing is enabled.

The operator-visible state transition is:

`UNENROLLED -> SETUP_PENDING -> READY_OPERATIONAL -> DRIFT_DETECTED ->
FALLBACK_FULL or BLOCKED -> REENROLL_ONCE -> READY_OPERATIONAL`.

`READY_OPERATIONAL` means native dispatch plus accepted configured selection,
not proven backend identity. `doctor`/`preflight` explain `UNENROLLED` and
`DRIFT_DETECTED` without starting a model. `FALLBACK_FULL` is a durable warning,
not a green optimized-routing result. The delivery map and acceptance gates are in
`docs/plans/2026-09-23-model-routing-closure-roadmap.md`.

### Unattended incident and notification contract

Before the first routed dispatch in a run, compare the receipt's local scoped
fingerprints. A match makes no provider request and does not change the receipt.
On local drift or a native rejection/mismatch, append a redacted durable event
before choosing another route. Use stable reason codes such as
`RUNTIME_DRIFT`, `ACCOUNT_DRIFT`, `CONFIG_DRIFT`, `POLICY_DRIFT`,
`PROVIDER_REJECTED`, `SELECTION_MISMATCH`, `PROVENANCE_MISSING` and
`FALLBACK_UNAVAILABLE`; retain an affected-obligation count and remedy, not a
prompt, transcript, secret or native account identifier. The same-run circuit
breaker skips further optimized attempts for the affected selection.

If the full-capability selection was separately enrolled and still matches the
current machine/provider scope, continue the obligation at full capability.
Emit one warning in the active task and include the reason, fallback count and
reenrollment command in the final unattended summary and read-only routing
status. Do not call the run optimized or silently report savings. If the full
selection is not safe, block only the affected obligation and report that
operator action is required. Do not recursively fallback or launch an active
probe without explicit authorization. A remote provider change that cannot be
seen in local state can only be detected when a native call rejects or yields a
mismatch; no local fingerprint can promise otherwise.

## Sequencing and acceptance

1. Add read-only routing setup diagnostics and explicit no-token discovery.
2. Add a native evidence producer for Codex, with fixture-tested capture and
   measured/unknown usage accounting. Do not promote from catalog-only data.
3. Add equivalent Claude Code adapter; unsupported native fields stay untested.
4. Add the event-driven receipt schema and invalidate v2 evidence on scoped
   environment drift. Keep v1's 24-hour rule unchanged.
5. Wire normal routed observations to the producer; exercise first setup,
   unchanged environment, drift, mismatched actual selection, and explicit
   active-probe cases end-to-end in each provider's supported environment.
6. Update baseline-registry routing/setup skills and user-facing guide so an
   agent discovers the setup gap at the right time, without priming normal work.

No phase may claim complete native certification merely because its unit tests
pass. Acceptance requires a real Codex dispatch and a real Claude Code dispatch
on an enrolled machine, with observed model and effort or explicit `UNTESTED`.
