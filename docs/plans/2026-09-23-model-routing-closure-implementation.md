# Model routing machine enrollment and unattended recovery Implementation Plan
<!-- awm-qa-complete: 2026-09-24 -->
<!-- awm-docs-complete: 2026-09-24 -->
<!-- awm-retro-complete: 2026-09-24 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enroll Codex and Claude Code routing once per machine/provider, retain only evidence tied to unchanged runtime and policy, and make unattended routing failure visible with safe full-capability continuation.

**Architecture:** A provider-specific native observation is normalized into a separate event-scoped receipt; the legacy 24-hour v1 receipt remains unchanged. Dispatch checks local fingerprints before reservation and native observations after dispatch, with a per-run circuit breaker and durable incident summary.

**Tech Stack:** TypeScript, Commander, Jest, AWM journal and secure filesystem bridge.

**Modo de ejecución:** interactivo

---

<!-- AWM:COMPACT-SLICES:START v1 -->
{"schema":"compact-slices/v1","planId":"model-routing-machine-lifecycle-20260923","requirements":["R-SETUP-1","R-SETUP-2","R-SETUP-3","R-NATIVE-1","R-NATIVE-2","R-LIFE-1","R-LIFE-2","R-LIFE-3","R-TRUST-1","R-TRUST-2","R-OPS-1","R-OPS-2","R-OPS-3","R-METRIC-1"],"sources":[{"id":"DESIGN","path":"docs/plans/2026-09-23-model-capability-lifecycle-design.md","locator":"## Requirements","fact":"Fourteen requirements define one-time setup, native proof, event-scoped currentness, safe unattended fallback, and honest metrics."},{"id":"V1","path":"cli/src/core/model-policy/capabilities.ts","locator":"export function validateCapabilityReceipt","fact":"Legacy routing-capabilities/v1 enforces a 24-hour expiry and digest approval; do not relax or rewrite this behavior."},{"id":"ROUTER","path":"cli/src/core/model-policy/resolve.ts","locator":"export function resolveDispatch","fact":"Routing currently consumes approved policy and v1 capability receipt, and must fail closed on unverified required capability."},{"id":"NATIVE","path":"cli/src/core/model-policy/native-codex.ts","locator":"export function queryCodexModelCatalog","fact":"Codex model/list is catalog-only; it does not attest native dispatch, accepted selection, or backend model."},{"id":"JOURNAL","path":"cli/src/core/model-policy/journal.ts","locator":"export function routingReport","fact":"The routing journal records attempts and reports degraded outcomes, but lacks reason-coded per-run incidents and verified-savings distinction."}],"commands":[{"id":"TEST-SETUP","program":"npm","args":["--prefix","cli","test","--","--runTestsByPath","tests/commands/model-policy/index.test.ts","tests/core/model-policy/setup-readiness.test.ts"],"covers":["R-SETUP-1","R-SETUP-2","R-SETUP-3","R-NATIVE-1","R-NATIVE-2","R-OPS-1"]},{"id":"TEST-RECEIPT","program":"npm","args":["--prefix","cli","test","--","--runTestsByPath","tests/core/model-policy/capabilities.test.ts","tests/core/model-policy/resolve.test.ts"],"covers":["R-LIFE-1","R-LIFE-2","R-TRUST-1","R-TRUST-2"]},{"id":"TEST-NATIVE","program":"npm","args":["--prefix","cli","test","--","--runTestsByPath","tests/core/model-policy/native-codex.test.ts","tests/commands/watch/dispatch-routing-identity.test.ts"],"covers":["R-LIFE-3","R-NATIVE-2","R-TRUST-2","R-METRIC-1"]},{"id":"TEST-UNATTENDED","program":"npm","args":["--prefix","cli","test","--","--runTestsByPath","tests/commands/watch/supervisor-loop.test.ts","tests/core/model-policy/journal.test.ts","tests/commands/job/routing-report-cli.test.ts"],"covers":["R-OPS-2","R-OPS-3","R-METRIC-1"]},{"id":"TYPECHECK","program":"npm","args":["--prefix","cli","run","typecheck"],"covers":["R-SETUP-3","R-LIFE-1","R-LIFE-3","R-OPS-2"]}],"slices":[{"id":"S1","title":"Explicit machine setup and native proof","requirements":["R-SETUP-1","R-SETUP-2","R-SETUP-3","R-NATIVE-1","R-NATIVE-2","R-OPS-1"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["DESIGN","NATIVE"],"redCommands":["TEST-SETUP"],"greenCommands":["TEST-SETUP","TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["full-context"]},{"id":"S2","title":"Event-scoped evidence and policy binding","requirements":["R-LIFE-1","R-LIFE-2","R-TRUST-1"],"dependsOn":["S1"],"sectionAnchor":"slice-s2","sources":["DESIGN","V1","ROUTER"],"redCommands":["TEST-RECEIPT"],"greenCommands":["TEST-RECEIPT","TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["full-context"]},{"id":"S3","title":"Observe real native dispatches","requirements":["R-LIFE-3","R-TRUST-2"],"dependsOn":["S2"],"sectionAnchor":"slice-s3","sources":["DESIGN","NATIVE","JOURNAL"],"redCommands":["TEST-NATIVE"],"greenCommands":["TEST-NATIVE","TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["full-context"]},{"id":"S4","title":"Visible unattended fallback and honest report","requirements":["R-OPS-2","R-OPS-3","R-METRIC-1"],"dependsOn":["S3"],"sectionAnchor":"slice-s4","sources":["DESIGN","JOURNAL","ROUTER"],"redCommands":["TEST-UNATTENDED"],"greenCommands":["TEST-UNATTENDED","TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["full-context"]}],"closureCommands":["TEST-SETUP","TEST-RECEIPT","TEST-NATIVE","TEST-UNATTENDED","TYPECHECK"]}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Explicit machine setup and native proof

#### Surfaces
Own R-SETUP-1/2/3, R-NATIVE-1/2 and R-OPS-1 in `cli/src/commands/model-policy/index.ts`, `cli/src/core/model-policy/setup-readiness.ts`, provider-specific native adapters, and corresponding tests. These requirements share the same operator setup boundary; diagnostics remain read-only. Neither native provider exposes a safe CLI operation that creates an attested child on behalf of setup, so setup must never initiate inference.

#### Implementation
1. RED: assert no-policy preflight remains ready, an approved but unenrolled mapping prints `awm model-policy setup --provider TARGET`, and setup reports every approved profile plus fullCapability independently.
2. Implement provider adapters that return bounded, validated `catalog`, `runtime`, `accountScopeDigest`, and `configDigest` facts. Codex `model/list` remains availability only; Claude settings and hooks remain configuration/lifecycle only until a real child dispatch and accepted model/effort can be linked. Unknown fields are `untested`, never `supported`.
3. Setup prints which selections need native proof and `tokenUsage: unknown`, but never spawns a child. The operator performs each missing selection once as an ordinary native child and then uses `capture` (Codex) or the installed Stop hook (Claude). `--allow-inference` is deliberately unsupported rather than a no-op or synthetic proof. Setup verifies fullCapability separately and never edits the approved policy; where `allowMissingObservedIdentity=false`, it names the policy decision requiring the existing digest/approve ceremony.
4. GREEN: run TEST-SETUP and TYPECHECK. Negative fixtures cover missing binary, restricted model, absent account identity, malformed event and repeated setup; unchanged setup must be idempotent and no-inference.

#### Edge cases
Reject unknown CLI flags, absent values, unsafe paths/symlinks, unbounded provider payloads, and non-finite usage. A catalog item cannot turn `nativeSubagents`, `modelOverride`, `effortOverride`, or `observedModelEvidence` into supported. No active inference in setup or routine preflight/doctor.

#### Evidence
Use DESIGN and NATIVE facts. TEST-SETUP is RED before implementation and GREEN after; TYPECHECK must pass. Independent specification and code-quality verdicts include explicit provider event provenance and no-write diagnostic assertions, bound to current plan identity.

#### Fallback
If a native provider interface cannot expose accepted selection, retain `UNTESTED` for it and block optimized enrollment for that provider; make the missing fact and operator remedy visible. Do not simulate native evidence or weaken v1.

<a id="slice-s2"></a>
### Slice S2: Event-scoped evidence and policy binding

#### Surfaces
Own R-LIFE-1/2 and R-TRUST-1 in `cli/src/core/model-policy/types.ts`, `capabilities.ts`, `resolve.ts`, setup store and tests. These are one receipt-consumption boundary and depend on S1's validated producer.

#### Implementation
1. RED: v1 expires at +25 hours; v2 with identical runtime/account/config/policy and native selection proof stays current at +25 hours without a write, and each changed fingerprint invalidates only affected selections.
2. Define `routing-capabilities/v2` separately with target, runtime binary/version, accountScopeDigest, configDigest, policyDigest, selection key, recordedAt, native dispatch/accepted-selection provenance, and actual backend identity level. Persist through the existing secure lease/CAS write path. Only S1/S3's native producer may mint v2; candidate JSON approval must reject v2.
3. Resolve per-selection v2 only after recomputing local fingerprints. Missing native dispatch, accepted model or accepted effort blocks optimized routing. Missing actual backend identity remains `untested`; allow operational degraded routing only under explicitly approved `allowMissingObservedIdentity=true`, never as verified savings.
4. GREEN: TEST-RECEIPT and TYPECHECK. No wall-clock refresh or inference on read; preserve v1 validator and approval behavior exactly.

#### Edge cases
Unknown fingerprint, forged native provenance, invalid schema, future timestamp, unsafe file or policy digest mismatch fail closed. A different selection in the same scope is not invalidated unless its shared scope itself changed.

#### Evidence
Use DESIGN, V1 and ROUTER. TEST-RECEIPT proves unchanged +25h and independent drift cases. Independent specification and quality verdicts inspect the secure durable boundary and current plan identity.

#### Fallback
If provider-scoped fingerprint is unavailable, report `UNTESTED` and do not route optimized; retain v1 compatibility. Amend plan and revalidate if a provider requires a different stable scope.

<a id="slice-s3"></a>
### Slice S3: Observe real native dispatches

#### Surfaces
Own R-LIFE-3 and R-TRUST-2 in provider adapters, `cli/src/commands/watch/apply.ts`, supervisor integration, and native routing tests. These share one producer-to-journal provenance boundary and depend on S2's v2 schema.

#### Implementation
1. RED: agent-authored `routing-observe` alone cannot activate a v2 attempt or renew a receipt; a validated child-thread/hook native event linked to its reservation, agent ID and accepted selection can update only its matching claim once.
2. Link Codex child thread configuration and parent linkage to native dispatch, explicitly marking backend identity untested. Link Claude SubagentStart/Stop by agent ID and validated provider trace; hook lifecycle alone does not certify accepted model. Use native event ID for idempotence and bounded redacted evidence. Compare observed versus approved selection before committing an update.
3. On native mismatch persist `SELECTION_MISMATCH` before any further optimized reservation; reject stale/cross-parent/replayed event. Do not launch a synthetic normal-work probe. GREEN: TEST-NATIVE and TYPECHECK.

#### Edge cases
Unknown event schema, mismatched parent or runtime, duplicate agent ID, model alias substitution, malformed usage and missing effort remain unverified or mismatch; no capability promotion from a digest-shaped agent-authored summary.

#### Evidence
Use DESIGN, NATIVE and JOURNAL. TEST-NATIVE covers positive fixtures, malformed/forged fixtures, duplicate capture and matching selection. Independent specification and quality verdicts bind to current plan identity.

#### Fallback
Where native trace lacks accepted selection, leave the claim untested and use only a separately verified full-capability path; do not infer from static config or catalog.

<a id="slice-s4"></a>
### Slice S4: Visible unattended fallback and honest report

#### Surfaces
Own R-OPS-2/3 and R-METRIC-1 in `cli/src/commands/watch/supervisor.ts`, routing journal/report, `cli/src/commands/job/index.ts`, status and tests. They share the same per-run incident and reporting boundary.

#### Implementation
1. RED: first optimized fault persists one reason-coded incident with one stable alert ID; same-run repeated obligations skip optimized attempts and increment affected count. Delivery is at-least-once: a crash between stderr/event emission and journal acknowledgement may repeat that same ID, never create a second incident. Full fallback runs only when separately enrolled/current; absent full fallback blocks only the affected obligation.
2. Introduce durable redacted incident keys by run/provider/selection and reason codes `RUNTIME_DRIFT`, `ACCOUNT_DRIFT`, `CONFIG_DRIFT`, `POLICY_DRIFT`, `PROVIDER_REJECTED`, `SELECTION_MISMATCH`, `PROVENANCE_MISSING`, `FALLBACK_UNAVAILABLE`. Journal CAS records the event before fallback choice. Per-run circuit breaker prevents repeated failed optimized dispatches; status and final report show count, selected full fallback, and one precise reenrollment command.
3. Report configured/accepted selection separately from actual backend identity and token usage. Unknown usage is `unknown`, not zero; estimated savings label is explicit, and verified savings requires provider evidence for effective backend model and usage. GREEN: TEST-UNATTENDED and TYPECHECK.

#### Edge cases
Interrupted dispatch reuses obligation identity; no recursive fallback; incident and alert de-duplicate across retries; malformed durable incident state fails closed. Never store prompts, transcripts, credentials or account IDs.

#### Evidence
Use DESIGN, JOURNAL and ROUTER. TEST-UNATTENDED exercises drift, repeated failure, full fallback unavailable, interrupted recovery and report semantics. Independent specification and quality verdicts plus final suite/sensors verify current plan identity.

#### Fallback
If native provider event cannot be reconciled, persist `PROVENANCE_MISSING`, stop optimized routing for that selection, and use only verified full fallback. Never silently continue on the optimized path.

## QA resolution

The independent review ledger recorded seven distinct findings. Six were
corrected with focused red/green tests: Claude runtime-default reservation,
lineage fallback after native failure, stale proof activation, bounded JSON
reads, provider-reported backend model in the routing report, and passive
setup diagnostics. The remaining machine-wide custody finding was reconciled
against the contract instead of suppressed:

- Machine-wide runtime/account/config drift invalidates every selection in
  that provider scope, including `fullCapability` and the controller. The
  supervisor therefore enters durable, reason-coded custody; no verified
  routed obligation remains eligible for per-obligation fallback. Selection-
  specific faults still use the per-run circuit and independently enrolled
  full fallback without stopping unrelated work.
Doctor/preflight are deliberately passive and cannot attest the current
provider process. They now label a sealed receipt as local coverage only,
without demanding recurring setup. Admission and each routed dispatch
recompute current machine scope; drift is surfaced with its reason and
`awm model-policy setup --provider TARGET --json` remedy.
