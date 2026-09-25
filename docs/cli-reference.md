# CLI Reference

The `awm` (Agentic Workflow Manager) binary is the entry point for the registry and the harness. It supports an interactive Text User Interface (TUI) via Clack Prompts by default, plus quiet, flag-based execution for scripting and CI.

New to AWM? Start with [installation](installation.md), [configuration](configuration.md),
and [project setup](project-setup.md). This page is the exhaustive command surface;
the [runbook](runbook.md) covers ongoing operations.

## Compact v2 routing and custody

`compact-slices/v1` remains valid and has no routing requirement unless an
operator explicitly opts in. `compact-slices/v2` adds only the per-slice
implementer profile; it never embeds a provider or model. Routing is admitted
only with an approved policy and a current native capability receipt.

```
awm model-policy contract --json
awm model-policy setup --provider codex|claude-code --json
awm model-policy discover --provider codex --json
awm model-policy capture --provider codex --runtime-kind native --parent-thread-id <id> --child-thread-id <id> --json
awm model-policy approve --file <policy.json> --scope user|project --expected-digest <sha> --json
awm model-policy capabilities approve --file <receipt.json> --expected-digest <sha> --json
awm model-policy status --provider <target> --runtime-kind <kind> --runtime-version <version> --account-scope-digest <sha> --json
```

Policy approval is not a native capability probe. Legacy `routing-capabilities/v1`
approval remains an owner attestation with a 24-hour expiry. `setup` inspects
the actual CLI binary, account and model-relevant configuration on this machine;
it does not dispatch inference. A native v2 receipt is captured separately for
each approved selection and has no clock renewal. It becomes stale when the
runtime binary/version, account scope, model configuration, or that selection's
policy mapping changes. `doctor` and `preflight` show setup guidance when an
approved mapping lacks local evidence. With sealed local coverage they label it
as coverage only, not a current-machine attestation; routed dispatch checks
the actual runtime/account/config fingerprints. Daily work does not run a
paid probe.

For Codex, configure the desired models in the native runtime and complete one
child turn per distinct approved selection. `capture` reads a recent existing
parent/child pair through the Codex app server; a catalog listing alone cannot
certify dispatch. Codex currently does not expose independently verified backend
model identity in this path, so routing requires an explicit policy decision to
allow operational/degraded use (`allowMissingObservedIdentity`), never verified
savings. Setup has no active-probe option: the available provider APIs cannot
start a child and prove its provenance safely on behalf of setup. A one-time
ordinary native child per approved selection supplies the evidence; setup and
routine diagnostics never silently spend tokens.

For Claude Code, run `awm hooks install --agent claude-code` once on each machine.
Create a custom agent under the provider's `agents/` directory for each distinct
approved full model ID, for example:

```md
---
name: awm-integration
description: Approved integration worker
model: claude-sonnet-4-6
---
Perform the assigned integration task.
```

The name must begin `awm-`; the model must be an exact ID, not an alias or
`inherit`. Set the same approved model at runtime-default effort, invoke that
named agent once as normal work, then run `awm model-policy setup --provider
claude-code --json`. Native SubagentStart/Stop hooks pair its identity with the
child transcript's observed model. The v2 receipt binds the named agent to the
selection, and `plan resolve` returns `envelope.nativeAgentType`; dispatch that
type, not a generic agent with a model parameter. An unrelated agent is ignored.
Claude effort overrides are not certified by this path; use runtime-default
effort only. Hook failures are reported by reason code in setup and stderr, but
do not stop the native Claude task.

On every machine/provider, repeat setup only after a relevant change or when a
missing selection is first used. No fabricated renewal, background token use,
or success claim based solely on a model name in a candidate JSON is allowed.

```
awm plan resolve <plan> --provider <target> --runtime-kind <kind> --runtime-version <version> --account-scope-digest <sha> --role <role> [--slice <id>] [--opt-in-v1] [--lineage <id>] [--cwd <path>] --json
```

Local implementer/specification/code-quality roles require a valid slice;
global roles reject one. With `--lineage`, this is read-only: it returns an
effective envelope and a custody handoff, not a dispatch.

```
awm job routing-reserve --generation <token> --obligation <id> --lineage <id> --envelope-file <file> --fingerprint <sha> [--cwd <root>] --json
awm job ack <requestId>
awm job routing-observe --generation <token> --attempt <id> --native-agent-id <id> --observation-file <file> [--cwd <root>] --json
awm job routing-report --json
```

For a v2 Codex attempt, the observation file contains
`{"parentThreadId":"<native-parent-thread-id>"}` and `--native-agent-id` is the
actual child thread ID. The CLI reads that completed child and its local turn
context, checks that the event occurred after reservation, and refreshes only
the matching receipt claim. For Claude, use the named `envelope.nativeAgentType`
and pass `{}` after its Stop hook has captured the same agent ID and transcript.
The supervisor verifies the locally sealed event proof; a self-reported
`observed` selection is not accepted for v2. If verification is unavailable,
the attempt records `PROVENANCE_MISSING` and can fall back only to an
independently enrolled full selection. This does not block unrelated work.

The supervisor is the sole journal writer. For a compact v2 implementer,
`routing-reserve` only emits a request ID. Poll `awm job ack <requestId>` until
`state` is `applied`, then use its `resultRef` as `routingAttemptId` when
registering the task's dispatch with `awm job register --generation <token>
--entity dispatch --json <payload>`. Wait for that dispatch request's own
`applied` ACK before launching the native child or allowing it to write. Only
then emit `routing-observe` for the actual child and wait for its ACK; emitting
a request is not an applied acknowledgement. `ack` and `reconcile` are
read-only and do not accept `--generation`. `ack` reports `pending`, `applied`,
`rejected`, `unknown`, or `unverifiable` as bounded JSON; only `pending` and
`applied` exit successfully, and `pending` does not authorize native launch.
If a pre-9.12.3 journal already has an unlinked dispatch with an applied ACK
matching the exact legacy dispatch payload for the same task *before* its
still-reserved route, register a fresh dispatch request
using that historical `dispatchId` and the applied `routingAttemptId`. AWM
preserves the old record and ACK, returns a distinct linked ID in the new
ACK's `resultRef`, and does not count a second implementer attempt. The old ACK
is historical only; its untyped `resultRef` cannot authorize a native child.
If the legacy dispatch and reservation timestamps tie at millisecond precision,
AWM also requires the old applied ACK to precede the reservation ACK in the
single-writer journal's persisted ACK order. A missing or reversed order remains
in custody; equal timestamps alone never authorize a child.
A different requested ID is rejected even if the first linked attempt later fails: a
blocked routing verdict alone does not prove that the native child stopped.
That retry needs separately verified ownership before another dispatch.
An observed/ambiguous native attempt or live work blocks the first handoff;
never launch a child using the historical ACK.
Envelope and observation files must be bounded non-symlink JSON files with no duplicate
keys. When an optimized selection is missing or rejected, resolution may use
only the independently enrolled full-capability selection; if that too is
unverified, the affected obligation blocks with a reason code. Routing
incidents and fallback counts are durable, and the unattended supervisor emits
an alert instead of silently claiming optimization. Alerts are durable and
carry a stable incident ID; after a crash at the delivery boundary stderr may
repeat the same alert ID, which is preferable to losing the incident.
`routing-report` is read-only. Its `selections` rows show the configured
selection and a separately native-reconciled accepted selection, or `unknown`.
`nativeReconciledByRole` does not count agent-reported child IDs alone. Claude
can supply a provider-reported model ID from its captured transcript; Codex
does not expose backend model identity here. Token usage remains `unknown`, so
savings remain `unverified` even when a model ID is reported. A machine-wide
runtime/account/config drift blocks unattended admission in visible custody:
the same scope also invalidates the full fallback, so no safe routed dispatch
can continue until `awm model-policy setup --provider TARGET --json` explains
the required reenrollment.

## Concepts used across commands

- **Agent target** (`-a, --agent`): one of `claude-code`, `codex`, `opencode`, `cursor`, `copilot`, or `antigravity`. It determines where artifacts install and how context is delivered. See [configuration](configuration.md) for provider capabilities, defaults, and coexistence.
- **Scope** (`-s, --scope`): `global` (machine-wide, in the agent's global dir) or `local` (inside the current repo).
- **Method** (`-m, --method`): `symlink` (default — links to the `~/.awm` cache so `awm update` patches everything at once) or `copy` (ejects a standalone copy).

---

## Setup & diagnostics

### `awm init`

Bootstraps AWM for one provider per run. Without `--agent`, it targets
`claude-code`. A normal run can reconcile both machine state and the current project.
For the lifecycle and provider choices, see [configuration](configuration.md).

```
awm init [--agent <agent>] [--machine-only] [--yes] [--json]
```

`awm sensors init` also accepts these compatibility-only options:

| Flag | Description |
|---|---|
| `-a, --agent <agent>` | Target one provider for this run. Without this flag, init targets `claude-code`. |
| `--machine-only` | Run only machine-level steps and exclude **every** project-scoped write. Providers without global delivery defer their content until normal project initialization; AWM does not write project files to work around that limitation. |
| `-y, --yes` | Skip confirmation prompts (for scripts). |
| `--json` | Emit the full `InitOutcome` as JSON instead of the rendered report — on success **and** on failure. |

**Exit codes:** `0` init did its job — including a run that ends `degraded`, i.e. ran to completion with checks still pending · `2` did not complete: a gate refused, or a step failed and every write was rolled back. **`1` is not used.**

> **Changed in v5.0.0.** `degraded` previously exited `1`, which made a completed
> init fail under `set -e`. The exit code now answers whether init completed;
> `awm doctor` answers harness health. See [decisions D-008](decisions.md#d-008).

**`--json` contract.** Both documents carry a `result` field, so a script that wants the `ok` / `degraded` distinction can branch on it — the exit code no longer encodes it:

| `result` | Exit | Document |
|---|---|---|
| `ok` / `degraded` | 0 | The `InitOutcome`: `steps`, `applied`/`pending`/`failed`, `before`, `after`, `transactionId`, `modifiedFiles`. |
| `failed` | 2 | A failure envelope: `error` (names the failed steps), `steps`, `failedSteps` (the `action: "failed"` subset, each with `id` and `error`), `before`, `after`, and `transaction`. |

On `result: "failed"`, `transaction` records what happened to the machine: `committed` is always `false`, `rolledBack` says whether every path in `restoredFiles` was restored to its pre-init state, and `rollbackError` appears only if the restore itself failed (recover with `awm backup restore <transactionId>`). `after` is the state observed at the end of the step pipeline — *before* the rollback ran — so it describes what the failing run produced, not what is on disk now.

Human mode renders the same evidence: on failure the three-panel report is printed as usual, with the failing step marked `✖` and its error inline, followed by the summary on stderr.

**What it does:** syncs the registry cache · installs the agent's context mechanism (Claude: `SessionStart` hook; OpenCode: global `opencode.json` `instructions[]`) · installs the `dev` and `product` baseline bundles · bootstraps `.awm/profile.json` · detects the stack and writes `.awm/sensors.json` · wires `CONSTITUTION.md` into the repo-local `opencode.json` (OpenCode). It **flags** (but does not perform) the steps that need an agent or a deliberate choice: generating `CONSTITUTION.md` / agent context, and installing the Claude per-edit sensor hook.

The output has three panels: **Initial state**, **Actions**, and **Final state**.
A red initial row that turns green in the final panel means the step repaired it;
the final panel is the result to act on.

### `awm doctor`

Read-only dashboard of machine + project harness state. Changes nothing.

```
awm doctor [--json | --full | --html <file> [--force]] [--agent <agent[,agent...]>]
```

Glyphs: `✔` healthy · `⚠` advisory (does not degrade) · `✖` missing (degrades state). Each non-healthy row carries a remedy — a command (`→ awm …`) or a skill to ask the agent to run (`→ skill: …`). `--json` emits a `ProviderDiagnosticReport`: `{ providers: [...], overall }`, one entry
per resolved agent with its `tier` and `checks`. If you are asserting on parsed fields,
that is the shape — there is no top-level `results` array.

A row that is **absent** means "nothing to verify", not "verified fine": a provider with no
native-agent directory, or a registry that ships no `agents/`, emits no row rather than a
red one nobody can act on. Two rows worth knowing:

- **`project.orphans`** — skill links in the project that no longer belong to any declared
  extension. Advisory; `awm sync` heals or prunes them.
- **`workflows.global`** — machine-scope workflows, for the providers that use them
  (today: Antigravity).

Use `--full` for the complete, read-only machine/project dashboard in the terminal.
Use `--html <file>` to write the same snapshot as one self-contained HTML file;
it writes only the requested file and refuses to replace an existing one unless
`--force` is supplied. `--json`, `--full`, and `--html` are alternative output
modes; `--force` is valid only with `--html`. See [Dashboard and project
evidence](guides/dashboard-and-evidence.md) for how to interpret the lifecycle
and history sections.

### `awm evidence capture`

Persist one privacy-preserving, local observation for a completed or blocked
cycle. The retrospective flow normally runs it before archiving the branch
ledger, so most operators do not need to invoke it directly.

```
awm evidence capture --plan <repo-relative-plan> [--pr-provider github|gitlab|other --pr-number <number>]
```

The command prints the opaque cycle identifier on success and stores the
record in `.awm/evidence/cycles/`. It records structural states and counts,
not repository identity, plan paths, ledger prose, command output, environment
values, or secrets. Both PR options must be supplied together. A missing,
corrupt, or still-active journal is an explicit error rather than an inferred
result.

### `awm agent list`

List every supported provider and this machine's enabled/default state.

```
awm agent list [--json]
```

The human output marks enabled providers and the default; `--json` emits rows
with `id`, `label`, `enabled`, and `default`. This command only inspects AWM
preferences. See [configuration](configuration.md#inspect-enabled-and-default-providers)
for how the provider set affects normal commands.

### `awm agent disable <agent>`

Stop AWM from managing an enabled provider without deleting that provider's
existing hooks, skills, or instruction files.

```
awm agent disable <agent> [--default <replacement-agent>]
```

If `<agent>` is the current default, `--default <replacement-agent>` is
required, and that replacement must remain enabled. For example:

```bash
awm agent disable claude-code --default codex
```

Re-enable a provider through a normal `awm init --agent <provider>` run.

### `awm preflight`

Verify the project harness can actually gate **before** development starts.

```
awm preflight [--json] [--verify-sensors] [--require-current] [--cwd <path>]
```

| Flag | Description |
|---|---|
| `--json` | Emit the report as JSON. Preserved on failure, so a red run is still machine-readable. |
| `--verify-sensors` | Run the full, empirical sensor gate. This is the read-only handoff check for unattended execution. |
| `--require-current` | Require fresh authoritative npm/Git currentness for the CLI and every configured registry. |
| `--cwd <path>` | Project directory to check. Default: current directory. |

Where `awm doctor` answers *"is AWM installed correctly?"*, preflight answers *"can this project stop bad work from landing?"* — the distinction matters when onboarding a repository, because an install can be perfect while the project has nothing enforceable behind it.

By default preflight is static and does not dispatch a sensor. Add
`--verify-sensors` immediately before an unattended handoff: it runs the full
sensor set, remains read-only, and accepts only an overall `pass`. Its failed
`sensors-execution` check identifies each selected non-pass sensor with only
bounded execution facts (timeout, source, elapsed time, and reason); it never

relays arbitrary tool output. If no sensor execution is established — for
example, `not_certified` with an empty sensor list — it reports that no sensor
established an empirical pass and directs the operator to `awm sensors init`.
It does not fabricate a sensor name, timeout, source, or elapsed time. This
makes a timeout, an inconclusive result, or a missing configuration actionable
before a human has gone away.

`--require-current` is a separate strict, read-only gate. It checks the installed
CLI against npm `dist-tags.latest` and each configured registry against its remote
stable tag; it bypasses the passive update cache. The report keeps
**currentness** separate from local registry **compatibility** (`minCliVersion`):
either can block unattended handoff. Stale CLI remediation is
`npm i -g agentic-workflow-manager@latest` followed by a fresh process; stale
registries use `awm update --yes`, while pinned-behind registries require
`awm unpin REGISTRY_NAME` followed by `awm update --yes`. Unverifiable authority
remains blocking and reports its cause: a CLI ahead of npm `latest` calls for
checking both versions, local registry tag or origin problems call for inspecting
the checkout, and only a failed remote tag query calls for restoring source
access. Rerun strict preflight after resolving the reported cause.
If the local registry inventory itself is malformed, strict JSON still emits an
`unverifiable` `registry:inventory` component and its repair remedy; it does not
fall back to an unstructured error.

For cacheable containers, resolve the published CLI immediately before the strict
gate:

```bash
npm exec --yes --package=agentic-workflow-manager@latest -- awm preflight --require-current
```

The enforceable boundary is deliberately narrow: this gate protects an environment
that executes a fresh CLI/bootstrap; it cannot update a host or cached container that
never runs new code. `minCliVersion` compatibility remains a separate local contract,
not evidence that a CLI or registry is current.

### `awm plan validate PLAN_PATH`

Validate a `compact-slices/v1` plan without executing its commands, contacting the
network, or rewriting the plan. An unmarked plan is historical input that needs
migration: validation reports `migration-required` with reason `unmarked-plan` and
exits 2 in both human and JSON modes. Unsupported or malformed compact declarations
also exit 2; only a valid `compact-slices/v1` plan exits 0.

```bash
awm plan validate PLAN_PATH [--json] [--cwd <path>]
```

### `awm plan admit PLAN_PATH`

Read-only fail-closed admission for a valid compact plan. It checks the selected
provider and, when requested, that consumed contracts are current, their declared
`minCliVersion` is compatible with the installed CLI, and project
sensors have an empirical PASS. It never initializes a journal or dispatches an
agent. A blocked JSON report is the remediation boundary; it is not permission
to run the plan.

Consumed contracts include the configured registry supplying installed native
planning/execution skills, even when the plan cites only project files. The
provider's actual artifact paths and renderer determine which skills are present;
an installed contract with unprovable ownership blocks currentness rather than
silently excluding its registry. The supervisor uses the same admission scope
and compatibility checks before native dispatch.

```bash
awm plan admit PLAN_PATH --provider <target> --cwd <path> [--execution-mode interactivo|desatendido] [--require-current] [--verify-sensors] [--json]
```

For unattended work, initialize the matching valid unattended plan first with
`awm watch --init --plan PLAN_PATH`. Initialization binds the plan; it does not
register tasks, review obligations, or a controller generation. Native dispatch
requires that real runtime custody separately; an empty journal is not execution
evidence. An interactive plan cannot be bound as unattended.

`awm watch rebind --plan PLAN_PATH` may accept progress-only changes during a
quiescent in-progress cycle when both bindings have a validated, hash-only
`awm-plan-execution/v1` commitment. Only governed checkboxes and recognized
standalone lifecycle markers are progress: requirements, source facts, commands,
prose, fenced or malformed markers remain digest-sensitive. Legacy bindings
without that commitment cannot be upgraded by rereading a new plan. Other changes
require the existing completed, quiescent-cycle route. Rebind never rewrites job
fingerprints or preserves a stale PASS; rerun affected verification jobs.

### `awm watch journal-status`

```bash
awm watch journal-status [--json]
```

Read-only observation of the current branch: `missing`, `corrupt`, or `present`,
with sanitized binding metadata, `bootstrapUnused`, and the latest generation's
number, token and state when one exists. The generation token remains visible
after the supervisor stops, so it can be used for a verified recovery. It exports no plan,
prompt, source body, or inferred completion evidence.

### `awm watch recover-request`

```bash
awm watch recover-request --rejected <requestId> --replacement <requestId> --generation <token> --reason <text> [--resume]
```

Use this only for a `register-entity task` request that the supervisor rejected.
`awm job gate` exits non-zero and reports the rejected request's file and
reason. Correct the task payload, including every verifier required by the
journal; `awm job register --entity task` now rejects missing verifier kinds
before it writes a new request. Record the new request ID from that command's
output. `awm watch journal-status --json` reports `latestGeneration.token`,
including after a clean supervisor shutdown.

Stop the supervisor and let it release its lock before running recovery. The
command checks the archived original (`.json.rejected`), the pending replacement,
the same task ID and current generation, and the absence of a live controller.
It applies the replacement and records the link, digest, reason and timestamp in
the journal before removing the pending file; the rejected archive remains.
An incompatible or still-invalid replacement leaves the cycle blocked. The
operation is safe to retry after interruption.

Use `--resume` only after all active request problems are corrected and the
request rejection is the sole custody cause. Without it, the cycle remains
`BLOCKED` until an explicit later recovery call with the same IDs, generation
and reason plus `--resume`. Other custody causes cannot be cleared by this
command. Then restart `awm watch` with the cycle's normal provider/runtime
options and inspect `awm job gate`: unfinished tasks and other missing evidence
still block certification. This is an operator recovery path, not an automatic
retry of invalid requests.

### `awm watch recover-admission`

Use this only when the current branch's unattended cycle is `BLOCKED` by
`ADMISSION_CURRENTNESS_BLOCKED`, `ADMISSION_SENSORS_BLOCKED`, or the exact
local-runtime query/mismatch custody reason reported by the supervisor. The supervisor
first retries an inconclusive currentness or sensor observation up to three
times, waiting five seconds between checks. It does not launch a controller,
create a generation, consume requests or dispatch jobs during those checks.
`stale` currentness and other conclusive failures enter custody immediately.

Stop `awm watch` cleanly so it releases the supervisor lock. Inspect
`awm job gate` for the blocking reason and `awm watch journal-status --json`
for the latest generation token. Then use
the **same** provider, native runtime identity and controller posture as the
cycle; `--provider` must be explicit even for Codex:

```bash
awm watch --provider codex --runtime-kind native --runtime-version <version> --account-scope-digest <sha256> --controller-autonomy approval-free recover-admission --generation <token> --reason "currentness y sensores verificados por el operador"
```

Omit `--generation` only if the journal has no generation (for example, when
admission failed before the first launch). Run this from the repository's
current branch. The command takes the exclusive lock, verifies the bound plan,
strict currentness and sensors, the sealed native receipt against the local
runtime/account scope, and the absence of active request problems or ambiguous
controller/jobs, active/ambiguous native routing attempts, or a linked
dispatch ACK that could already have launched a child. It records the original blocking reason, operator reason and
generation in the journal before changing the cycle to `IN_PROGRESS`. A
repeat of the same successful command returns `already-recovered` without a
second transition. For older journals without recorded runtime context, the
identity is an explicit operator assertion, marked as such in the audit; AWM
cannot reconstruct a historical runtime identity that was never stored.

If any check fails, the cycle stays `BLOCKED` and the error names the failing
gate. Fix the underlying currentness, sensors, runtime query or native receipt first; do not
edit `state.json`. After recovery, restart `awm watch` with the same flags.
Its next tick repeats strict admission **before** consuming requests or
dispatching, then resumes the durable `nextAction` and existing S1/jobs. A
pending task remains pending; recovery never declares it complete.

### `awm watch archive-unused`

```bash
awm watch archive-unused --plan PLAN_PATH
```

Recoverably archive only a strictly unused matching bootstrap under the exclusive
supervisor lock. Any runtime jobs, tasks, verdicts, generations, requests, or
unrecognized artifacts block this route. The archived state remains
`IN_PROGRESS`; the command neither declares `COMPLETE` nor certifies manually
executed work. A real terminal cycle still requires its ordinary evidence capture.

### `awm plan migration-facts PLAN_PATH`

```bash
awm plan migration-facts PLAN_PATH --cwd <path> --issue <https-url...> [--historical-root <path>] [--json]
```

Collect bounded, read-only historical facts into a report without rewriting the
original plan or resuming its tasks. Completion requires task-owned, terminal,
current file/command fingerprints and matching test, sensor, and review evidence.
Missing or stale provenance preserves a pending antecedent; it never authorizes
replaying checked work. The bounded `--historical-root` adapter admits only the
issue-148 sibling worktree and requires links to both issues 126 and 148.

#### Context Kernel v1 migration state

When an active registry declares `projectContextSchema: 1`, preflight also
reports the project-owned Context Kernel state:

| Artifacts | Preflight result | Meaning |
|---|---|---|
| Valid v1 index and markers | pass / `ready` | selective eligible |
| Absent | advisory / `ready` | legacy full context |
| Partial or invalid | failure / `degraded` | repair before unattended handoff |

`awm update` and `awm preflight` never rewrite project-owned `AGENTS.md`,
`CONSTITUTION.md`, `CLAUDE.md`, `.awm/context/index.json`, or context cards.
Migration is explicit and reviewed through `project-context-init`. A legacy advisory
preserves the complete-context quality path; a partial migration is blocking.

### `awm context-budget`

Check the size of the files injected into **every** agent session.

```
awm context-budget [--json] [--cwd <path>]
```

| Flag | Description |
|---|---|
| `--json` | Emit the report as JSON. |
| `--cwd <path>` | Directory to measure. Default: current directory. |

`CONSTITUTION.md`, `AGENTS.md`, and the skills the harness re-anchors are paid for on **every** session, not once. This command makes that recurring cost visible before it starts crowding out the work.

### `awm context orchestrators`

Read-only view of the orchestrators the installed registries declare, **exactly as they are composed** into the context every agent session receives.

```bash
awm context orchestrators              # human-readable listing
awm context orchestrators --json       # composed list as JSON
awm context orchestrators --verify my-process   # exit 0 if composed, 2 if not
```

Emits only the declared fields (`name`, `appliesWhen`, `terminatesTo`), not the full payload — that includes raw registry content. Invalid declarations, including an orchestrator whose `name` does not resolve to a discoverable skill in any configured safe registry, are reported as `warning:` lines on stderr and omitted without blocking healthy ones from being listed.

`--verify` is what closes `process-lifecycle`'s verification cycle: it confirms a freshly-generated process actually appears composed in a real installation, not just that the registry installed.

---

## Registry & artifacts

### `awm add [name]`

Install a **bundle** — a package of skills. With no `name`, launches an interactive search over the cached registry. With a `name`, the flags below let you skip the prompts (recommended for scripts).

**Bundles, not individual artifacts.** AWM's skills lean on each other — the
`development-process` spine invokes `brainstorming`, `writing-plans`, the QA gates — so a
skill installed alone rarely does what you expect. Passing a skill name fails with
`Bundle "<name>" not found in registry`. See [decisions D-001](decisions.md#d-001).

```
awm add [name] [-a <agent>] [-s <scope>] [-m <method>] [-y]
```

| Flag | Description |
|---|---|
| `-a, --agent <agent>` | Target agent. |
| `-s, --scope <scope>` | `global` or `local`. |
| `-m, --method <method>` | `symlink` or `copy`. |
| `-y, --yes` | Skip the final confirmation. |

```bash
# Fully scripted: install a skill globally via symlink on claude-code, no prompts
awm add dev --agent claude-code --scope global --method symlink --yes
```

### `awm list [package]`

List available artifacts from the local cache. With no argument, shows a package summary; pass a package name or `--all` to expand.

```
awm list [package] [-a, --all]
```

### `awm remove`

Remove an installed **bundle**. Interactive by default; the flags below make it scriptable.

```
awm remove [name] [-a <agent>] [-s <scope>] [-y]
```

| Flag | Description |
|---|---|
| `-a, --agent <agent>` | Target agent(s), comma-separated. Defaults to every enabled agent. |
| `-s, --scope <scope>` | `local` or `global`. Skips the scope prompt. |
| `-y, --yes` | Skip the confirmation. **Requires a name** — and implies fully non-interactive: no agent or scope prompt either. |

`--yes` without a name is refused. Removal without a name stays interactive so you see
what you are deleting; `--yes` skips the *confirmation*, never the *selection*.

Removing what is not installed is not an error — it reports that nothing matched and
exits `0`, so a cleanup script is safe to re-run.

### `awm sync`

Rebuild the project's local skill symlinks from `.awm/profile.json`. Run this after cloning a repo on a new machine, where the profile is committed but the machine-specific links don't exist yet.

```
awm sync [-a <agent>] [-m <method>]
```

| Flag | Description |
|---|---|
| `-a, --agent <agent>` | Target agent. |
| `-m, --method <method>` | `symlink` (default) or `copy`. |

`awm sync` also repairs the project's existing skill links before installing: a dangling
symlink whose target the registry can still serve is re-linked, and one nothing can serve
any more is pruned. Both are reported per line. Only dangling symlinks are touched — your
own files and directories, and links that still resolve, are left alone. This runs even
when the profile declares no extensions, which is precisely when orphans are left behind
by a removed one.

The whole sync is a **single transaction**: if any part of it fails, nothing is installed.
On success it prints the transaction id and the `awm backup restore` invocation that
undoes it.

### `awm update`

Pull the latest content from every configured registry (checking out the latest semver tag, or the pinned version if the project pins one). Because skills are symlinked into the registry clones by default, this instantly patches every global and local install on the machine.

| Flag | Effect |
|---|---|
| `-a, --agent <agent>` | Restrict the run to the given agent target(s), comma-separated. Defaults to every enabled agent. |
| `-y, --yes` | Non-interactive: never prompt, and take the CLI self-update below without asking. |

**Exit code and closing message are derived from what actually happened** — they never
claim work the run did not do:

| Situation | Exit | Closing line |
|---|---|---|
| Every configured registry synced | `0` | `✅ N registries, skills and hooks updated.` |
| A registry failed but its content is still on disk | `0` | `⚠ Updated with stale content — …` naming the stale registry |
| A registry failed and left no content on disk | `1` | the failing registry and its error |
| **No registries configured** on this machine | `1` | `Nothing updated — no registries configured on this machine.` (run `awm init`) |
| Any later stage failed (context, artifacts, hooks) | `1` | the failing stage |

> `awm update` updates **content** (registries). The CLI binary is a separate thing: at
> the end of the run, if a newer version is published, `awm update` offers to install it
> for you. That offer is only made when there is a human to answer — with no TTY on stdin
> (CI, cron, an agent session) it prints `npm i -g agentic-workflow-manager` and moves on
> rather than blocking on a prompt nobody can see. Pass `--yes` to take the update without
> being asked, or update by hand any time with `npm i -g agentic-workflow-manager@latest`.

### `awm export <name>`

Exports a bundle or an individual skill from the installed registry as claude.ai-uploadable
custom skill artifacts: one folder per skill (`SKILL.md` + `references/`) plus a `.zip`
when the system `zip` binary is available (folder-only fallback otherwise).

- Only skills declaring `portable: true` in their `SKILL.md` frontmatter are exported;
  bundle exports list non-portable skills as skipped, and requesting a non-portable
  skill explicitly is an error.
- If `skills/<name>/port.claude-ai.md` exists in the registry, it is used verbatim;
  otherwise a mechanical transform strips AWM-only frontmatter fields (`version`,
  `portable`), appends a deference line to the description, and rewrites
  intra-registry paths in the body (`skills/<other>/SKILL.md`,
  `skills/<other>/references/<file>.md`) into pathless prose — those paths resolve
  in Claude Code but never in claude.ai, where only the portable skill is uploaded.
  Paths embedded in a URL are left alone, since those do resolve for the reader.
- `--target <target>` (default `claude-ai`, the only target today) · `--out <dir>`
  (default `./awm-export`; artifacts are written under `<out>/<target>/`). Reads from
  the installed registry content roots.

---

## Registries & pinning (team/personal content)

Additional registries let a team or individual distribute their own skills, bundles, and packs alongside the baseline. Each registry is a git repo cloned under `~/.awm/registries/<name>/`.

### `awm registry add <remote>`

Clone an additional registry (git URL or local path) and register it in the machine config.

```
awm registry add <remote> [--name <name>] [--install-all] [--no-install]
```

| Flag | Description |
|---|---|
| `--name <name>` | Registry name (default: repo basename). |
| `--install-all` | Install every bundle from the new registry for the default agent. |
| `--no-install` | Skip the bundle install offer. |

Use an SSH remote (`git@github.com:org/repo.git`) for private registries — clone/fetch run through git, so your ssh-agent and `~/.ssh/config` apply as with any repo.

### `awm registry list`

List configured additional registries.

### `awm registry remove <name>`

Remove an additional registry (config + clone). `-y, --yes` skips confirmation.

### `awm pin <registry> <version>`

Pin a registry (`baseline` or an additional registry name) to a version tag, e.g. `awm pin baseline 1.0.0`. The pin is stored in `~/.awm/preferences.json` (machine-level, not committed) — it applies only to your local `awm update` runs. To pin for the whole team, edit `.awm/profile.json`'s `registries` map directly and commit it.

### `awm unpin <registry>`

Remove the version pin (the registry returns to the latest tag on the next `awm update`).

---

## Sensors (per-project computational checks)

Sensors are deterministic checks (tsc, ESLint, Semgrep, depcheck, …) whose output is LLM-readable. They are configured per repo in `.awm/sensors.json`.

### `awm sensors init`

Compatibility alias for creating a portable `project-sensors` declaration. It
uses the same bootstrap transaction as the explicit command; it never stores a
machine registry path in the committed manifest. Existing v2 declarations are
not overwritten by this alias: inspect them with `awm sensors bootstrap`.

```
awm sensors init [--no-configure] [--registry-root <path>] [--pack <name>]
```

### `awm sensors bootstrap`

Configure project quality exactly once, then commit `.awm/sensors.json` so the
same declaration works in Codex, Claude Code, worktrees, and fixed machines.
Machine registry installation (`awm update`) is separate and does not rewrite
the project.

```bash
awm sensors bootstrap [--mode project-sensors|native-gate|opt-out] [--reason <text>] [--dry-run]
```

`project-sensors` selects one logical registry and pack, then materializes its
declared assets atomically. `native-gate` and `opt-out` require a non-empty
reason. `--dry-run` reports the selected pack (when applicable) and exact files
that would change, and never writes. Running bootstrap again over an equivalent
v3 declaration is a no-op; migrating a v2 declaration preserves its sensor
semantics and changes only the manifest. Bootstrap is a one-time project action:
entering Codex, Claude Code, a worktree, or a fixed machine must not rerun it;
each environment updates its own AWM installation separately.

| Flag | Description |
|---|---|
| `--no-configure` | Write the manifest only; do not copy pack config files. |
| `--registry-root <path>` | Override the AWM registry root (defaults to the cache). |
| `--pack <name>` | Explicitly select a pack when stack detection is not the intended contract. |

New bootstrap declarations use `schemaVersion: 3` and retain the selected
variant, structured command, contained assets, logical registry provenance, and
initialization compatibility evidence without persisting a machine path. Legacy
and v2 manifests remain readable. A v2 migration preserves equivalent semantics;
a legacy replacement cannot prove custom command equivalence and therefore
requires the explicit `--mode project-sensors` selection. Use `--dry-run` first,
then rerun with that mode only after reviewing the replacement.

```json
{
  "schemaVersion": 3,
  "mode": "native-gate",
  "reason": "the project uses its platform-native verification gate"
}
```

### `awm sensors coverage`

Compare configured sensors with the static coverage reference owned by the selected sensor-pack. This diagnostic is read-only: it does not run sensors, install tools, edit `.awm/sensors.json`, or apply a remedy.

```
awm sensors coverage [--json] [--min <count>]
```

Human output is the default. `--json` emits the versioned `schemaVersion: 2`
envelope. Its `static` section reports declared coverage and its `empirical`
section reports bounded, sanitized ledger clustering. `--min <count>` is a
positive safe integer (default `2`) that controls the recurrence emphasis; it
does not execute sensors or modify the ledger. Human output shows class
descriptions, compatibility states, and pack-provided remedies. It prints safe,
sanitized evidence references and safe cluster signatures, and never ledger
descriptions, raw ledger lines, or unsafe values. It does not expose selected
sensor commands, marker values, or inspected file content.

Coverage gaps, unverifiable custom configuration, a missing `.awm/sensors.json`, and packs without a coverage reference are informative and exit `0`. A missing manifest returns `inconclusive/not_configured` and recommends `awm sensors init`; a legacy pack returns the distinct `inconclusive/no_reference` state and is never reported as covered. Malformed or unreadable manifests, packs, and coverage contracts exit non-zero with an actionable error.

Coverage inspection is portable across native Windows, macOS, and Linux. It opens regular authority files with `O_NOFOLLOW` where Node exposes it; when that primitive is unavailable, it compares the exact `bigint` device/inode identity, regular-file type, and bounded size before reading. A link, replacement, unobservable identity, or size race still fails closed with an actionable non-zero error.

### `awm sensors run`

Run the sensors in the manifest. With no flag, runs **all** sensors (the completion gate). The speed flags scope the run:

```
awm sensors run [--fast | --slow | --all] [--changed] [--base <ref>] [--json]
```

| Flag | Description |
|---|---|
| `--fast` | Fast sensors only (tsc, lint) — what the per-edit hook runs. |
| `--slow` | Slow sensors only (semgrep, mutation). |
| `--all` | All sensors regardless of speed. |
| `--json` | Machine-readable output. |

> The completion gate is the **full** run (no flag). Do not use `--slow` as the gate — it skips lint/typecheck, where most new findings surface.

`awm sensors run` only ever **reads** your project. It runs the manifest exactly as committed: it does not rewrite `.awm/sensors.json`, does not copy pack config files into the tree, and does not install anything. When the manifest's pack no longer matches the tree (a `generic` manifest over a real stack), the output carries a `packDrift` field naming the detected pack and the command that adopts it — `awm sensors init`.

Each prepared sensor includes additive `execution` evidence in JSON:
`execution.timeoutMs`, `timeoutSource`, and `elapsedMs`, plus
`requestedScope`, `effectiveScope`, and (when applicable) `files` or
`scopeReason`. A timeout is always finite. Its precedence is `project` →
`pack` → `fallback`: 10,000 ms for a fast sensor and 120,000 ms otherwise.
`--changed` uses a structured `changedCommand` only where the pack opts in;
changed filenames are literal argv values, never shell text. An unsupported
sensor or a Git-resolution error falls back to full scope with `scopeReason`.
Zero applicable changed files yields a scoped pass for that sensor; other full
sensors still execute.

| Overall verdict | Process exit |
| --- | --- |
| `pass` | `0` |
| `fail` | `1` |
| `not_certified` | `1` |
| `skipped` | `1` |

The JSON is written before the process exit is set, so non-pass automation can
still parse the evidence. A baseline can only suppress findings from a sensor
that produced its own verdict; it never certifies an incomplete execution.

### `awm sensors status`

Report static readiness: `READY`, `DEGRADED` (a declared prerequisite is
missing), or `NOT_CONFIGURED`. `READY` is not a health or certification claim:
`status` never dispatches a project sensor. Use `awm sensors run` for an
empirical verdict, or `awm preflight --verify-sensors` for the full read-only
handoff gate.

### `awm sensors baseline`

Snapshot current findings as an accepted baseline (`.awm/sensors.baseline.json`) so sensors fail only on **new** findings. Commit the file to share the ratchet. Use on legacy repos with large pre-existing debt; skip on greenfield.

### `awm sensors install`

Install the **`PostToolUse`** hook in `~/.claude/settings.json` so fast sensors run automatically after each file edit. This installs **only the per-edit *trigger*, not the sensors** — the checks and the completion gate are identical on every agent. **Claude Code only:** OpenCode has no hooks, so it has nothing to install here; it runs the same sensors at the completion gate (`awm sensors run`, via `verification-before-completion`). The difference is *cadence* (Claude gets an extra early loop), not *coverage*.

---

## Hooks (`SessionStart` for Claude Code and Codex)

Manage the bootstrap hook that re-anchors `using-awm` + `CONSTITUTION.md` at
session start for `claude-code` and `codex`. `awm init` installs the hook for
the selected provider; these subcommands are for manual repair or inspection.

```
awm hooks install   [-t <target> | -a <agent>] [-y]
awm hooks uninstall [-t <target> | -a <agent>] [-y]
awm hooks status    [-t <target> | -a <agent>]
```

| Flag | Description |
|---|---|
| `-t, --target <target>` | Target harness: `claude-code` or `codex`; defaults to `claude-code`. |
| `-a, --agent <agent>` | `--agent` is an alias for `--target`. |
| `-y, --yes` | Skip interactive confirmations (install/uninstall). |

`status` reports the target-specific checks and an overall state. Claude Code
includes its bootstrap skill and run-hook wrapper; Codex may additionally
report whether the hook is trusted. Use `awm hooks status --agent codex` when
inspecting Codex explicitly.

---

## Ledger (the learning loop)

A persistent, per-branch findings ledger — ephemeral working memory for `harness-retro`. Stored at `.awm/ledger/<branch>.jsonl`, gitignored, and **never injected into agent context**. Skills append to it during development; you rarely call `add` by hand. All subcommands accept `--branch <branch>` to override the auto-detected git branch.

### `awm ledger add`

Append one finding or win to the current branch's ledger.

```
awm ledger add --polarity <p> --class <c> --signature <slug> --severity <s> --desc <text>
               [--ref <ref>] [--phase <phase>] [--source-skill <skill>] [--defect-class <id>] [--branch <branch>]
```

| Flag | Required | Description |
|---|---|---|
| `--polarity <p>` | yes | `win` or `finding`. |
| `--class <c>` | yes | `structural`, `logica`, `proceso`, or `seguridad`. |
| `--signature <slug>` | yes | Stable dedup key — recurring issues group by this. |
| `--severity <s>` | yes | `blocker`, `important`, `minor`, or `info`. |
| `--desc <text>` | yes | One-line description. |
| `--ref <ref>` | no | `file:line` or PR/commit reference. |
| `--phase <phase>` | no | Lifecycle phase (default `unknown`). |
| `--source-skill <skill>` | no | Emitting skill (default `unknown`). |
| `--defect-class <id>` | no | Reusable lowercase kebab-case class for empirical coverage; invalid values fail before ledger I/O. |

> Capture is best-effort: skill prose tells agents to skip silently if `awm` isn't on `PATH`.

### `awm ledger list`

Print the current branch's ledger as JSON.

### `awm ledger recurring`

Print recurrence clusters whose count meets a threshold (the recurrence signal `harness-retro` reads).

```
awm ledger recurring [--min <n>]    # default --min 2
```

Clustering uses three signals, in order of confidence: identical `signature`, then a shared
source file in `ref` plus at least one word in common, then strong word overlap alone. Each
cluster carries a `kind`:

| `kind` | Meaning |
|---|---|
| `exact` | One distinct signature — the same emitter recurring across tasks. |
| `convergent` | Two or more distinct signatures — independent reviewers landing on one defect, the stronger signal of a systemic problem. |

Convergent clusters also list every distinct signature in `signatures`; `signature` itself is the
most frequent one in the cluster. A `ref` that is not a file locus (e.g. `PR #16`) contributes no
clustering signal, and a win is never merged with a finding on the strength of a shared file.

### `awm ledger archive`

Rotate the current branch's ledger out of the active flow (into `.awm/ledger/archive/`). `harness-retro` calls this when it closes a branch.

---

## Durable execution (journal, supervisor, parallel tracks)

The three commands below are one mechanism seen from three angles. `awm job` is the
**journal**: the durable record of what work was requested and what came back. `awm watch`
is the **supervisor**: the process that actually runs that work and relieves controllers
that died. `awm track` coordinates **parallel tracks** over worktrees.

The division of labour is deliberate and load-bearing: `job` and `track` are almost
entirely **request-only and read-only** surfaces. They record intent; the supervisor is
what mutates state. That is what lets a controller die mid-flight without losing work or
duplicating it.

### `awm job`

The durable work journal of the SDD cycle. Subcommands split into requests, reads, and
gates:

| Subcommand | Description |
|---|---|
| `request <cmd...>` | Record the *intent* to run a verification. The supervisor executes it — this does not. |
| `register` | Record a cycle entity (`task`, `cycle-plan`, `dispatch`, `task-status`, `next-action`, `custody-decision`) **before** acting on it. |
| `verdict` | Record a ReviewObligation verdict at the moment it is received. |
| `list` / `ps` / `show <jobId>` | Read the journal: declared jobs, live processes, one job in full. |
| `reconcile` | Read-only report of the R1.8 matrix plus `next_action`. The mutation belongs to the supervisor. |
| `ack <requestId>` | Read-only exact-ID request acknowledgement. Wait for `applied` before an action that depends on the request. |
| `gate` | Fail-closed interlock: exits non-zero if **anything** blocks certification. Unattended only — see below. |
| `reap` | List job processes with full identity. `--execute --jobs <ids...>` terminates them, with confirmation. |
| `export` | Export the journal. |
| `controller-heartbeat` | Emit the controller liveness signal the supervisor watches. |

> `gate` is the one to reach for in automation: it is the interlock that refuses to
> certify, not a report you have to interpret.

**`gate` is the unattended interlock, and it needs a journal.** A journal binding is
unattended by construction — `awm watch --init --plan` accepts only a compact plan whose
execution mode is `desatendido` — so an interactive cycle has no journal, and `gate` has
nothing to certify against. On a repository with no journal it reports
`category: "absent"` and exits non-zero, naming `awm watch --init --plan` as the remedy.
That is absence, not damage: a genuinely unreadable `state.json` reports
`category: "corrupt"` instead, and the two want different responses.

Do not wire `gate` into CI for an interactive project — it will be permanently red for a
reason that has nothing to do with the code. The gate for an interactive cycle is
`awm plan admit`, which reports `journal: "not-required"` for a plan whose execution mode
is `interactivo` and blocks on the gates that do apply (state, currentness, sensors).

### `awm watch`

The durable supervisor. It executes requested jobs, relieves controllers whose heartbeat
went silent, and **never kills live work**.

```
awm watch [--init] [--provider <p>] [--heartbeat-timeout <min>]
          [--activity-window <min>] [--max-parallel <n>]
```

| Flag | Description |
|---|---|
| `--init` | Bootstrap: create the current branch's journal, detect verifiers, and exit. Requires `--plan` with a valid **unattended** compact plan; an interactive plan is refused, because a journal binding records `executionMode: desatendido` by construction. |
| `--provider <p>` | `codex` or `claude-code`. Default: `codex`. |
| `--heartbeat-timeout <min>` | Minutes of heartbeat silence before a controller is considered gone. Default: `5`. |
| `--activity-window <min>` | Extra minutes without process activity before relieving it. Default: `10`. |
| `--max-parallel <n>` | Cap of simultaneously ACTIVE tracks. Default: derived from the bundled benchmark. |

The two timeouts are separate on purpose: a silent heartbeat is not the same as a dead
process. A controller can stop reporting while its work is still advancing, and the
activity window is what keeps that work from being reclaimed out from under it.
Full compact admission runs before an initial or replacement controller generation.
During an already-admitted generation, ordinary RED edits do not rerun the sensor
pre-dispatch gate on every tick; plan binding and runtime identity remain checked,
and verification jobs still determine whether the cycle can finish. A received
job waits while a local controller launch lacks an adopted process identity.
Stopping `watch` with Ctrl-C reports the journal's actual cycle state and exits
with code 130; it does not certify `COMPLETE`.

### `awm track`

Parallel tracks over worktrees: a request-only surface plus a read-only aggregate status.

| Subcommand | Description |
|---|---|
| `add <trackId>` | Emit a track-prepare request. The plan supervisor consumes it. |
| `join <trackId>` | Emit a track-join request. Integration is owned exclusively by the plan supervisor. |
| `finalize` | Emit a track-finalize request: the plan controller's global QA self-report over the already-merged HEAD. |
| `list` | List the `TrackRef`s declared in the plan journal (read-only). |
| `status` | Read-only aggregate: each track's gate plus the cohort phase. |
| `verify-independence` | Verify a track plan's declared independence. Exits non-zero on any violation, so it is usable as a gate. |
| `remove <trackId>` | Emit a teardown request. The supervisor cancels the complete cohort, removes only demonstrably owned resources, and returns to serial execution only after teardown finishes. |
| `supervisor-wrapper` | **Internal process**, launched detached by the plan supervisor. Not for manual invocation. |

> `add`, `join` and `finalize` only *request*. Nothing integrates because you ran them —
> the plan supervisor decides, which is what keeps two tracks from merging into each other
> at the same time.

---

## Misc

### `awm miro`

Miro board integration. (See `awm miro --help`.)

### `awm --help` / `awm --version`

Standard Commander help and version output. Every command and subcommand accepts `--help`.

---

## See also

- [AWM Runbook](runbook.md) — the complete operating manual (install → team setup → authoring).
- [Architecture & Design](architecture.md) — how AWM routes artifacts between the registry and your install.
