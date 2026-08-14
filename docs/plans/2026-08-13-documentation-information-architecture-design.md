# AWM documentation information architecture

## Requirements

- **R1.** THE documentation SHALL provide two first-class entry paths: understand AWM as an engineering framework, or install and use AWM.
- **R2.** THE repository SHALL use English as the single canonical language for active technical documentation.
- **R3.** THE onboarding flow SHALL separate machine preparation from project initialization as two explicit phases.
- **R4.** WHEN a user prepares a machine, THE documentation SHALL cover Linux, macOS, native Windows, and WSL prerequisites and caveats without duplicating provider instructions per operating system.
- **R5.** WHEN a user selects a provider, THE documentation SHALL show the exact `awm init --agent <provider>` variant, prerequisites, resulting configuration, capability tier, and relevant limitations for Claude Code, Codex, OpenCode, Cursor, Copilot, and Antigravity.
- **R6.** WHEN more than one provider is configured, THE documentation SHALL explain enabled providers, the default provider, repeated single-provider `init` runs, shared artifact ownership, inspection, and disable behavior.
- **R7.** WHEN `awm init --machine-only` runs, THE CLI SHALL NOT write project-scoped artifacts under the working directory; WHERE a provider has no global skill scope, THE CLI SHALL defer its project-only content and report that limitation explicitly.
- **R8.** WHEN the official registry is initialized, THE documentation SHALL distinguish automatically installed baseline bundles (`dev` and `product`) from project-scoped bundles (`frontend` and `authoring`).
- **R9.** WHEN a user extends AWM with a custom registry, THE documentation SHALL cover public and private remotes, machine registration, bundle scope, updates, pins, declared overrides, and the hand-off to project activation.
- **R10.** WHEN a user initializes a project, THE documentation SHALL provide distinct paths for greenfield repositories, existing repositories without AWM, repositories with a committed `.awm/profile.json`, detected frontend projects, and projects that require a custom registry.
- **R11.** THE functional framework guide SHALL explain AWM's lifecycle, layers, mandatory and optional phases, components, produced artifacts, quality model, human control, and supported entry cases independently of CLI internals.
- **R12.** THE active documentation SHALL assign one canonical owner to each subject and SHALL link to generated or authoritative references instead of repeating paths, capabilities, flags, or support claims.
- **R13.** THE documentation reorganization SHALL NOT move or repurpose `docs/plans/`, `docs/research/`, harness retrospectives, or other artifacts whose paths are part of AWM's own process contract.
- **R14.1.** WHEN active documentation changes, THE repository SHALL validate its relative links and anchors.
- **R14.2.** WHEN a documented command or flag changes, THE repository SHALL validate it against the compiled CLI help or Commander registration.
- **R14.3.** WHEN provider capabilities or paths change, THE repository SHALL regenerate and validate the support matrix from its source-of-truth files.
- **R14.4.** WHEN active documentation changes, THE repository SHALL verify that every active editorial guide remains reachable from `README.md` or `docs/README.md`.
- **R15.** IF a setup path is unsupported, degraded, pending agent work, or blocked by an external prerequisite, THEN THE documentation SHALL state the condition and provide an actionable next step without implying silent parity.
- **R16.1.** WHEN an editorial document is renamed, THE implementation SHALL use a history-preserving Git move.
- **R16.2.** WHEN an editorial document is renamed, THE implementation SHALL update every affected internal link.

## Context

AWM's active documentation grew alongside the product. It now contains strong material, but installation, provider setup, support, project onboarding, and framework explanation are repeated across `README.md`, `installation.md`, `agents-setup.md`, `runbook.md`, `support-matrix.md`, `sdlc.md`, and `CONSTITUTION.md`. Historical plans and research are intentionally numerous and are not the problem: they are evidence produced by the framework itself.

The redesign therefore targets only editorial, user-facing documentation. It must make two questions equally easy to answer:

1. What is AWM, how does its engineering lifecycle work, and what is it composed of?
2. How do I configure my machine and then introduce AWM into a project?

## Information architecture

`README.md` remains the product front door and routes to a new `docs/README.md` documentation hub. Both expose two first-class journeys:

```text
Understand AWM
└── framework → lifecycle → components → quality model → adoption

Start using AWM
└── installation → configuration → project setup → daily operation
```

Active editorial documents have one responsibility each:

| Document | Canonical responsibility |
|---|---|
| `README.md` | Product identity, value, overview, five-minute orientation, and route selection |
| `docs/README.md` | Navigable map of active documentation by user intent |
| `docs/framework.md` | Functional explanation of AWM as an engineering framework |
| `docs/installation.md` | CLI installation and machine preparation by operating system |
| `docs/configuration.md` | Providers, multiple-provider coexistence, machine state, defaults, and custom registries |
| `docs/project-setup.md` | New, existing, and already-configured repository onboarding |
| `docs/agents-setup.md` | Provider-specific mechanics, prerequisites, and limitations |
| `docs/runbook.md` | Day-to-day operation, team rollout, registry operations, and troubleshooting |
| `docs/cli-reference.md` | Exhaustive command and option contract |
| `docs/support-matrix.md` | Generated capability, path, and evidence-level truth |
| `docs/architecture.md` | Internal implementation architecture for contributors |
| `docs/guides/` | Detailed product, development, and parallel-execution process guides |

`docs/sdlc.md` becomes `docs/framework.md` through `git mv`. Its useful content is retained, expanded, and reorganized. All inbound links are updated. The historical and harness-produced trees remain in place.

## Onboarding flow

### Phase 1: prepare the machine

The installation journey ends with a machine prepared for one or more providers. It does not initialize a repository.

```bash
npm i -g agentic-workflow-manager
awm init --agent <provider> --machine-only
awm agent list
awm doctor --agent <provider>
```

This phase:

- installs or updates the CLI through npm;
- records the provider in AWM's machine preferences;
- seeds and synchronizes the official registry;
- installs every bundle whose registry scope is `baseline` or `ambient` when the provider has a compatible machine scope;
- installs provider hooks and global context where supported; and
- leaves project profiles, sensors, constitutions, local instructions, and local extensions untouched.

The current official registry contains `dev` and `product` as baseline bundles. `frontend` and `authoring` are project-scoped. Documentation must not describe `awm init` as installing only the development phase.

For several providers, the user repeats the machine initialization once per provider:

```bash
awm init --agent claude-code --machine-only
awm init --agent codex --machine-only
awm init --agent cursor --machine-only
```

The first provider on a new machine becomes the default. Later explicit runs enable additional providers without replacing the default. `awm agent list` exposes both states. Disabling a provider changes AWM bookkeeping but leaves provider-owned files in place; disabling the default requires a replacement.

### Provider without machine scope

Copilot has no global skill location. `--machine-only` must therefore record the provider and complete applicable machine work, but defer Copilot instructions until project initialization. It must not materialize baseline skills into the current directory. The outcome must state why project content was deferred.

The current implementation installs Copilot's baseline locally from the machine-level `devCore` step, contradicting the documented no-project-write contract. The implementation plan must add a failing regression test, skip the local-only install under `machineOnly`, and verify that normal project initialization still materializes Copilot content.

### Phase 2: initialize a project

Project setup starts only after entering the target repository:

```bash
awm init --agent <provider>
awm doctor --agent <provider>
awm preflight
```

This phase is idempotent. It rechecks machine state, creates or reconciles `.awm/profile.json`, detects applicable project extensions, initializes sensors, and reports agent-owned pending work such as constitution and context creation.

The project guide distinguishes:

- a greenfield repository with no AWM state;
- an established repository adopting AWM;
- a repository with a committed profile being cloned by another developer;
- automatic `frontend` detection from supported framework dependencies or directory signals;
- explicit activation with `awm add <bundle>`; and
- synchronization from a committed profile with `awm sync`.

Provider configuration is personal machine state. `.awm/profile.json`, sensor configuration, constitution, and project context are the shared repository contract. The guide makes that ownership boundary explicit.

## Custom registries

Custom registries extend the framework without modifying the CLI or official baseline registry. The configuration guide covers:

```bash
awm registry add <git-url> --no-install
awm registry list
awm init --agent <provider> --machine-only
```

Registering with `--no-install` makes the sequence explicit: machine-scoped baseline and ambient bundles are reconciled by the following machine init, while project bundles remain for project setup. Interactive selection and `--install-all` remain documented in the runbook, including the fact that project-scoped bundles use the current project root.

The guide also covers:

- HTTPS and SSH remotes;
- private-registry authentication through normal Git configuration;
- stable tag selection, machine pins, and committed project pins;
- additional content versus declared overrides;
- bundle scopes (`baseline`, `ambient`, `project`); and
- onboarding when `.awm/profile.json` names bundles whose registry URL is not stored in the profile.

## Functional framework guide

`docs/framework.md` explains the product independently of setup commands.

### Purpose and operating model

AWM turns incomplete intent into a reviewable software change. Humans retain intent, prioritization, and consequential decisions. Agents execute bounded work. The harness supplies deterministic controls and evidence.

### Lifecycle

The guide explains the complete lifecycle:

1. need and human intent;
2. product discovery and brief when the starting point is not yet a requirement;
3. readiness before development hand-off;
4. solution brainstorming and optional UI design;
5. a traceable implementation plan;
6. bounded execution through a controller and focused subagents;
7. TDD and specialist craft skills;
8. deterministic sensors, preflight, security, and quality gates;
9. review, verification, branch completion, and PR; and
10. ledger evidence and harness retrospectives that feed future improvements.

The lifecycle has multiple valid entry points: a raw idea, a certified product brief, a concrete feature, a bug with incomplete evidence, a legacy change, or an existing implementation plan. Product and visual-design phases are conditional. Security, robustness, verification, and evidence gates are not optional.

### Components

The guide defines the role and boundary of:

- the AWM CLI;
- orchestration, process, craft, and gate skills;
- controller agents and focused subagents;
- registries, bundles, workflows, and agent profiles;
- provider adapters and capability tiers;
- `AGENTS.md`, `CLAUDE.md`, `CONSTITUTION.md`, and `.awm/profile.json`;
- sensors, preflight, and deterministic exits;
- filesystem transactions and backups; and
- ledger and retrospective learning.

It also lists the artifacts produced at each stage and distinguishes process guarantees from model correctness. AWM supplies disciplined execution and reviewable evidence; it does not replace human judgment or guarantee that an LLM's reasoning is correct.

## Source-of-truth rules

| Subject | Authority |
|---|---|
| Provider IDs, paths, renderers, hooks, and injection | `cli/src/providers/index.ts` |
| Generated provider and OS support tables | `docs/support-matrix.md` via `npm run docs:matrix` |
| Command names and flags | Commander registrations and compiled `awm <command> --help` |
| Official bundle names and scopes | Versioned manifests in `awm-baseline-registry` |
| Framework process contracts | Baseline registry skills and project `CONSTITUTION.md` |
| Internal CLI architecture | Source code and `docs/architecture.md` |

Editorial guides summarize and link; they do not recreate authoritative tables. When a concise repetition is necessary for a user journey, it names the authority and is covered by a freshness check or focused structural assertion.

## Error and limitation handling

Setup documentation provides an actionable branch for:

- unsupported Node or provider versions;
- a provider binary that is missing from `PATH`;
- native Windows symlink restrictions and copy-mode alternatives;
- WSL projects stored on Windows-mounted filesystems;
- private registry authentication failures;
- missing custom registries referenced by a committed profile;
- project-only provider capabilities during machine preparation;
- pending steps that require an agent session; and
- the distinction between failure, degraded state, unsupported capability, and intentionally deferred work.

No guide claims parity where only context delivery is available. Capability tiers remain visible and link to the generated matrix.

## Validation strategy

This work validates documentation configuration, not live LLM sessions across every provider and operating system.

Validation includes:

- compiling the CLI before running the complete repository suite;
- comparing documented commands and options to compiled help output;
- regenerating and checking the support matrix;
- checking relative links and anchors across active editorial documents;
- ensuring every active document is reachable from `README.md` or `docs/README.md`;
- focused regression coverage for Copilot `--machine-only` no-write behavior;
- exercising the documented machine and project command sequences in isolated temporary homes where practical; and
- running the existing Linux, macOS, and Windows CI matrix.

Historical plans, research, and harness evidence are not rewritten merely to match the new navigation. Links from active documents into those artifacts may be retained when they add evidence.

## Non-goals

- Moving, renaming, pruning, or editorially normalizing harness-produced plans, research, ledgers, or retrospectives.
- Adding support for a new provider, operating system, stack, or sensor pack.
- Running authenticated end-user sessions against every LLM provider.
- Maintaining a second hand-written Spanish documentation set.
- Redesigning the public website or presentation assets.
- Adding a general default-provider switching feature; the current limitation is documented separately from this information-architecture change.

## Delivery boundaries

The implementation should be divided into reviewable workstreams:

1. restore a green Windows CI baseline and identify the exact failing test from the post-merge run;
2. correct Copilot's `--machine-only` no-project-write contract with TDD;
3. add the documentation hub and functional framework guide;
4. separate machine installation/configuration from project setup;
5. deduplicate runbook, provider, support, and CLI-reference content;
6. add or tighten documentation validation; and
7. run full QA across links, commands, generated content, and the OS CI matrix.

The failed post-merge Windows job is diagnosed and fixed as an independent prerequisite; no speculative change is bundled into the documentation redesign without its exact log and a reproducer.
