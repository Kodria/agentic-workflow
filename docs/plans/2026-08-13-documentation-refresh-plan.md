# AWM Documentation Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AWM a clean, accurate documentation system that explains the engineering framework and guides users through machine preparation, provider configuration, and project onboarding without duplicated sources of truth.

**Architecture:** Keep Markdown in the existing repository, but give each active editorial document one canonical responsibility and connect them through a documentation hub. Derive provider facts from code and generated tables, treat machine setup and project setup as separate journeys, and correct Copilot's `--machine-only` behavior so the documented boundary is true in the CLI.

**Tech Stack:** Markdown, TypeScript 5.9, Commander, Jest 30, Node.js 22, npm, GitHub Actions.

**Modo de ejecución:** desatendido

---

## Scope and file map

The implementation is serial. Several tasks update the same navigation links and the support/configuration documents, so parallel tracks would create avoidable merge conflicts.

**Create**

- `docs/README.md` — intent-based documentation hub.
- `docs/configuration.md` — machine state, providers, multiple-provider coexistence, and custom registries.
- `docs/project-setup.md` — repository onboarding after machine setup.
- `cli/tests/structural/active-documentation.test.ts` — active-doc reachability, local-link, anchor, command, and canonical-topic guards.

**Rename and rewrite**

- `docs/sdlc.md` → `docs/framework.md` — functional explanation of AWM as an engineering framework.

**Modify**

- `README.md` — product front door and two-entry navigation.
- `docs/installation.md` — CLI installation plus machine-only preparation by OS.
- `docs/agents-setup.md` — provider mechanics only; remove general onboarding duplication.
- `docs/runbook.md` — daily/team operations only; link instead of repeating installation and project setup.
- `docs/cli-reference.md` — exact `init` and agent-management semantics.
- `docs/support-matrix.md` — correct hand-written OS/status prose while preserving generated provider tables.
- `docs/architecture.md` — link functional readers to `framework.md` and keep internals separate.
- `cli/src/core/init/steps.ts` — defer local-only baseline content during `--machine-only`.
- `cli/tests/core/init/steps.test.ts` — unit regression for the Copilot boundary.
- `cli/tests/integration/copilot-init-isolated.test.ts` — real isolated-home regression for machine-only no-write and normal project delivery.

**Do not move or normalize**

- `docs/plans/`
- `docs/research/`
- `docs/harness-retros.md`
- `.awm/ledger/` and other harness-owned evidence

## Verification order

Every full verification run must compile first because four suites execute the real `dist/src/index.js`:

```bash
cd cli
npm run build
npm test -- --runInBand
```

Running `npm test` before `npm run build` is not a valid baseline for this repository.

### Task 1: Make `--machine-only` project-safe for Copilot

_Requirements: R7, R15_

**Files:**
- Modify: `cli/src/core/init/steps.ts:212-248`
- Test: `cli/tests/core/init/steps.test.ts`
- Test: `cli/tests/integration/copilot-init-isolated.test.ts`

**Skills:** test-driven-development, systematic-debugging

- [x] **Step 1: Add the failing unit regression**

Add this case beside the existing Copilot `stepDevCore` tests:

```ts
it('defers local-only baseline bundles during --machine-only (R7)', () => {
    const a = spies();
    const m = machine();
    m.devCore = { present: false, brokenLinks: [] };

    const r = stepDevCore(deps({ machine: m, project: null }, a, {
        agent: 'copilot',
        enabledAgents: ['copilot'],
        machineOnly: true,
    }));

    expect(r).toMatchObject({
        action: 'skipped',
        level: 'machine',
    });
    expect(r.detail).toMatch(/project scope.*deferred/i);
    expect(a.installBundle).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run the unit test and verify RED**

Run:

```bash
cd cli
npx jest tests/core/init/steps.test.ts --runInBand
```

Expected: FAIL because `stepDevCore` calls `installBundle` with `scopeOverride: 'local'` even when `machineOnly` is true.

- [x] **Step 3: Add the failing isolated integration regression**

Add a test in `copilot-init-isolated.test.ts` that starts with a bare working directory and snapshots every entry before and after:

```ts
it('machine-only enables Copilot without writing project artifacts (R7, R15)', async () => {
    seedPublicRegistryFixture(path.join(tmpHome, '.awm/registries/baseline'));
    const before = fs.readdirSync(tmpWork).sort();
    const { runInit } = require('../../src/commands/init');

    const code = await runInit({
        cwd: tmpWork,
        yes: true,
        agent: 'copilot',
        machineOnly: true,
    });

    expect(code).toBe(0);
    expect(readPrefs().enabledAgents).toEqual(['copilot']);
    expect(fs.readdirSync(tmpWork).sort()).toEqual(before);
    expect(fs.existsSync(path.join(tmpWork, 'AGENTS.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmpWork, '.github'))).toBe(false);
    expect(fs.existsSync(path.join(tmpWork, '.awm'))).toBe(false);
});
```

- [x] **Step 4: Run the integration test and verify RED**

> Completion note: the isolated bare-directory scenario was already protected by
> the existing project-root detection path, so it did not reproduce the proposed
> failure before the guard was added. The direct `stepDevCore` unit regression
> did reproduce it in RED; the isolated test remains the end-to-end no-write
> contract.

Run:

```bash
cd cli
npx jest tests/integration/copilot-init-isolated.test.ts --runInBand
```

Expected: FAIL because baseline instructions are materialized under `tmpWork`.

- [x] **Step 5: Implement the minimal machine-only guard**

In `stepDevCore`, guard the local-only branch before installing bundles:

```ts
const localOnly = providerFor(d.agent).skill.global === null;
if (localOnly && d.machineOnly) {
    return ok(
        'machine.devCore',
        'machine',
        'skipped',
        `${providerFor(d.agent).label} provides skills at project scope — deferred until project initialization`,
    );
}
for (const bundleName of toInstall) {
    d.actions.installBundle({
        bundleName,
        bundles: d.bundles,
        agents: sharedInstallAgents(d, localOnly ? 'local' : 'global'),
        method: d.installMethod,
        projectRoot: d.cwd,
        contentDir: d.contentDir,
        ...(localOnly ? { scopeOverride: 'local' as const } : {}),
    });
}
```

Do not change normal project initialization: the existing real E2E must continue to create `AGENTS.md` and `.github/instructions/` when `machineOnly` is false.

- [x] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
cd cli
npx jest tests/core/init/steps.test.ts tests/core/init/context-injection-no-project.test.ts tests/integration/copilot-init-isolated.test.ts --runInBand
```

Expected: PASS; the new machine-only tests pass and the existing normal Copilot initialization test still delivers project content.

- [x] **Step 7: Commit**

```bash
git add cli/src/core/init/steps.ts cli/tests/core/init/steps.test.ts cli/tests/integration/copilot-init-isolated.test.ts
git commit -m "fix(init): defer Copilot project content in machine-only mode"
```

### Task 2: Add enforceable active-documentation contracts

_Requirements: R1, R2, R3, R5, R8, R11, R12, R14.1, R14.2, R14.4_

**Files:**
- Create: `cli/tests/structural/active-documentation.test.ts`

- [x] **Step 1: Write the failing structural test with the final active-doc set**

Create the test with a fixed editorial allowlist; do not scan `docs/plans` or `docs/research`:

```ts
import fs from 'fs';
import path from 'path';
import { AGENT_TARGETS } from '../../src/providers';

const ROOT = path.resolve(__dirname, '../../..');
const ACTIVE = [
    'README.md',
    'docs/README.md',
    'docs/framework.md',
    'docs/installation.md',
    'docs/configuration.md',
    'docs/project-setup.md',
    'docs/agents-setup.md',
    'docs/runbook.md',
    'docs/cli-reference.md',
    'docs/support-matrix.md',
    'docs/architecture.md',
    'docs/guides/product-process.md',
    'docs/guides/development-process.md',
    'docs/guides/parallel-tracks.md',
] as const;

const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

function slug(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/[`*_~]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function anchors(markdown: string): Set<string> {
    const seen = new Map<string, number>();
    const out = new Set<string>();
    for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
        const base = slug(match[1]);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        out.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const match of markdown.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) out.add(match[1]);
    return out;
}

function localLinks(markdown: string): string[] {
    return Array.from(markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g), (m) => m[1])
        .filter((target) => !/^(?:https?:|mailto:)/.test(target));
}

describe('active documentation contract', () => {
    it('has one reachable active editorial set (R1, R11, R14.4)', () => {
        const navigation = read('README.md') + read('docs/README.md');
        for (const file of ACTIVE) {
            expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
            if (file !== 'README.md' && file !== 'docs/README.md') {
                expect(navigation).toContain(file.replace(/^docs\//, ''));
            }
        }
    });

    it('keeps every relative link and anchor valid (R14.1)', () => {
        for (const source of ACTIVE) {
            for (const raw of localLinks(read(source))) {
                const [filePart, fragment] = raw.split('#');
                const target = filePart
                    ? path.resolve(path.dirname(path.join(ROOT, source)), decodeURI(filePart))
                    : path.join(ROOT, source);
                expect(fs.existsSync(target)).toBe(true);
                if (fragment && target.endsWith('.md')) {
                    expect(anchors(fs.readFileSync(target, 'utf8'))).toContain(decodeURI(fragment));
                }
            }
        }
    });

    it('documents the two-stage boundary and official bundle scopes (R3, R8)', () => {
        expect(read('docs/installation.md')).toContain('Prepare the machine');
        expect(read('docs/project-setup.md')).toContain('Initialize a project');
        expect(read('docs/configuration.md')).toContain('`dev` and `product`');
        expect(read('docs/project-setup.md')).toContain('`frontend`');
    });

    it('documents every init provider and option (R5, R14.2)', () => {
        const config = read('docs/configuration.md');
        for (const agent of AGENT_TARGETS) {
            expect(config).toContain(`awm init --agent ${agent} --machine-only`);
        }
        for (const flag of ['--agent', '--machine-only', '--yes', '--json']) {
            expect(config).toContain(`\`${flag}\``);
        }
    });

    it('assigns canonical topics instead of copying provider paths (R12)', () => {
        expect(read('docs/configuration.md')).toContain('[Support matrix](support-matrix.md)');
        expect(read('docs/configuration.md')).not.toMatch(/~\/\.(?:claude|codex|cursor|gemini)/);
    });
});
```

- [x] **Step 2: Run the new test and verify RED**

Run:

```bash
cd cli
npx jest tests/structural/active-documentation.test.ts --runInBand
```

Expected: FAIL because `docs/README.md`, `framework.md`, `configuration.md`, and `project-setup.md` do not exist yet.

- [x] **Step 3: Commit the RED contract**

```bash
git add cli/tests/structural/active-documentation.test.ts
git commit -m "test(docs): define active documentation contract"
```

### Task 3: Build the documentation front door

_Requirements: R1, R2, R11, R14.4_

**Files:**
- Modify: `README.md`
- Create: `docs/README.md`

- [x] **Step 1: Rewrite the README opening around product identity and two intents**

Keep the existing package name, badges, install snippet, and license. Replace the duplicated matrices and long documentation list with this hierarchy and equivalent final prose:

```md
# Agentic Workflow Manager (AWM)

AWM is an engineering framework for agentic software development. It turns an
incomplete need into a reviewable pull request through explicit human decisions,
bounded agent execution, deterministic quality gates, and durable evidence.

## Choose your path

### Understand the framework

Start with [How AWM works](docs/framework.md) to learn the lifecycle, its
components, which phases are optional, and which quality gates are mandatory.

### Start using AWM

1. [Install AWM and prepare your machine](docs/installation.md)
2. [Configure providers and registries](docs/configuration.md)
3. [Initialize a project](docs/project-setup.md)
4. [Operate AWM day to day](docs/runbook.md)

## Five-minute machine setup

```bash
npm i -g agentic-workflow-manager
awm init --agent claude-code --machine-only
awm agent list
awm doctor --agent claude-code
```

This prepares the machine only. Run project initialization separately inside
the repository you want AWM to manage.
```

Retain concise sections for support summary, framework-at-a-glance, daily commands, contributing, and license. Link the generated support matrix rather than recreating its tables.

- [x] **Step 2: Create the intent-based documentation hub**

Use this exact top-level structure in `docs/README.md`:

```md
# AWM documentation

AWM documentation has two entry points. Use the first to understand the
engineering system and the second to configure and operate it.

## Understand AWM

- [Framework](framework.md) — lifecycle, components, control model, artifacts, and guarantees.
- [Architecture](architecture.md) — internal CLI and registry design for contributors.
- [Product process](guides/product-process.md) — mature raw needs before development.
- [Development process](guides/development-process.md) — execute concrete requirements safely.
- [Parallel tracks](guides/parallel-tracks.md) — coordinate independent implementation work.

## Start using AWM

1. [Installation](installation.md) — install the CLI and prepare one or more providers on the machine.
2. [Configuration](configuration.md) — providers, defaults, multiple-provider coexistence, and registries.
3. [Project setup](project-setup.md) — initialize a new, existing, or already-configured repository.
4. [Runbook](runbook.md) — daily work, updates, teams, and troubleshooting.

## Reference

- [CLI reference](cli-reference.md)
- [Provider and operating-system support](support-matrix.md)
- [Agent-specific setup](agents-setup.md)
- [Testing and acceptance](testing/README.md)

## Project evidence

Plans, research, and harness retrospectives are engineering evidence produced by
AWM itself. They retain their contractual locations and are not part of the
getting-started sequence.
```

- [x] **Step 3: Run the reachability test**

Run:

```bash
cd cli
npx jest tests/structural/active-documentation.test.ts --runInBand
```

Expected: still FAIL only for the active documents not yet created or renamed; no README navigation failure.

- [x] **Step 4: Commit**

```bash
git add README.md docs/README.md
git commit -m "docs: add intent-based documentation entry points"
```

### Task 4: Turn the SDLC guide into the functional framework guide

_Requirements: R11, R12, R16.1, R16.2_

**Files:**
- Rename: `docs/sdlc.md` → `docs/framework.md`
- Modify: `docs/framework.md`
- Modify links in: `README.md`, `docs/README.md`, `docs/architecture.md`, `docs/runbook.md`, `docs/cli-reference.md`, `docs/guides/*.md`

- [x] **Step 1: Preserve history with Git move**

```bash
git mv docs/sdlc.md docs/framework.md
```

- [x] **Step 2: Rewrite the guide with the approved functional structure**

Use these sections and claims:

```md
# How AWM works

AWM is an engineering framework, not an autonomous code generator. Humans own
intent and consequential decisions; agents perform bounded work; the harness
enforces deterministic controls and records reviewable evidence.

## The problem AWM solves
## The control model: human, agents, harness
## Valid entry points
### Raw idea or business need
### Certified product brief
### Concrete feature, bug, or refactor
### Existing implementation plan
## The complete lifecycle
### 1. Need and product discovery
### 2. Brief and readiness
### 3. Solution design
### 4. Traceable planning
### 5. Bounded execution
### 6. Sensors and quality gates
### 7. Review, verification, and PR
### 8. Ledger and harness learning
## Flexible phases and mandatory gates
## Components
### CLI
### Skills and orchestrators
### Controllers and subagents
### Registries and bundles
### Provider adapters
### Project context and constitution
### Sensors, preflight, and evidence
### Transactions, backups, and recovery
## Artifacts produced across the lifecycle
## Adoption cases
### New project
### New business capability
### Incomplete support bug
### Legacy system change
## What AWM guarantees — and what it does not
## Where to go next
```

Explicitly state:

- Product discovery is conditional on starting with an unformed need.
- UI design is conditional on a real screen requirement.
- Security, robustness, verification, and evidence gates remain mandatory.
- AWM guarantees process discipline and evidence, not correct LLM reasoning.
- The official baseline includes Product and Development; Frontend is a project extension.

- [x] **Step 3: Update every active inbound link**

Run:

```bash
rg -n 'sdlc\.md|\[SDLC\]' README.md docs --glob '*.md' --glob '!plans/**' --glob '!research/**'
```

Replace active editorial links with `framework.md` or `docs/framework.md`. Do not rewrite historical plans merely because they mention the old file.

- [x] **Step 4: Verify the move and links**

> Completion note: the history-preserving move was committed separately in
> `c08b115` before the substantive rewrite. The aggregate branch diff classifies
> the heavily rewritten file as add/delete, while `git log --follow` retains the
> pre-branch history through that explicit rename commit.

Run:

```bash
git diff --summary origin/main...HEAD
cd cli
npx jest tests/structural/active-documentation.test.ts --runInBand
```

Expected: Git reports `rename docs/{sdlc.md => framework.md}` and the link checker has no `sdlc.md` failure.

- [x] **Step 5: Commit**

```bash
git add README.md docs
git commit -m "docs: explain AWM as an engineering framework"
```

### Task 5: Separate installation from provider and registry configuration

_Requirements: R3, R4, R5, R6, R7, R8, R9, R15_

**Files:**
- Modify: `docs/installation.md`
- Create: `docs/configuration.md`
- Modify: `docs/agents-setup.md`

- [x] **Step 1: Make installation end at a prepared machine**

Restructure `installation.md` to this order:

```md
# Install AWM and prepare the machine

## What this phase changes
## Prerequisites
## Install or upgrade the CLI
## Operating-system setup
### Linux
### macOS
### Windows (native)
### Windows through WSL
## Prepare one provider
## Verify machine state
## Next: initialize a project
## Installation troubleshooting
```

The canonical command is:

```bash
awm init --agent <provider> --machine-only
```

State explicitly that this phase may write AWM machine preferences, registry caches, global skills, hooks, and global provider context. It must not create `.awm/profile.json`, sensors, constitution, or local provider instructions in the current directory. Link Copilot's project-only exception to `configuration.md`, explaining that its content is deferred rather than written locally.

Correct the stale macOS claim: macOS is part of `.github/workflows/ci.yml` together with Linux and Windows.

- [x] **Step 2: Create the canonical configuration guide**

Use this structure:

```md
# Configure AWM

## Machine state versus project state
## Choose a provider
## `awm init` variants
### Interactive
### Non-interactive
### Machine-readable output
## Configure more than one provider
## Inspect enabled and default providers
## Disable a provider safely
## Provider capability tiers
## Extend AWM with custom registries
### Public registry
### Private registry over SSH
### Bundle scopes
### Updates and pins
### Declared overrides
## What machine initialization installs
## Next: initialize a project
```

Include all six exact machine commands:

```bash
awm init --agent claude-code --machine-only
awm init --agent codex --machine-only
awm init --agent opencode --machine-only
awm init --agent cursor --machine-only
awm init --agent copilot --machine-only
awm init --agent antigravity --machine-only
```

Explain these contracts exactly:

- `awm init` without `--agent` defaults to Claude Code on a fresh installation.
- One `init` run targets one provider; repeat it to enable several.
- The first provider remains default when later explicit providers are enabled.
- `awm agent list` shows enabled/default state.
- `awm agent disable <provider>` leaves provider files in place.
- Disabling the default requires `--default <replacement>`.
- Codex and OpenCode share a physical skill directory and AWM tracks co-ownership.
- Copilot has no global skill scope, so machine-only records it but defers content.
- `--yes` disables prompts; `--json` keeps stdout machine-readable.

For registries, include:

```bash
awm registry add <git-url> --no-install
awm registry list
awm init --agent <provider> --machine-only
```

Explain that baseline/ambient bundles reconcile at machine scope and project bundles activate later. Link complete paths and tiers to `[Support matrix](support-matrix.md)` instead of copying them.

- [x] **Step 3: Narrow `agents-setup.md` to provider-specific mechanics**

Retain one section per provider with prerequisites, format, trust prompts, provider-specific environment variables, and limitations. Replace the duplicated “several agents” and team onboarding prose with links to `configuration.md` and `project-setup.md`. Keep the generated matrix authoritative for paths.

- [x] **Step 4: Verify configuration contract**

Run:

```bash
cd cli
npx jest tests/structural/active-documentation.test.ts tests/structural/support-matrix-is-current.test.ts --runInBand
node dist/src/index.js init --help
node dist/src/index.js agent --help
node dist/src/index.js registry --help
```

Expected: documentation tests pass for existing files; help output exposes every documented command and option.

- [x] **Step 5: Commit**

```bash
git add docs/installation.md docs/configuration.md docs/agents-setup.md
git commit -m "docs: separate machine installation and provider configuration"
```

### Task 6: Add the project initialization journey

_Requirements: R3, R8, R9, R10, R15_

**Files:**
- Create: `docs/project-setup.md`
- Modify: `README.md`
- Modify: `docs/README.md`

- [x] **Step 1: Create `project-setup.md` with explicit entry cases**

Use this structure and command contracts:

```md
# Initialize a project

Complete [machine preparation](installation.md) before this phase. Project
initialization runs inside the repository and creates the shared AWM contract.

## What belongs to the project
## New repository
## Existing repository adopting AWM
## Clone a repository that already uses AWM
## Frontend detection and optional activation
## Activate an extension manually
## Use a custom team registry
## Complete pending agent-owned steps
## Verify readiness
## Commit the shared contract
## Project setup troubleshooting
```

New/existing repository flow:

```bash
cd <repository>
awm init --agent <provider>
awm doctor --agent <provider>
awm preflight
```

Already-configured clone flow:

```bash
git clone <repository>
cd <repository>
awm init --agent <provider>
awm registry add <team-registry-url> --no-install  # only when the profile needs it
awm sync
awm doctor --agent <provider>
awm preflight
```

Explain that `.awm/profile.json` is agent-agnostic and committed, while the provider choice remains machine state. Explain automatic `frontend` signals and the confirmation prompt; show explicit activation as:

```bash
awm add frontend --agent <provider> --scope local
```

State what should be committed: `.awm/profile.json`, sensor manifest/configuration, `CONSTITUTION.md`, and provider-specific project context/instructions where applicable. Generated symlinks remain ignored according to the existing installer contract.

- [x] **Step 2: Add troubleshooting branches**

Cover these exact cases with a cause and command:

| Condition | Action |
|---|---|
| `bundle not found in registry` | Add the documented team registry, run `awm update`, then `awm sync`. |
| sensors not configured | Run `awm sensors init`, review the pack, then `awm preflight`. |
| pending constitution/context | Start the configured agent in the repository and follow the named pending skill. |
| native Windows symlink denial | Enable Developer Mode or install affected artifacts with copy mode. |
| Copilot machine setup has no skills | Expected; run normal project initialization inside the repository. |

- [x] **Step 3: Verify the complete navigation/link contract**

Run:

```bash
cd cli
npx jest tests/structural/active-documentation.test.ts --runInBand
```

Expected: PASS for reachability, two-stage boundary, local links, anchors, provider commands, and canonical-topic ownership.

- [x] **Step 4: Commit**

```bash
git add README.md docs/README.md docs/project-setup.md
git commit -m "docs: add explicit project initialization guide"
```

### Task 7: Deduplicate operations and reference documentation

_Requirements: R6, R9, R12, R14.2, R15_

**Files:**
- Modify: `docs/runbook.md`
- Modify: `docs/cli-reference.md`
- Modify: `docs/architecture.md`

- [x] **Step 1: Refocus the runbook on operations**

Replace the full installation and project-bootstrap chapters with short prerequisites linking to `installation.md`, `configuration.md`, and `project-setup.md`. Retain and consolidate:

```md
# AWM runbook
## Before using this runbook
## Daily development loop
## Diagnose machine and project state
## Update CLI versus update content
## Synchronize project extensions
## Sensors, preflight, and baselines
## Backups and recovery
## Team registries
## Version pins and rollout
## Onboard another developer
## Author and release custom content
## Troubleshooting
```

Keep registry creation, SSH, pinning, authoring, and team rollout detail here. Remove repeated provider path tables and repeated `init` flag definitions.

- [x] **Step 2: Correct `cli-reference.md` contracts**

The `awm init` entry must say:

```md
`awm init` targets one provider per run. Without `--agent`, a fresh machine uses
`claude-code`. `--machine-only` excludes every project-scoped write; providers
without global delivery defer their content until a normal project init.
```

Document `awm agent list` and `awm agent disable`, including replacement-default behavior. Keep examples concise and link conceptual explanations to `configuration.md`.

- [x] **Step 3: Separate internal architecture from functional explanation**

At the top of `architecture.md`, add:

```md
This document explains how the CLI is implemented. To understand the engineering
workflow and its lifecycle, start with [How AWM works](framework.md).
```

Update related links without duplicating framework prose.

- [x] **Step 4: Verify command reference and links**

Run:

```bash
cd cli
npx jest tests/structural/active-documentation.test.ts --runInBand
node dist/src/index.js init --help
node dist/src/index.js agent list --help
node dist/src/index.js agent disable --help
node dist/src/index.js registry add --help
```

Expected: all help invocations exit 0 and every documented flag appears exactly as implemented.

- [x] **Step 5: Commit**

```bash
git add docs/runbook.md docs/cli-reference.md docs/architecture.md
git commit -m "docs: deduplicate operations and CLI reference"
```

### Task 8: Reconcile support claims with code and CI

_Requirements: R4, R5, R12, R14.3, R15_

**Files:**
- Modify: `docs/support-matrix.md`
- Modify: `docs/installation.md`
- Modify: `docs/agents-setup.md`
- Regenerate: generated block inside `docs/support-matrix.md` only through `npm run docs:matrix`

- [x] **Step 1: Regenerate the provider tables from code**

Run:

```bash
cd cli
npm run docs:matrix
git diff -- ../docs/support-matrix.md
```

Expected: either no generated diff, or a diff fully explained by current `providers/index.ts`. Never hand-edit between the generated markers.

- [x] **Step 2: Audit hand-written support prose against current contracts**

Confirm and state accurately:

- CI runs `ubuntu-latest`, `windows-latest`, and `macos-latest`.
- WSL follows the Linux path and should use the Linux filesystem.
- Native Windows symlink and watch crash-recovery caveats remain explicit.
- Codex minimum version is read from the code-supported contract.
- Six providers appear, with unsupported scope distinguished from missing configuration.
- Deterministic sensors are provider-independent; hook enforcement is not.

Remove dated narrative that is useful only as historical evidence from the active support path; link to research evidence where it adds value rather than moving the evidence.

- [x] **Step 3: Run generated-content verification**

Run:

```bash
cd cli
npx jest tests/structural/support-matrix-is-current.test.ts tests/structural/provider-paths-honor-config-home.test.ts tests/providers/index.test.ts --runInBand
```

Expected: PASS on all three OS-neutral provider truth guards.

- [x] **Step 4: Commit**

```bash
git add docs/support-matrix.md docs/installation.md docs/agents-setup.md
git commit -m "docs: align support guidance with current providers and CI"
```

### Task 9: Perform the editorial and preservation audit

_Requirements: R2, R12, R13, R14.1, R14.4, R15, R16.1, R16.2_

**Files:**
- Modify only active editorial files named in this plan when findings require correction.
- Do not modify harness-owned evidence except the two new approved plan artifacts.

- [x] **Step 1: Scan for stale navigation and duplicate ownership**

Run:

```bash
rg -n 'sdlc\.md|macOS is \*\*not covered by CI\*\*|Inside the repo where you want the harness|awm agent\s+#' README.md docs --glob '*.md' --glob '!plans/**' --glob '!research/**'
rg -n '^## (Install|First run|Provider capability matrix|Several agents)' docs/{installation,configuration,project-setup,agents-setup,runbook,cli-reference}.md
```

Expected: no stale `sdlc.md` link or obsolete macOS claim; each topic appears in its canonical owner and only concise links appear elsewhere.

- [x] **Step 2: Perform the canonical-English review**

Read every file in the `ACTIVE` allowlist from `active-documentation.test.ts`. Verify headings, explanatory prose, examples, and captions are English. Provider output quoted verbatim may retain its source language only when necessary; new editorial prose must be English. This manual reading specifically verifies R2 rather than relying on an unreliable language heuristic.

- [x] **Step 3: Verify harness paths were preserved**

Run:

```bash
git diff --name-status origin/main...HEAD -- docs/plans docs/research docs/harness-retros.md
```

Expected: only these approved additions appear under `docs/plans/`:

```text
A docs/plans/2026-08-13-documentation-information-architecture-design.md
A docs/plans/2026-08-13-documentation-refresh-plan.md
```

There must be no move, deletion, or modification under `docs/research/` or `docs/harness-retros.md`.

- [x] **Step 4: Verify history-preserving rename**

Run:

```bash
git diff --summary origin/main...HEAD -- docs/sdlc.md docs/framework.md
git log --follow --oneline -- docs/framework.md | head
```

Expected: Git detects the rename and `git log --follow` includes history predating this branch.

- [x] **Step 5: Fix only concrete audit findings and commit**

```bash
git add README.md docs
git commit -m "docs: complete editorial consistency audit"
```

If the audit produces no changes, do not create an empty commit.

### Task 10: Run full verification and prepare review evidence

_Requirements: R1, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14.1, R14.2, R14.3, R14.4, R15, R16.1, R16.2_

**Files:**
- Verify all files changed by Tasks 1–9.

**Skills:** verification-before-completion

- [x] **Step 1: Build the real CLI**

```bash
cd cli
npm run build
```

Expected: TypeScript exits 0 and `dist/src/index.js` exists.

- [x] **Step 2: Run focused documentation and Copilot gates**

```bash
cd cli
npx jest tests/structural/active-documentation.test.ts tests/structural/support-matrix-is-current.test.ts tests/core/init/steps.test.ts tests/integration/copilot-init-isolated.test.ts --runInBand
```

Expected: all focused suites PASS.

- [x] **Step 3: Run the complete suite**

```bash
cd cli
npm test -- --runInBand
```

Expected: all suites pass; the starting baseline was 216 suites and 2,281 tests before adding this plan's new cases.

- [x] **Step 4: Run AWM gates from the configured CLI project root**

```bash
cd cli
node dist/src/index.js preflight --cwd .
node dist/src/index.js sensors run
node dist/src/index.js context-budget --cwd ..
```

Expected: preflight is ready; enabled sensors pass or report an explicitly accepted baseline; context budget is within the committed limit or has a reviewed decision.

- [x] **Step 5: Review the final diff and requirement preservation**

```bash
git diff --check origin/main...HEAD
git status --short
git diff --stat origin/main...HEAD
git diff --name-status origin/main...HEAD -- docs/plans docs/research docs/harness-retros.md
```

Expected: no whitespace errors, no uncommitted files, no harness-evidence moves, and only intended code/documentation changes.

- [x] **Step 6: Commit any verification-only corrections**

```bash
git add README.md docs cli/src cli/tests
git commit -m "test: verify AWM documentation onboarding contract"
```

Skip the commit if verification required no correction.

## Traceability matrix

| Requirement | Task(s) | Verification |
|---|---:|---|
| R1 | T2, T3, T10 | `active documentation contract › has one reachable active editorial set` |
| R2 | T2, T3, T9 | T9 canonical-English manual review of every active allowlisted file |
| R3 | T2, T5, T6, T10 | `active documentation contract › documents the two-stage boundary` |
| R4 | T5, T8, T10 | OS headings plus T8 audit against `.github/workflows/ci.yml`; link/active-doc suite |
| R5 | T2, T5, T8, T10 | `active documentation contract › documents every init provider and option`; provider structural suites |
| R6 | T5, T7, T10 | Configuration content assertions plus CLI help for `agent list/disable` |
| R7 | T1, T5, T10 | unit `defers local-only baseline bundles`; isolated Copilot machine-only no-write E2E |
| R8 | T2, T5, T6, T10 | `active documentation contract › documents ... official bundle scopes` |
| R9 | T5, T6, T7, T10 | configuration/project link tests plus CLI help for `registry add` |
| R10 | T6, T10 | manual scenario review in `project-setup.md` plus active-doc reachability/link test |
| R11 | T2, T3, T4, T10 | framework reachability assertion and T9 full editorial review |
| R12 | T2, T4, T5, T7, T8, T9 | canonical-topic assertion; generated matrix and duplicate-heading audit |
| R13 | T9, T10 | exact `git diff --name-status` preservation check with two-file allowlist |
| R14.1 | T2, T9, T10 | relative-link and anchor test |
| R14.2 | T2, T5, T7, T10 | provider/flag assertions and compiled CLI help invocations |
| R14.3 | T8, T10 | `support-matrix-is-current.test.ts` after `npm run docs:matrix` |
| R14.4 | T2, T3, T6, T9, T10 | active editorial reachability test |
| R15 | T1, T5, T6, T7, T8, T9, T10 | Copilot deferred-detail assertion and explicit troubleshooting review |
| R16.1 | T4, T9, T10 | `git diff --summary` rename check and `git log --follow` |
| R16.2 | T4, T9, T10 | active relative-link and anchor test after rename |

## Analyze gate

- Forward coverage: every requirement has at least one implementation task and a claim-specific verification.
- Backward coverage: every task traces to one or more requirements; no implementation task is orphan scope.
- UI propagation: not applicable; this plan adds no screen or interactive visual surface.
- Serial fallback: intrinsic; no parallel tracks are declared.

## CI prerequisite

The failed post-merge Windows job on commit `87816da` is an independent existing-state issue. Its exact failing test must be recovered from GitHub Actions and reproduced before any remediation plan is written. Do not add a speculative Windows change to this implementation. Execute the focused CI remediation plan first when that diagnosis is available, or rebase this branch onto the verified green main commit before final QA.
