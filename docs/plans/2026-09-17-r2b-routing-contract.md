# R2-B routing protocol v1 — implementation contract

## Authority and approval boundary

Issue: https://github.com/Kodria/agentic-workflow/issues/126.
Planning authorized on 2026-09-17; the owner explicitly removed the pending
Claude R2-A trial as a prerequisite to R2-B planning. That trial remains untested.
CLI base: a3e2e2d4; registry base: 2915eb9 (published baseline v4.1.0).
This is a complete proposed implementation contract, not an installed policy.
Approving the implementation plans approves this contract; installing a runtime
policy still requires the explicit digest-bound approve command below.

Reuse CLI admission, verified plan snapshots, execution identity, journal
requests, generation fencing and interlock. Native host mechanisms dispatch.
All six AgentTarget values remain exhaustive. Never infer capability from a
renderer, documentation, a model name, or a previous machine.
No paid capability probe is required during authoring or implementation.

## Compatibility

Both implementation plans are compact-slices/v1 bootstrap plans. The feature
adds compact-slices/v2; v1 remains valid and retains existing admission and
quality obligations. V2 adds only implementerProfile on every slice, one of
mechanical, integration or judgment. No concrete model or vendor in manifests.
V1 routing is not-required unless the operator explicitly requests resolution
under an approved policy; never attribute routing savings to unchanged v1.
Registry producer emits v2 only when the installed CLI contract reports support
and policy readiness; otherwise emits v1 and reports routing unavailable.
No legacy executable route, automatic policy approval, or global session change.

## Data contracts

New modules: cli/src/core/model-policy/{types,validate,canonical,paths,store,
capabilities,resolve}.ts. New command: cli/src/commands/model-policy/index.ts.
Implement these public interfaces; every deserialized value enters as unknown.

```ts
type ImplementerProfile = 'mechanical' | 'integration' | 'judgment';
type RoutingRole = 'implementer' | 'specification-reviewer' |
  'code-quality-reviewer' | 'final-reviewer' | 'architecture' |
  'track-a-qa' | 'track-b-qa' | 'controller' | 'documentation' |
  'retro' | 'finishing';
type RuntimeKey = { target: AgentTarget; kind: string; version: string;
  accountScopeDigest: string }; // digest of a non-secret opaque local account label
type Selection = { selector: { kind: 'model' | 'tier'; id: string };
  effort: { kind: 'explicit'; value: string } | { kind: 'runtime-default' } };
type PolicyMapping = { target: AgentTarget; runtimeKind: string;
  profiles: Record<ImplementerProfile, Selection>;
  fullCapability: Selection;
  degradation: { allowMissingModelOverride: boolean;
    allowMissingEffortOverride: boolean; allowMissingObservedIdentity: boolean } };
type PolicyContent = { schema: 'model-policy/v1'; mappings: PolicyMapping[];
  implementationBudget: { maxAttempts: 3;
    escalation: ['mechanical', 'integration', 'judgment'];
    judgmentEfforts: ['medium', 'high'] } };
type ApprovedPolicy = { schema: 'approved-model-policy/v1'; content: PolicyContent;
  contentDigest: string; approval: { approvedAt: string; approvalId: string };
  lineage: { previousDigest: string | null } };
type CapabilityReceipt = { schema: 'routing-capabilities/v1'; runtime: RuntimeKey;
  recordedAt: string; expiresAt: string;
  capabilities: ProviderExecutionCapabilities;
  availableSelections: Selection[];
  runtimeDefaultSelection?: Selection;
  evidence: Array<{ capability: keyof ProviderExecutionCapabilities;
    kind: 'native-control' | 'native-dispatch' | 'unsupported';
    receiptDigest: string }>;
  approval: { approvalId: string; snapshotDigest: string } };
type DispatchEnvelope = { schema: 'routing-envelope/v1'; runtime: RuntimeKey;
  role: RoutingRole; planDigest: string; executionDigest: string;
  sliceId?: string; requestedProfile: ImplementerProfile | 'full';
  effectiveProfile: ImplementerProfile | 'full';
  resolved: Selection; policyDigest: string; capabilityDigest: string;
  outcome: 'native' | 'degraded'; unavailableEvidence: string[] };
type Resolution = { state: 'resolved'; envelope: DispatchEnvelope } |
  { state: 'not-required'; reason: 'v1-without-opt-in' } |
  { state: 'blocked'; diagnostics: PlanDiagnostic[] };
type DispatchAttempt = { schema: 'routing-attempt/v1'; id: string;
  obligationId: string; lineageId: string; attempt: number;
  envelope: DispatchEnvelope; envelopeDigest: string; fingerprint: string;
  state: 'reserved' | 'active' | 'complete' | 'blocked' | 'unknown';
  nativeAgentId?: string; observed?: Selection; verdict?: 'pass' | 'fail' | 'inconclusive';
  reasonCode?: string };
```

Policy writer API: validatePolicyContent(value: unknown): PolicyContent;
canonicalPolicyDigest(content: PolicyContent): string;
readEffectivePolicy(cwd: string): approved/absent/invalid plus provenance;
approvePolicy(input: { file: string; scope: 'user' | 'project'; cwd: string;
expectedDigest: string; replaceDigest?: string }): ApprovedPolicy.
Capability API: validateCapabilityReceipt(value: unknown): CapabilityReceipt;
readCapabilities(runtime: RuntimeKey, now: Date): current/absent/stale/invalid.
Selection API: resolveSelection(input: { role: RoutingRole;
requestedProfile: ImplementerProfile | 'full'; policy?: ApprovedPolicy;
capabilities?: CapabilityReceipt; runtime: RuntimeKey; now: Date }):
resolved selection with policy/capability digests and degradation evidence,
or blocked diagnostics. This pure boundary does not parse a plan.
Resolution API: resolveDispatch(input: { plan: VerifiedValidPlanReport;
role: RoutingRole; sliceId?: string; policy?: ApprovedPolicy;
capabilities?: CapabilityReceipt; runtime: RuntimeKey; optInV1: boolean;
lineageId?: string; now: Date }): Resolution. When supplied, lineageId reads
the currently bound journal through C4's validated lineage helper. It selects
the next approved attempt without mutating state; reservation rechecks it.
VerifiedValidPlanReport is the existing valid report
authenticated by assertVerifiedValidPlanReport, not a caller-created cast.

## Limits and persistence

Use awmHome() at call time: user policy model-policy.json, capabilities under
routing-capabilities/<target>/<runtime-kind>.json. Project override is
.awm/model-policy.json. Personal policy is outside registries/profile.json.
No absolute installation paths are persisted. Policy restores validate content;
capability receipts must be re-attested for the new runtime/account.
Project policy present but invalid blocks; no silent user fallback. A valid
project policy owns its entire target/runtime mapping; no partial merge.

Maximum file 256 KiB, 64 mappings, 128 characters per identifier/selection,
20 diagnostics of 4096 characters. Reject unknown/duplicate fields, nonfinite or
unsafe numbers, invalid enums, control chars, duplicate target/runtime pairs,
missing profile/full rows and degradation booleans. Semver must be numeric.
Runtime kind is a safe path component matching ^[a-z0-9][a-z0-9_-]{0,127}$;
accountScopeDigest and every SHA-256 digest are exactly 64 lowercase hex digits.
No caller-provided path component contains separators or traversal tokens.
Use parseJsonNoDuplicate. Canonical digest sorts object keys recursively,
preserves array order, UTF-8 SHA-256; approval/timestamps are outside content.
A mismatch rejects before writing. Candidate input is inspected as a bounded
regular file; inspect all observable parents, no unsafe symlinks.
An inline full-role obligation may reference the current registered controller's
nativeAgentId and selection. It gets its own obligation/role receipt, not a
fabricated child dispatch; reports distinguish role receipts from native spawns.

Read-only commands never mkdir/write/cache/refresh/install. Writers inspect
owned parents, lock exclusively with wx (a leftover lock blocks for explicit
recovery), reread and compare expected previous digest under that lock, validate
new state fully, and use writeFileAtomicDurable plus 0600. Initial publication
uses exclusive no-replace hard-link as initBoundJournal does. CAS replacement
uses the existing native durable transaction guarantees; do not label ordinary
rename a portable CAS. If an external modification changes identity/content
under the lock, reject rather than overwrite. Test two competing writers and
injected write/fsync failures on real supported CI operating systems.

Capability receipt approval is an explicit owner attestation of bounded native
evidence. A supported claim needs matching native-control or native-dispatch
evidence; documentation-only evidence cannot grant supported. Capability
availability is at most 24 hours old, expiresAt no more than 24 hours after
recordedAt, matching target/kind/version/account. Unverified never satisfies
a required gate. No automatic inference paid to refresh availability.

## Public commands to implement

All commands accept --cwd ROOT; identifiers, values and unknown flags fail
loudly. Read results exit 0 for usable state, 2 for blocked/unavailable; input
errors exit nonzero with bounded diagnostics. These APIs do not exist in 9.8.0.

- model-policy contract --json: read-only routing-protocol/v1, supported plan
  schemas, roles/profiles, limits and protocolDigest. No machine policy content.
- model-policy approve --file FILE --scope user|project --expected-digest SHA
  [--replace-digest OLD_SHA] --json: explicit writer above; approval is not
  capability certification. Replacement requires exact CAS predecessor.
- model-policy status --provider TARGET --runtime-kind KIND
  --runtime-version VERSION --account-scope-digest SHA --json: read-only
  effective provenance/digest, absent/invalid/ready/blocked and drift reasons.
- model-policy capabilities approve --file RECEIPT --expected-digest SHA
  [--replace-digest OLD_SHA] --json: explicitly attest validated native receipt;
  never upgrade unknown capabilities from a renderer.
- plan resolve PLAN_PATH --provider TARGET --runtime-kind KIND
  --runtime-version VERSION --account-scope-digest SHA --role ROLE
  [--slice SLICE] [--opt-in-v1] [--lineage ID] --json: read-only, returns Resolution.
  Implementer and local spec/quality roles require slice; globals reject slice.
  Resolution never replaces empirical admission, custody or job gate.
- job routing-reserve --generation TOKEN --obligation ID --lineage ID
  --envelope-file FILE --fingerprint SHA --json: durable request through the
  current supervisor, reserves one bounded attempt before native dispatch.
- job routing-observe --generation TOKEN --attempt ID --native-agent-id ID
  --observation-file FILE --json: bounded actual selection evidence.
- job routing-report --json: read-only planned versus actual role counts,
  retries, fallbacks, administrative repairs and unavailable values.

Reserve/observe exit 0 is only an emission receipt. Controller waits for the
existing durable applied ack before acting. Request rejection means zero dispatch.
Interactive routing requires explicit journal initialization for reservations;
ordinary v1 interactive behavior remains journal-free. No second workflow store.

## Resolution and escalation algorithm

1. Authenticate plan snapshot and current runtime. V1 without explicit opt-in
   returns not-required. V2 demands effective approved policy and current receipt.
2. A non-implementer uses fullCapability independently of slice profile.
   Implementer v2 reads exactly its validated implementerProfile; v1 opt-in full.
3. Select exact target/runtime row. Missing/corrupt approval/mapping blocks.
4. Require explicit native model/effort overrides where requested. If unsupported,
   allow only approved fullCapability degradation when its actual default is
   attested as runtimeDefaultSelection and equals fullCapability exactly.
   Listing an available selection alone does not attest an actual default.
   Missing model/effort capability that is unverified blocks.
   Runtime-default effort is valid only when explicitly approved and attested.
5. Selection must appear exactly in receipt availableSelections. If not, block.
   Never select a newer/more expensive alternative silently.
6. Missing observed identity is degradation only when explicitly approved; it
   suppresses routing-savings claims. Actual mismatch always invalidates the
   affected obligation and blocks current continuation.
7. Freeze envelope digest before reservation. Drift in policy/capability/runtime,
   fingerprint or plan/execution identity invalidates affected evidence.
8. Initial plus correction dispatches consume three implementation attempts per
   logical lineage; escalation consumes an attempt. mechanical -> integration ->
   judgment; judgment medium may rise to high inside the same approved flagship.
   Missing mapping for the escalation blocks. Reviews retain current full role.
   New session/generation/plan digest never resets lineage budget. Environment,
   currentness, publication and administrative failures consume no new attempt.
   C4 resolves an existing implementation lineage only for its bound slice and
   obligation: choose the next profile in escalation after a failed attempt.
   Starting integration therefore progresses to judgment, not mechanical.
   After judgment medium, high is allowed only when fullCapability has the
   identical selector and explicit high effort; otherwise escalation blocks.
   No lower-profile reset or fourth attempt. The initial slice profile stays
   immutable; the envelope/report records the effective escalation separately.
9. Unknown native dispatch outcome blocks adoption/redispatch until reconciled
   with nativeAgentId and custody; never promise exactly-once host dispatch.
   Same envelope/fingerprint/lineage with active reservation returns that attempt.
10. Full relevant context for public, security, root configuration or uncertainty
    keeps compact roles, R2-A grouping and every quality gate.

## Candidate matrix for owner approval

These exact IDs reproduce the prior recommendation; they are candidate content,
not verified availability or installed defaults. Missing catalog support blocks.

| Target/runtime | mechanical | integration | judgment | full roles |
| --- | --- | --- | --- | --- |
| codex/native runtime | gpt-5.6-luna / medium | gpt-5.6-terra / medium | gpt-5.6-sol / medium | gpt-5.6-sol / high |
| claude-code/native runtime | claude-sonnet-5 / low | claude-sonnet-5 / medium | claude-opus-5 / medium | claude-opus-5 / high |

Other targets obtain explicit model/tier IDs from their runtime/account catalog.
OpenCode, Cursor and Copilot have no implicit vendor choice. Antigravity pro is
only a proposed tier degradation, never proof of a Gemini model or full capacity.
Ship a validated candidate template requiring complete target/runtime rows
before approval; do not ship fabricated mappings. Three attempts is proposed
approved policy content. Matrix and budget are reviewed with the plan before
implementation; actual policy installation remains digest-bound.

## Forecast, journal and final acceptance

Preserve existing v1 forecast shape. Add routingForecast to admission for v2:
counts by role/profile with known/unavailable provenance; per-slice implementer,
spec and quality = N, final review/A/docs/retro/finishing = 1 each. Track B
count equals the explicitly supplied validated lens list; when unknown, report
minimum 1 and exact count unavailable, never pretend the panel is one dispatch.
Controller-specific work is separately known/unavailable. No quota/price estimate.

Add optional versioned routingAttempts and implementationLineages to schema-2
journal, validated recursively before mutation. Legacy absence is readable
but cannot satisfy new routing obligations. Existing generations fence requests,
supervisor is sole state writer, appliedRequests provides ack/idempotency.
Attach current routing attempt reference to routed verdict/verification; gate
requires resolved/observed-or-approved-degraded evidence for that obligation.
Mechanical jobs unrelated to routing retain existing gates/fingerprints.
Rebind never blesses a stale routed verdict or resets attempts.

Complete requires independent current spec+quality, final review, Track A and
applicable Track B, docs, retro, empirical sensors/R8 and release verification.
R2-A remains authoritative for grouping, reuse and administrative receipt repair.

Publish compatible CLI first (additive release expected 9.9.0; actual published
version is authoritative), then set registry minCliVersion to that real release,
never a guessed number. Actual native acceptance is a separate explicit gate:
one mechanical and one integration plus full independent reviewers per certified
runtime. Unavailable Claude remains untested; other targets declare blocked or
approved degraded states. Mock/fixture passes are not native model acceptance.
R3 billed-cost comparison remains separate; no savings claim in R2-B.
