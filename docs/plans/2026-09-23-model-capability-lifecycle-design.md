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
- **R-TRUST-1:** IF provenance or actual model/effort cannot be verified, THEN
  THE affected selection SHALL remain `UNTESTED` and routing SHALL fail closed;
  no savings claim or fabricated receipt is allowed.
- **R-OPS-1:** WHEN an explicit active probe is necessary, THE CLI SHALL require
  a separate opt-in, state that tokens will be consumed, and report measured
  usage when the provider exposes it (otherwise `unknown`, never zero).

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
of effective model selection. Provider-specific proof must therefore be derived
from an actual native event/trace, not from a static config file.

Codex App Server explicitly labels `thread.model` and `thread.reasoningEffort`
as current/persisted thread configuration, **not per-turn execution telemetry**.
Those fields may establish what the runtime selected, but cannot certify the
backend model that produced a particular turn. Unless Codex exposes stronger
telemetry, `observedModelEvidence` must remain `unverified`; an owner-approved
`allowMissingObservedIdentity` can permit degraded routing without any savings
claim, and an owner who requires actual identity keeps the gate blocked.
Source: [Codex `Thread` protocol schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadListResponse.json).

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
