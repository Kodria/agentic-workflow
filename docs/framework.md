# How AWM works

AWM is an engineering framework, not an autonomous code generator. Humans own
intent and consequential decisions; agents perform bounded work; the harness
enforces deterministic controls and records reviewable evidence.

## The problem AWM solves

An AI coding agent can produce code quickly and describe it confidently. That
does not make a change correct, complete, secure, or reviewable. AWM supplies
the structure that turns an agent interaction into an engineering process:

| Risk | AWM response |
|---|---|
| An incomplete need becomes invented requirements | Product discovery and a readiness gate make decisions explicit. |
| A long session loses a constraint | Context, constitution, and durable state re-anchor the work. |
| An agent declares success without proof | Sensors and verification commands produce independent evidence. |
| A team repeats the same failure | Ledger findings and retrospectives turn recurrence into a rule or check. |
| One reviewer confirms its own assumptions | Focused reviews and deterministic gates use independent criteria. |

## The control model: human, agents, harness

```text
Human: intent, priority, trade-offs, approval
                 │
                 ▼
Agents: discovery, design, planning, bounded execution, review
                 │
                 ▼
Harness: context, sensors, preflight, evidence, transactions, learning
```

The human is not removed from the process. AWM moves human effort toward
describing the need, deciding trade-offs, and evaluating evidence rather than
typing every implementation detail. Agents may accelerate execution, but cannot
override a gate or silently make a consequential product decision.

## Valid entry points

AWM does not force every piece of work through the same starting point.

### Raw idea or business need

Use the [product process](guides/product-process.md) when the team needs to
discover the problem, decisions, constraints, and outcome before development.

### Certified product brief

A ready brief is the hand-off into the development process. It avoids answering
business questions ad hoc while someone is already changing code.

### Concrete feature, bug, or refactor

Start with the [development process](guides/development-process.md) when the
requirement is sufficiently concrete. For an incomplete support issue, gather
evidence first and return to discovery where decisions remain open.

### Existing implementation plan

An approved plan can be executed directly, with its verification steps and
quality gates still in force.

## The complete lifecycle

### 1. Need and product discovery

Product discovery turns a raw request into a shared understanding of the
problem. It is conditional: a concrete, accepted requirement does not need to
repeat it.

### 2. Brief and readiness

A product brief captures intent, scope, decisions, risks, and acceptance
criteria. Readiness verifies that development has a coherent baton to receive.

### 3. Solution design

Architecture, non-functional requirements, and UI design are selected when the
change needs them. UI design is optional and applies to a real screen or user
experience—not to every code change.

### 4. Traceable planning

The implementation plan maps the requirement to files, tests, commands,
sequencing, and acceptance evidence. It is the contract for bounded execution.

### 5. Bounded execution

A controller coordinates focused agents or a serial workflow. Each task has a
defined ownership boundary, follows the plan, and reports evidence rather than
an unqualified claim of completion.

### 6. Sensors and quality gates

Sensors run real commands—such as type checking, linting, tests, security
scanning, and dependency analysis—against the project. `awm preflight` confirms
that the configured gate is actually runnable before it is trusted.

### Static coverage, empirical coverage, and learning

**Static coverage** compares the sensors declared by a project with the defect
classes its selected pack says should be detected. It answers “is the intended
control present?” without running commands or changing the repository.
**Empirical coverage** then reads bounded, sanitized ledger evidence to answer
whether recurring classified findings are actually being caught. Neither result
pretends that an unknown tool version is a clean pass: compatibility must be
certified, compatible-unverified, or explicitly inconclusive.

The retrospective feedback loop consumes those two views before archival. A
repeated class that lacks a credible detector becomes a candidate for a pack,
process rule, or focused guidance; a single finding remains evidence, not an
automatic new policy. This is how AWM improves controls without turning every
project-specific incident into a universal rule.

### 7. Review, verification, and PR

Review checks implementation fidelity and independent quality concerns.
Verification repeats the relevant commands. The branch is completed only when
the required evidence is available and the pull request represents a coherent,
reviewable change.

### 8. Ledger and harness learning

Findings are recorded on disk. A retrospective identifies recurring failures
and promotes them into a sensor, a process rule, or focused guidance where
appropriate.

## Flexible phases and mandatory gates

Discovery, detailed design, and visual design are intentionally flexible. A
well-defined bug can begin in development; a new product idea should not skip
the decisions that make it buildable.

Security, robustness, verification, and evidence gates are not optional. A
feature may be out of scope; input validation, safe failure behavior, and a
truthful verification result are not. A missing tool or incomplete check is not
reported as a clean pass.

## Components

### CLI

The AWM CLI installs and reconciles registries, bundles, profiles, provider
artifacts, sensors, and diagnostics. It keeps machine preparation distinct from
project setup. See [Architecture](architecture.md) for implementation details.

### Skills and orchestrators

Skills encode process, craft, and gate discipline. Product and development
orchestrators route work by the maturity of the starting need; specialist skills
apply only when their domain is relevant.

### Controllers and subagents

A controller maintains the plan and decision context. Focused subagents own
small, independent work boundaries, which makes parallel work reviewable rather
than a collection of overlapping edits.

### Registries and bundles

Registries distribute versioned skills, workflows, agent profiles, and sensor
packs. The official baseline includes `dev` and `product`; `frontend` and
`authoring` are project extensions. Teams can extend these through their own
registries without modifying the CLI.

### Provider adapters

Provider adapters render the same framework content into each agent's supported
format. Capability tiers describe the actual level of hooks, managed context, or
project-only delivery. They do not promise false parity.

### Project context and constitution

`AGENTS.md`, `CLAUDE.md`, `CONSTITUTION.md`, and `.awm/profile.json` define the
shared operating contract and its provider-specific delivery. They make the
constraints durable across sessions and team members.

### Sensors, preflight, and evidence

Sensors are executable checks; preflight verifies their configuration; test and
review outputs are evidence. A legacy baseline can accept existing debt while
blocking new findings, so adoption does not require pretending the repository
was already clean.

### Transactions, backups, and recovery

AWM plans filesystem changes and protects user-owned content with backups. A
failed initialization should fail loudly and leave an actionable recovery path,
not a partially explained state.

## Artifacts produced across the lifecycle

| Stage | Typical artifact | Why it matters |
|---|---|---|
| Product | Discovery record and brief | Makes intent and decisions reviewable. |
| Readiness and design | Acceptance criteria, architecture, NFRs, UI design where needed | Gives development a bounded target. |
| Planning | File-level implementation plan | Connects the change to proof. |
| Execution | Source, tests, and focused findings | Records the work actually performed. |
| Quality | Sensor output, reviews, verification | Separates evidence from assertion. |
| Learning | Ledger entries and retrospective | Improves the next cycle. |

## Adoption cases

### New project

Prepare the machine, initialize the repository, and establish sensors and the
shared contract from the first change.

### New business capability

Use discovery and a brief to turn business language into scope, acceptance
criteria, and a development-ready hand-off.

### Incomplete support bug

Begin with evidence: reproduce, inspect the affected path, state uncertainty,
and make only the decisions the evidence supports.

### Legacy system change

Use the existing architecture and safety constraints as inputs. Baseline known
sensor debt when necessary, then make future work ratchet quality upward.

## What AWM guarantees — and what it does not

AWM guarantees a disciplined process: explicit boundaries, reproducible
configuration, deterministic checks where the stack supports them, and durable
evidence of what was run and decided.

It cannot guarantee that an LLM reasons correctly, that a requirement is
complete, or that a human accepts the right trade-off. Those remain decisions
for the people responsible for the product and its operation.

## Where to go next

- [Install AWM and prepare a machine](installation.md)
- [Configure providers and registries](configuration.md)
- [Initialize a project](project-setup.md)
- [Operate the framework](runbook.md)
- [Read the generated support matrix](support-matrix.md)
