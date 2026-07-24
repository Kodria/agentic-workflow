# Diseño — Paridad completa de AWM para Codex

- **Fecha:** 2026-07-24
- **Estado:** Aprobado
- **Rama:** `codex/codex-full-parity-design`
- **Repositorios afectados:** `agentic-workflow`, `awm-baseline-registry`
- **Superficies objetivo:** Codex App, CLI, IDE, cloud y revisión de PRs en GitHub
- **Versión mínima inicial de Codex:** `0.145.0` (versión estable publicada al 2026-07-24)

## Requirements

- **R1 — Provider Codex:** WHEN `awm init --agent codex` runs with a supported Codex version, THE AWM CLI SHALL register Codex as enabled and install the `dev` bundle in Codex-native locations.
- **R2 — Version gate:** IF Codex is missing, its version output is invalid, or its version is lower than `0.145.0`, THEN THE AWM CLI SHALL stop Codex activation before mutating preferences or provider files and report an actionable error.
- **R3 — Automatic activation:** WHEN Codex starts, resumes, clears, or compacts a session after AWM initialization, THE Codex integration SHALL load `using-awm` automatically.
- **R3.1 — Dynamic recovery:** WHEN Codex starts, resumes, clears, or compacts a session after AWM initialization, THE Codex integration SHALL recover the active plan and ledger state.
- **R4 — Managed global guidance:** WHEN AWM manages `~/.codex/AGENTS.md`, THE Codex integration SHALL add or replace exactly one delimited AWM block while preserving all user-owned content.
- **R5 — Managed project guidance:** WHEN AWM initializes an AWM project for Codex, THE Codex integration SHALL add or replace exactly one delimited AWM block in the project `AGENTS.md` while preserving all user-owned content.
- **R6 — Constitution delivery:** WHEN a project contains `CONSTITUTION.md`, THE Codex integration SHALL make its rules available to Codex local sessions, cloud tasks, and GitHub reviews.
- **R7 — Skill locations:** THE Codex provider SHALL install global skills in `~/.agents/skills` and project skills in `.agents/skills`.
- **R8 — Native custom agents:** WHEN a bundle contains a canonical agent artifact supported by Codex, THE Codex provider SHALL render valid TOML under `~/.codex/agents` or `.codex/agents`, according to scope.
- **R9 — Canonical content:** THE AWM registries SHALL maintain one canonical skill body per skill and SHALL NOT maintain provider-specific forks of those skill bodies.
- **R10 — Enabled-agent migration:** WHEN preferences contain `defaultAgent` but not `enabledAgents`, THE AWM CLI SHALL atomically migrate them to `enabledAgents: [defaultAgent]` without losing any other preference.
- **R11 — Coexistence:** WHEN `awm init --agent <agent>` enables another provider, THE AWM CLI SHALL add it to `enabledAgents` without disabling, uninstalling, or rewriting the other enabled providers.
- **R12 — Default command target:** WHEN `awm update`, `awm sync`, `awm doctor`, `awm add`, or `awm remove` runs without `--agent`, THE AWM CLI SHALL target all enabled agents.
- **R13 — Explicit command target:** WHEN a command receives `--agent`, THE AWM CLI SHALL target only the selected agents for independently addressable artifacts.
- **R14 — Shared-target conflict:** IF an explicit agent filter would create different desired skill sets for enabled providers that share the same physical skill directory, THEN THE AWM CLI SHALL abort before writing and instruct the user to select the complete shared-target group.
- **R15 — Shared-target deduplication:** WHEN multiple selected providers resolve an artifact to the same physical target with the same renderer, THE AWM CLI SHALL perform one physical operation.
- **R15.1 — Shared-target reporting:** WHEN one physical operation represents multiple provider owners, THE AWM CLI SHALL report its result for every owning provider.
- **R16 — Shared-target removal:** WHEN an artifact in a shared target still has an enabled provider owner, THE AWM CLI SHALL retain the artifact.
- **R17 — Safe config mutation:** IF an AWM-managed block or Codex JSON/TOML configuration is malformed, duplicated, or ambiguous, THEN THE AWM CLI SHALL abort that mutation without overwriting the file.
- **R18 — Hook trust:** WHEN the Codex hook is installed but has not executed, THE AWM diagnostics SHALL report `pending-trust` rather than `healthy`.
- **R19 — Claude Code compatibility:** WHILE Codex is enabled, THE AWM CLI SHALL preserve the existing Claude Code hook behavior.
- **R19.1 — OpenCode compatibility:** WHILE Codex is enabled, THE AWM CLI SHALL preserve the existing OpenCode `instructions[]` behavior.
- **R20 — Legacy single-agent behavior:** WHILE exactly one provider is enabled, THE AWM CLI SHALL preserve the existing unqualified command experience for that provider.
- **R21 — Public cloud bootstrap:** WHEN the documented Codex cloud setup runs, THE setup SHALL use public registries only.
- **R21.1 — Clean cloud checkout:** WHEN the documented Codex cloud setup runs against an AWM-initialized repository, THE setup SHALL leave versioned project guidance unchanged.
- **R21.2 — Cloud reconstruction:** WHEN the documented Codex cloud setup runs against an AWM-initialized repository, THE setup SHALL reconstruct the Codex machine and generated project artifacts.
- **R22 — GitHub guidance:** WHEN `@codex review` runs on a configured repository, THE review SHALL receive the applicable repository `AGENTS.md` rules.
- **R23 — Isolated verification:** THE implementation SHALL run automated and initial local end-to-end tests with isolated home and workspace directories and SHALL NOT use the operator's live `~/.awm` or `~/.claude`.
- **R24 — Live-install baseline:** BEFORE the first activation against the operator's live home, THE implementation SHALL capture a read-only Claude Code baseline.
- **R24.1 — Live-install backup:** BEFORE the first activation against the operator's live home, THE implementation SHALL back up every existing file that the migration could modify.
- **R25 — Live-install rollback:** IF live Codex activation degrades the recorded Claude Code baseline, THEN THE implementation SHALL restore the affected files and SHALL NOT declare Codex integration complete.
- **R26 — End-to-end evidence:** THE integration SHALL be verified with automated tests, a real local Codex session, a real Codex cloud task, and a real GitHub review initiated with `@codex review`.

## 1. Context and purpose

AWM currently supports Claude Code, OpenCode, and Antigravity through a provider table that defines artifact paths and, for Claude Code and OpenCode, context-injection strategies. Codex was intentionally deferred in WS-6 until a real user demand appeared. That demand now exists: the operator uses AWM's `development-process` as the default software-delivery lifecycle and needs the same behavior in Codex.

The requested result is behavioral parity, not identical implementation:

- the `dev` harness is installed and activated automatically;
- all enabled agents coexist on one machine;
- skills and orchestrators remain one canonical body;
- AWM state survives session starts and context compaction;
- project guidance applies locally, in Codex cloud, and in GitHub reviews;
- the existing Claude Code installation is protected as a non-negotiable constraint.

The existing `cli/src/providers/index.ts` already separates much of the "where" from the installation engine. The existing context layer already separates a canonical `ContextProvider` from the Claude hook and OpenCode static-instruction strategies. This design extends those boundaries instead of adding Codex conditionals throughout command handlers.

## 2. Confirmed Codex platform contract

The design relies on the current stable Codex contract:

| Capability | Codex contract used by AWM |
|---|---|
| Global skills | `~/.agents/skills/<skill>/SKILL.md` |
| Project skills | `.agents/skills/<skill>/SKILL.md`, discovered from the working directory to the repository root |
| Symlinks | Supported for skill directories |
| Global guidance | `~/.codex/AGENTS.md` |
| Project guidance | Root-to-CWD `AGENTS.md` / `AGENTS.override.md` chain |
| Custom agents | `~/.codex/agents/*.toml` and `.codex/agents/*.toml` |
| Agent fields | `name`, `description`, `developer_instructions` |
| Multi-agent | Enabled by default in current Codex releases |
| Hooks | `hooks.json` or inline `config.toml`; includes `SessionStart` and compaction events |
| SessionStart matchers | `startup`, `resume`, `clear`, `compact` |
| Cloud lifecycle | checkout → setup script with network → agent phase |
| GitHub review guidance | Applicable repository `AGENTS.md` |

Codex custom prompts are deprecated in favor of skills. Therefore the current `development-process` workflow artifact is not copied as a Codex custom prompt: its capability is fulfilled by the canonical `development-process` skill plus the native Codex custom agent.

## 3. Architectural approach

### 3.1 Selected option

Use a native Codex provider with canonical content and capability-specific adapters.

Rejected alternatives:

1. **Install-time textual translation:** would require derived copies, break the symlink-first model, and make natural-language transformations difficult to validate.
2. **Codex-specific registry fork or mandatory plugin:** would create another source of truth and release channel and would not replace AWM project profiles, sensors, or cross-provider management.

### 3.2 Boundaries

> Canonical artifacts describe intent. Provider adapters decide how that intent is materialized. Command handlers operate on desired state, not provider-specific paths.

| Component | Responsibility | Must not do |
|---|---|---|
| `ProviderConfig` | Declare paths, capabilities, version probe, renderer, injection, and hook strategies | Compute bundle or profile desired state |
| `AgentRegistry` | Read, migrate, and persist enabled/default agents | Install artifacts |
| `InstallPlanner` | Build a multi-provider desired-state plan and group shared physical targets | Write files while planning |
| `ArtifactRenderer` | Materialize a canonical artifact in a provider-native representation | Choose which agents receive it |
| `InjectionStrategy` | Merge or remove provider-native context references and managed blocks | Compute canonical AWM content |
| `Diagnostics` | Compare expected and observed provider state | Repair state implicitly |

The existing `ContextProvider` remains the only component that computes canonical AWM bootstrap content.

## 4. Provider and capability model

### 4.1 Codex provider

The provider declares:

- label: `Codex`;
- version command: `codex --version`;
- minimum supported stable version: `0.145.0`;
- global skill root: `~/.agents/skills`;
- local skill root: `.agents/skills`;
- global agent root: `~/.codex/agents`;
- local agent root: `.codex/agents`;
- global guidance: managed block in `~/.codex/AGENTS.md`;
- project guidance: managed block in `<project>/AGENTS.md`;
- hook configuration: managed AWM entry in `~/.codex/hooks.json`;
- hook scripts: provider-specific scripts under `~/.awm/hooks`;
- workflow behavior: native alias to the corresponding canonical skill/agent when declared by the bundle.

Unsupported artifacts fail loudly. A provider capability may declare an explicit native alias, but may not silently skip an artifact.

### 4.2 Shared skill domains

OpenCode and Codex use the same global and local skill roots. They therefore form a shared physical skill domain:

- a shared skill link is created once;
- reconciliation scans the directory once;
- results are attributed to both providers;
- removing one logical owner does not remove a link retained by another owner;
- a targeted operation that would make the providers see different skill sets fails during planning.

The last rule is required because physical isolation is impossible when both products discover the same directory. AWM will not pretend that a provider-specific operation succeeded when the other provider necessarily observes the same change.

### 4.3 Native custom-agent rendering

Registry agent artifacts remain canonical Markdown documents with validated frontmatter and instructions. The Codex renderer maps:

| Canonical field | Codex TOML |
|---|---|
| `name` | `name` |
| `description` | `description` |
| instruction body | `developer_instructions` multiline string |

Provider-only fields such as Claude's `mode` are validated but not emitted for Codex. Unknown required fields, invalid names, empty descriptions, and empty instruction bodies fail before any output is written.

The renderer writes atomically and produces deterministic TOML so repeated syncs are no-ops.

## 5. Enabled-agent state and command semantics

Preferences evolve compatibly:

```json
{
  "defaultAgent": "claude-code",
  "enabledAgents": ["claude-code", "opencode", "codex"],
  "installMethod": "symlink",
  "defaultScope": "local"
}
```

`defaultAgent` remains for interactive initial selection and backward compatibility. `enabledAgents` determines the default target set of lifecycle and artifact commands.

### 5.1 Migration

- no preferences file: create the existing defaults with `enabledAgents: ["claude-code"]`;
- legacy preferences: preserve every field and add `enabledAgents: [defaultAgent]`;
- existing `enabledAgents`: validate every entry, remove exact duplicates while preserving order, and require `defaultAgent` to be a member;
- malformed preferences: fail loudly; do not replace them with defaults;
- write the migrated document atomically.

### 5.2 Enabling and disabling

- `awm init --agent codex` adds Codex and initializes only Codex because the explicit filter is authoritative;
- `awm agent list` displays supported, enabled, and default state;
- `awm agent disable <agent>` removes management state but does not delete provider files;
- disabling the default agent requires selecting another default in the same operation or fails with guidance;
- file deletion remains an explicit `remove`/uninstall concern.

### 5.3 Command target resolution

| Invocation | Target set |
|---|---|
| no `--agent` | all `enabledAgents` |
| `--agent a,b` | validated explicit subset |
| explicit disabled provider | fail and suggest `awm init --agent <provider>` |
| explicit shared-domain divergence | fail before writes and name the required group |

This resolver is shared by `add`, `remove`, `update`, `sync`, and `doctor`; command handlers do not reimplement provider selection.

## 6. Installation and update flow

### 6.1 Local Codex activation

1. Parse and validate the requested agent.
2. Run the Codex version gate before early exits or mutations.
3. Read and validate current preferences.
4. Build the preference migration and provider-install plan without writing.
5. Back up every existing file that the plan will modify.
6. Persist preferences atomically.
7. Install the baseline `dev` bundle for Codex.
8. Render the `development-process` Codex agent.
9. Merge global Codex guidance and hook configuration.
10. When inside a repository, run the existing profile, activation, sensor, constitution, and context steps with the Codex adapter.
11. Re-gather diagnostics and report applied, pending, and failed states.

`awm init --agent codex` does not reconcile or prune Claude Code destinations.

### 6.2 Multi-agent add/remove

The install planner expands bundles and dependency closure once, then produces logical ownership edges:

```text
bundle → artifact → provider → target + renderer
```

It groups identical `target + renderer + source` operations into one physical write. Removal computes the remaining desired owners before unlinking anything.

Planning completes for the whole command before the first filesystem mutation. A collision, invalid renderer input, shared-domain divergence, or provider capability error prevents all planned writes.

### 6.3 Update and sync

`awm update`:

1. updates each registry once;
2. validates registry gates before command early exits;
3. rebuilds canonical context once;
4. refreshes installed provider context and hook scripts;
5. reconciles each unique physical skill domain once;
6. reports results per enabled provider.

`awm sync`:

1. reads the project profile and registry manifests once per root;
2. resolves all enabled or explicitly selected agents;
3. builds one multi-provider desired-state plan;
4. applies deduplicated physical operations;
5. verifies the resulting provider states.

## 7. Codex context delivery

### 7.1 Global managed block

AWM manages one delimited block in `~/.codex/AGENTS.md` containing the canonical `using-awm` bootstrap and provider capability guidance. It never owns the full file.

Merge rules:

- no markers: append one block with surrounding blank lines;
- one valid marker pair: replace only the block;
- unmatched, nested, or duplicate markers: abort;
- empty user-owned prefix/suffix: preserve it as-is;
- repeated execution with unchanged content: no write.

### 7.2 Project managed block

The project `AGENTS.md` block:

- declares the project as AWM-managed;
- instructs Codex to read and obey `CONSTITUTION.md` before work when present;
- points to durable project context and supported verification commands;
- carries `## Code Review Rules` only when generated by the project-context workflow or explicitly authored for the repository;
- remains small so it does not consume the default combined `AGENTS.md` byte budget unnecessarily.

Project guidance is versioned. Generated skill links and machine-specific paths remain ignored.

### 7.3 Session and compaction hook

AWM installs a Codex `SessionStart` command hook matching:

```text
startup|resume|clear|compact
```

The hook:

- reads hook input defensively;
- resolves the session working directory;
- loads the project constitution when present;
- identifies the most recent incomplete implementation plan deterministically;
- includes the plan goal, up to eight open plan items, and up to eight open ledger items;
- writes a heartbeat containing hook version/hash and last successful event;
- emits Codex-native hook JSON;
- degrades safely when optional files or the `awm` executable are absent.

The global `AGENTS.md` block provides automatic AWM activation even while the hook awaits trust. The hook is required for dynamic re-anchoring and is not considered healthy until its heartbeat proves execution.

### 7.4 Hook trust

AWM does not bypass Codex hook trust:

- `init` reports the installed hook and the review action;
- `doctor` reports `pending-trust` when configuration exists but no current heartbeat is present;
- a stale hook hash or script produces `stale`;
- a successful current heartbeat produces `healthy`;
- cloud E2E determines whether the configured environment treats the hook as managed; otherwise the runbook records the required trust step.

## 8. Canonical skill portability

The baseline registry remains the source of truth for 31 skills. Portability work changes vocabulary and capability references, not lifecycle decisions.

The audit covers:

- obsolete `Task`, `TodoWrite`, `Read`, `Write`, `Edit`, and `Skill` tool instructions;
- obsolete Codex `[features].multi_agent`, `wait_agent`, and `close_agent` assumptions;
- provider-specific filesystem paths embedded in runtime instructions;
- Claude-specific subagent lifecycle assumptions;
- provider-specific UI/browser instructions;
- reference documents whose historical content is intentionally provider-specific.

Runtime skills express platform-neutral operations such as:

- invoke a named skill;
- create or update a task plan;
- dispatch, steer, wait for, or stop a subagent;
- read, edit, or inspect a file;
- run a shell command;
- request user approval.

`using-awm` supplies the capability contract and tells the active agent to use its native tools. Provider reference documents may describe exact mappings but cannot override the current platform's callable tool surface.

The existing `development-process` lifecycle remains unchanged:

```text
brainstorming → writing-plans → execution → post-implementation-qa
→ harness-retro → finishing-a-development-branch
```

Codex custom agents and subagents inherit the AWM subagent policy: a dispatched worker skips orchestration/product layers but still invokes task-specific craft and verification skills.

## 9. Cloud and GitHub flow

### 9.1 Repository preparation

Run project initialization locally once and commit the durable project artifacts:

- `.awm/profile.json`;
- `AGENTS.md`;
- `CONSTITUTION.md`;
- sensor configuration;
- other project context explicitly produced by AWM workflows.

Do not commit generated global artifacts, machine-specific paths, or registry clones.

### 9.2 Codex cloud setup

The documented public-registry setup is:

```bash
#!/usr/bin/env bash
set -euo pipefail
export GIT_TERMINAL_PROMPT=0

npm i -g agentic-workflow-manager
awm init --agent codex --yes --machine-only
awm update

BUNDLES=(frontend authoring)
for bundle in "${BUNDLES[@]}"; do
  awm add "$bundle" -t skill -s global --yes --all
done

awm sync --agent codex
awm doctor --agent codex
```

`dev` is installed by `awm init`; `frontend` and `authoring` are the other bundles in the public baseline catalog at design time. The private `awm-personal-registry` and `AWM_GIT_TOKEN` are explicitly excluded.

`--machine-only` prevents setup from creating or modifying durable tracked guidance. `awm sync` reconstructs project-scoped generated artifacts from the committed profile.

### 9.3 GitHub

Codex GitHub review uses the committed `AGENTS.md` chain. A representative PR must verify:

- `@codex review` reacts and posts a review;
- repository-specific review rules are applied;
- a non-review `@codex` task receives the same project guidance;
- no AWM setup artifact appears in the PR diff unless the task explicitly changes AWM configuration.

## 10. Robustness and failure behavior

### 10.1 Atomic writes and rollback

For every multi-file operation:

1. validate inputs and capability gates;
2. parse every existing target;
3. construct the complete mutation plan;
4. create timestamped backups under the AWM home for existing files in scope;
5. write temporary files in the destination filesystem;
6. atomically replace targets;
7. verify observed state;
8. on failure, restore already-replaced local files best-effort and rethrow the original error.

Backups contain only files being modified. Tokens, credential helper output, and environment secrets are never copied into logs or evidence.

### 10.2 Provider isolation

- Codex activation may update shared OpenCode/Codex skill links only when the desired shared state is identical.
- It may not write under `~/.claude` or alter Claude hook settings.
- A provider failure is reported per provider and cannot be summarized as global success.
- Diagnostics never repair state implicitly.

### 10.3 External commands

All version probes and external commands use `execFileSync(command, args)` or an injected equivalent. Inputs are validated before execution. Missing binaries, non-zero exit codes, timeouts, and invalid output have distinct actionable errors.

## 11. Protection of the existing live installation

The operator already has a working AWM + Claude Code setup. Protecting it is a release gate.

1. Automated tests use separate `tmpHome` and `tmpWork` directories.
2. The first local E2E also uses an isolated home and AWM home.
3. Before live activation, collect a read-only inventory:
   - AWM preferences and registries;
   - Claude Code skills and hook state;
   - current `awm doctor --agent claude-code` output;
   - file hashes for every existing file the migration plan could touch.
4. Present the preflight and obtain explicit user approval.
5. Back up the exact live files in scope.
6. Run only `awm init --agent codex`.
7. Re-run the Claude Code diagnostic and compare it with the baseline.
8. If Claude Code regresses, restore affected files and stop.

No test, migration, or E2E may delete registry clones, Claude skills, user-authored guidance, or unrelated working-tree changes.

## 12. Diagnostics

`awm doctor` reports a machine/project matrix per enabled provider:

| Check | Representative states |
|---|---|
| binary/version | `supported`, `missing`, `unsupported` |
| global skills | `healthy`, `missing`, `broken`, `shared` |
| custom agents | `healthy`, `missing`, `stale`, `unsupported` |
| context | `healthy`, `absent`, `stale` |
| hook config | `healthy`, `absent`, `stale`, `pending-trust` |
| project guidance | `healthy`, `absent`, `conflict` |
| constitution | `delivered`, `absent`, `pending` |

Human output groups by provider and shows shared operations once with all owners. JSON output exposes stable provider IDs, target paths, states, and remediation codes.

## 13. Testing strategy

### 13.1 CLI unit and integration tests

- preferences migration and validation;
- enabled-agent target resolution;
- exact explicit filters;
- shared-domain conflict detection;
- shared-target deduplication and owner-aware removal;
- call-time home/path resolution;
- Codex version probe cases;
- canonical-agent validation and deterministic TOML rendering;
- global/project managed-block merge cases;
- Codex hook JSON merge and preservation of user hooks;
- hook heartbeat states;
- init/update/sync/add/remove call order;
- per-provider diagnostic aggregation;
- Claude Code and OpenCode characterization tests.

Command tests use dual temporary directories and late/call-time environment resolution. Tests that assert orchestration order compare call indices, not only call existence.

### 13.2 Baseline registry tests

- all runtime skills satisfy structural metadata rules;
- prohibited obsolete tool vocabulary is absent from runtime instructions or explicitly allowlisted in historical/reference material;
- `development-process` canonical agent data renders to valid Codex TOML;
- the lifecycle and approval gates remain unchanged;
- Codex subagent instructions respect the AWM controller/worker boundary.

### 13.3 Real E2E

1. **Isolated local:** install Claude Code, OpenCode, and Codex in a temporary home; verify shared links and provider isolation.
2. **Real local Codex:** verify automatic `using-awm`, the custom agent, a subagent workflow, hook heartbeat, and re-anchor after `/compact`.
3. **Codex cloud:** use the public bootstrap and execute a small representative `development-process` case.
4. **GitHub:** open a representative test PR, invoke `@codex review`, and verify repository rules.
5. **Live coexistence:** after explicit approval, enable Codex in the operator's real home and prove the Claude Code baseline is unchanged.

Evidence is stored as a dated runbook without secrets or sensitive transcripts. User-assisted steps are allowed but must be executed before QA closes.

## 14. Delivery sequence

1. **CLI foundation:** enabled-agent state, migration, target resolver, desired-state planner, and shared domains.
2. **Codex adapter:** paths, version gate, agent renderer, managed blocks, hook strategy, and diagnostics.
3. **Baseline portability:** canonical agent contract, 31-skill audit, and current Codex reference.
4. **Isolated E2E:** automated suite and temporary-home local verification.
5. **Controlled live verification:** preflight, approval, Codex activation, and Claude baseline comparison.
6. **Cloud/GitHub verification:** public setup, cloud task, and test PR.
7. **QA and release:** QA and retro in both repositories, followed by coordinated releases.

The CLI release remains automatic on pushes to `main` through the existing release workflow. No manual `npm publish` step is introduced. The baseline registry raises `minCliVersion` to the released CLI version that implements this contract before publishing Codex-dependent content.

## 15. Scope

### Included

- Codex App, CLI, IDE, cloud, and GitHub review;
- full `dev` process behavior;
- all public baseline skills and bundles;
- native Codex custom agents;
- session/compaction recovery;
- multi-agent coexistence and convergence;
- diagnostics, migration, documentation, and E2E evidence.

### Excluded

- `awm-personal-registry`;
- Codex versions older than `0.145.0`;
- additional native Windows support;
- a mandatory Codex plugin;
- provider-specific skill forks;
- unrelated behavior changes in Claude Code or OpenCode;
- new graphical interfaces.

## 16. UI screen detection

This work changes a CLI, configuration files, hooks, and agent instructions. It introduces no graphical screen or significant visual layout. No `## UI Screens` section is required, and the next lifecycle phase is `writing-plans`.

## 17. Sources

- [Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [Codex custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment)
- [Codex GitHub integration](https://learn.chatgpt.com/docs/third-party/github)
- `docs/plans/2026-06-04-multi-agent-decoupling-design.md`
- `docs/plans/2026-06-09-distribution-roadmap.md` (WS-6 / F-5)
