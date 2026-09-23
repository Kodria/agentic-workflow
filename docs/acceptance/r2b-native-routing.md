# R2B native routing acceptance

This playbook is an operator-run acceptance procedure. It does not authorize a
paid provider probe and it never records prompts, provider output, or secrets.

Before attempting an attestation, run `awm doctor` or `awm preflight` in the
project. If either reports `routing-setup`, inspect the machine without
dispatching an agent:

```sh
awm model-policy discover --provider codex --cwd "$PWD" --json
```

`policyCoverage.state=complete` means that the approved Codex model/effort
selections appear in the native catalog of **this machine**. A `missing` result
lists the exact selections to investigate: check the signed-in account, Codex
runtime and the approved policy. A local config edit cannot grant access to a
model absent from the native catalog. If the machine's default model also needs
setting, Codex reads `model` and `model_reasoning_effort` from its layered
`config.toml`; CLI flags, trusted project config, profile, user config and
managed defaults have [documented precedence](https://learn.chatgpt.com/docs/config-file/config-basic).
That default is separate from AWM's per-role policy. Neither result proves subagent dispatch or the model that
served a turn: `nativeDispatchVerified` and `actualModelVerified` remain false.
This discovery does not create or renew a capability receipt and consumes no
inference tokens. Claude Code currently has no native catalog adapter in this
flow; its discovery result is `unverified`, not an implicit Codex pass.

Do not renew a v1 receipt by editing its timestamps or run a daily paid probe.
Until a native evidence producer and event-scoped receipt are available, a
strict routing policy remains blocked when its receipt expires. Continue
ordinary unrouted work if appropriate; do not claim routed savings or native
certification from catalog coverage alone.

Before starting, fill this evidence header and retain it outside the fixture:

```
CLI_VERSION_OR_SHA=<released CLI version or commit>
REGISTRY_VERSION_OR_SHA=<installed registry version or commit>
PLAN_PATH=<absolute compact-v2 plan path>
PLAN_DIGEST=<admission output>
EXECUTION_DIGEST=<admission output>
EVIDENCE_DIR=<absolute durable evidence directory>
PROVIDER=codex
RUNTIME_KIND=native
RUNTIME_VERSION=<attested runtime version>
ACCOUNT_SCOPE_DIGEST=<64-lowercase-hex>
GENERATION=<active supervisor generation token>
OBLIGATION=<registered review obligation>
LINEAGE=<implementation lineage id>
FINGERPRINT=<64-lowercase-hex reproducible fingerprint>
POLICY_DIGEST=<64-lowercase-hex policy content digest>
RECEIPT_DIGEST=<64-lowercase-hex canonical capabilityReceiptDigest of receipt.json>
RECEIPT_SNAPSHOT_DIGEST=<receipt approval.snapshotDigest; evidence only, not --expected-digest>
ATTEMPT_ID=<applied routing reservation attempt id>
NATIVE_AGENT_ID=<native runtime returned identity>
```

1. Create a scratch repository and isolated `HOME`, `AWM_HOME`, and `cwd`;
   use the exact `CLI_VERSION_OR_SHA` / `REGISTRY_VERSION_OR_SHA` pair above. Do not
   alter global policy, registries, or capability files. Admit a compact v2
   plan with an approved policy and a current capability
   receipt. Record `PLAN_DIGEST`, `EXECUTION_DIGEST`, request IDs, attempt IDs,
   routing report, and gate JSON beneath `EVIDENCE_DIR`.

```sh
awm model-policy approve --file "$EVIDENCE_DIR/policy.json" --scope project --expected-digest "$POLICY_DIGEST" --json
awm model-policy capabilities approve --file "$EVIDENCE_DIR/receipt.json" --expected-digest "$RECEIPT_DIGEST" --json
awm plan admit "$PLAN_PATH" --provider "$PROVIDER" --cwd "$PWD" --runtime-kind "$RUNTIME_KIND" --runtime-version "$RUNTIME_VERSION" --account-scope-digest "$ACCOUNT_SCOPE_DIGEST" --json | tee "$EVIDENCE_DIR/admission.json"
awm plan resolve "$PLAN_PATH" --provider "$PROVIDER" --runtime-kind "$RUNTIME_KIND" --runtime-version "$RUNTIME_VERSION" --account-scope-digest "$ACCOUNT_SCOPE_DIGEST" --role implementer --slice S1 --cwd "$PWD" --json | tee "$EVIDENCE_DIR/resolution.json"
```
2. Start the supervised cycle and submit `job routing-reserve` with the active
   generation token, obligation, lineage, routing envelope, and reproducible
   fingerprint. The supervisor must durably acknowledge the reservation before
   any native dispatch is attempted.

```sh
awm job routing-reserve --generation "$GENERATION" --obligation "$OBLIGATION" --lineage "$LINEAGE" --envelope-file "$EVIDENCE_DIR/envelope.json" --fingerprint "$FINGERPRINT" --cwd "$PWD" --json | tee "$EVIDENCE_DIR/reserve.json"
# Wait for the supervisor's applied acknowledgement, then dispatch natively.
awm job routing-observe --generation "$GENERATION" --attempt "$ATTEMPT_ID" --native-agent-id "$NATIVE_AGENT_ID" --observation-file "$EVIDENCE_DIR/observation.json" --cwd "$PWD" --json | tee "$EVIDENCE_DIR/observe.json"
awm job routing-report --json | tee "$EVIDENCE_DIR/routing-report.json"
awm job gate | tee "$EVIDENCE_DIR/gate.json"
```
3. Submit `job routing-observe` only after the native runtime returns its
   agent identity. Confirm `job routing-report` exposes counts only; it must
   not expose the envelope or native identity.
4. Exercise one mechanical and one integration native attempt and record their
   actual native agent IDs/effective selections. Obtain independent full
   specification and code-quality reviews. Submit each routed review verdict
   with its `routingAttemptId`. `job gate`
   must reject a missing attempt, missing observed identity, stale fingerprint,
   unknown attempt, or plan/execution digest mismatch.
5. Only after a reservation has been observed and receives a terminal `fail`
   verdict, resolve the correction against that existing lineage. Do not pass
   `--lineage` for the first v2 resolution or for an active/unknown attempt.

```sh
awm plan resolve "$PLAN_PATH" --provider "$PROVIDER" --runtime-kind "$RUNTIME_KIND" --runtime-version "$RUNTIME_VERSION" --account-scope-digest "$ACCOUNT_SCOPE_DIGEST" --role implementer --slice S1 --lineage "$LINEAGE" --cwd "$PWD" --json | tee "$EVIDENCE_DIR/correction-resolution.json"
```

   Submit the returned effective envelope through a new `routing-reserve` and
   wait for its applied acknowledgement before any correction dispatch.
6. Interrupt after reservation and before observation. On resumption, replaying
   the same reservation must return the same attempt; an unknown native outcome
   must block re-dispatch until an operator records an observation or recovery.
7. Attempt a request from a superseded generation and a verdict bound to a
   different fingerprint. Both must be rejected by the supervised reducer and
   must leave durable evidence of the rejected request.

Mark each target `VERIFIED` only after all numbered steps and evidence files
exist. Otherwise mark it `UNTESTED`; never infer it from a policy or renderer.
For a v1 plan, do not use lineage routing: its legacy admission and gate path
remain unchanged. Claude availability is UNTESTED unless this exact procedure
is completed there; every uncertified target remains blocked/degraded. On exit,
retain the report outside the fixture and remove only the scratch HOME/AWM_HOME
and repository—never restore or rewrite global machine configuration.
