# R2B native routing acceptance

This playbook is an operator-run acceptance procedure. It does not authorize a
paid provider probe and it never records prompts, provider output, or secrets.

1. Create a scratch repository and isolated `HOME`, `AWM_HOME`, and `cwd`;
   use the exact released CLI and registry pair recorded by the issue. Do not
   alter global policy, registries, or capability files. Admit a compact v2
   plan with an approved policy and a current capability
   receipt. Record the plan and execution digests shown by admission.
2. Start the supervised cycle and submit `job routing-reserve` with the active
   generation token, obligation, lineage, routing envelope, and reproducible
   fingerprint. The supervisor must durably acknowledge the reservation before
   any native dispatch is attempted.
3. Submit `job routing-observe` only after the native runtime returns its
   agent identity. Confirm `job routing-report` exposes counts only; it must
   not expose the envelope or native identity.
4. Exercise one mechanical and one integration native attempt and record their
   actual native agent IDs/effective selections. Obtain independent full
   specification and code-quality reviews. Submit each routed review verdict
   with its `routingAttemptId`. `job gate`
   must reject a missing attempt, missing observed identity, stale fingerprint,
   unknown attempt, or plan/execution digest mismatch.
5. Interrupt after reservation and before observation. On resumption, replaying
   the same reservation must return the same attempt; an unknown native outcome
   must block re-dispatch until an operator records an observation or recovery.
6. Attempt a request from a superseded generation and a verdict bound to a
   different fingerprint. Both must be rejected by the supervised reducer and
   must leave durable evidence of the rejected request.

For a v1 plan, do not use lineage routing: its legacy admission and gate path
remain unchanged. Claude availability is UNTESTED unless this exact procedure
is completed there; every uncertified target remains blocked/degraded. On exit,
retain the report outside the fixture and remove only the scratch HOME/AWM_HOME
and repository—never restore or rewrite global machine configuration.
