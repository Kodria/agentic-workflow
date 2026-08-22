# Design — `awm doctor` dashboard and impact evidence (#86, #87)

- **Date:** 2026-08-22
- **Branch:** `feat/issues-86-87-doctor-dashboard`
- **Issues:** [#86](https://github.com/Kodria/agentic-workflow/issues/86), [#87](https://github.com/Kodria/agentic-workflow/issues/87)
- **Delivery:** two sequential releases on one surface: configuration dashboard first, historical impact evidence second

## Requirements

### Command and compatibility

- **R1.1** THE CLI SHALL preserve the current behavior, output, exit semantics, and JSON shape of `awm doctor` and `awm doctor --json`.
- **R1.2** WHEN `awm doctor --full` is invoked, THE CLI SHALL render the complete machine and project snapshot in the terminal without changing the existing JSON contract.
- **R1.3** WHEN `awm doctor --html <path>` is invoked, THE CLI SHALL produce one static, self-contained HTML file at `<path>` and SHALL imply the complete snapshot.
- **R1.4** WHERE HTML output is selected, THE CLI SHALL accept `--force` only to replace an existing regular file.
- **R1.5** IF `--json` is combined with `--full`, `--html`, or `--force`, THEN THE CLI SHALL reject the invocation with exit code 2 and an actionable usage error.
- **R1.6** IF `--full` is combined with `--html`, THEN THE CLI SHALL reject the redundant invocation with exit code 2.
- **R1.7** IF `--force` is used without `--html`, THEN THE CLI SHALL reject the invocation with exit code 2.

### Configuration snapshot and rendering (#86)

- **R2.1** THE dashboard SHALL derive terminal and HTML output from one validated, versioned `DashboardSnapshotV1` contract.
- **R2.2** THE dashboard SHALL report current machine configuration: installed agents and versions, tiers, hooks, skills, registries, and pins.
- **R2.3** WHILE a project is detected, THE dashboard SHALL report profile, active bundles, context files, constitution, sensor manifest, sensor coverage, drift, and preflight readiness.
- **R2.4** WHILE no project is detected, THE dashboard SHALL render a healthy machine-only view with a neutral `No project detected` state and SHALL omit project, plan, journal, ledger, and evidence collection.
- **R2.5** THE absence of a project SHALL NOT degrade machine health or alter the exit code that machine findings imply.
- **R2.6** THE dashboard SHALL classify each diagnostic item as `ok`, `attention`, `missing`, `unavailable`, or `not_applicable`.
- **R2.7** WHEN an item is `attention`, `missing`, or `unavailable`, THE dashboard SHALL show a non-empty exact remediation command from a canonical finding-ID-to-command mapping.
- **R2.8** IF no verified corrective command exists for a proposed item, THEN THE collector SHALL omit that item from the actionable findings instead of inventing remediation prose.
- **R2.9** WHEN an optional source is absent or malformed, THE dashboard SHALL mark only its owning section `unavailable`, degrade the snapshot, and show the exact command that regenerates or diagnoses that source.
- **R2.10** IF snapshot validation, central diagnostic collection, or sanitization fails, THEN THE CLI SHALL abort with exit code 2 and SHALL NOT create or replace the HTML target.

### Safe HTML artifact

- **R3.1** THE HTML artifact SHALL contain all CSS and display assets inline and SHALL require no server, JavaScript, remote font, remote image, or network request at viewing time.
- **R3.2** THE HTML artifact SHALL include a restrictive CSP that blocks scripts, connections, frames, forms, remote resources, and base-URL rewriting while permitting only its inline styles and data images.
- **R3.3** THE renderer SHALL HTML-escape every dynamic value before interpolation.
- **R3.4** THE share-safe snapshot SHALL exclude absolute paths, usernames, environment values, secret-like values, raw command output, raw ledger descriptions, and raw error stacks.
- **R3.5** THE HTML SHALL use semantic headings, landmarks, tables/lists, visible focus, WCAG AA contrast, print styles, and text or icons in addition to color for every state.
- **R3.6** THE HTML SHALL remain legible on a 1600-pixel projected desktop viewport and on narrow viewports without hiding observations.
- **R3.7** THE rendering order SHALL be deterministic for the same sanitized snapshot.

### Safe path handling and read-only behavior

- **R4.1** IF the `--html` path is absent, empty, or another flag token, THEN THE CLI SHALL reject it with exit code 2 before collection begins.
- **R4.2** IF the HTML target is a directory, symlink, or non-regular existing path, THEN THE CLI SHALL reject it with exit code 2.
- **R4.3** IF the HTML target already exists and `--force` is absent, THEN THE CLI SHALL preserve it byte-for-byte and exit with code 2.
- **R4.4** WHEN HTML is written, THE CLI SHALL write an adjacent temporary regular file, fsync/close it, and atomically rename it to the validated target.
- **R4.5** IF HTML generation or writing fails, THEN THE CLI SHALL remove its temporary file, preserve any previous target, and exit with code 2.
- **R4.6** THE dashboard collection path SHALL NOT modify project files, preferences, journal state, ledger state, Git state, or machine configuration.
- **R4.7** THE only filesystem mutation permitted by `--html` SHALL be the requested target and its short-lived adjacent temporary file.
- **R4.8** THE CLI SHALL return exit code 0 for a generated healthy dashboard, 1 for a generated degraded dashboard, and 2 for invalid invocation, collection failure, sanitization failure, or write failure.
- **R4.9** WHEN the HTML target is relative, THE CLI SHALL resolve it against the invocation working directory; WHEN it is absolute, THE CLI SHALL use that path unchanged.
- **R4.10** IF the HTML target parent does not exist or is not writable, THEN THE CLI SHALL fail with exit code 2 and SHALL NOT create parent directories.
- **R4.11** WHEN HTML is written on a POSIX platform, THE CLI SHALL create the replacement file with mode `0600` regardless of the mode of a target replaced with `--force`.
- **R4.12** WHEN HTML is written on Windows, THE CLI SHALL create a regular file using the parent directory's effective ACL and SHALL NOT attempt to emulate POSIX mode bits.

### Lifecycle information architecture

- **R5.1** THE project dashboard SHALL render sections in this order: Machine/install, Project readiness, Design/planning, Execution, QA, Retro, Final/history.
- **R5.2** THE Machine/install section SHALL answer what is installed, at which versions and tiers, and whether hooks, registries, skills, and pins are coherent.
- **R5.3** THE Project readiness section SHALL answer whether the profile, bundles, context, constitution, sensors, coverage, drift, and preflight permit trustworthy work.
- **R5.4** THE Design/planning section SHALL show the active design or plan, execution mode, requirement count, task/checklist progress, and explicit plan state.
- **R5.5** THE Execution section SHALL show cycle state, next action, task states, attempts, jobs, and sanitized blockers.
- **R5.6** THE QA section SHALL show aggregated finding counts, resolved counts, verification state, and gate state without raw finding text.
- **R5.7** THE Retro section SHALL show recurrence signatures as opaque categories, cure state, and the amount of subsequent observation without raw ledger descriptions.
- **R5.8** THE Final/history section SHALL show every eligible sanitized cycle and plan observation, including duration, retry count, QA counts, first-pass status, and cure efficacy where measurable.
- **R5.9** THE dashboard SHALL NOT compute an AWM score, person ranking, repository ranking, or cross-repository aggregate.

### Historical impact evidence (#87)

- **R6.1** THE evidence panel SHALL treat one completed AWM cycle as its primary observation unit and SHALL attach optional PR metadata only when locally available.
- **R6.2** THE panel SHALL display all eligible sanitized observations; confidence thresholds SHALL qualify conclusions and SHALL NOT hide underlying rows.
- **R6.3** THE panel SHALL report QA findings per cycle and, when PR metadata exists, per PR.
- **R6.4** THE panel SHALL report retry count per task as `max(recorded attempts - 1, 0)` and SHALL show the cycle total.
- **R6.5** THE panel SHALL report whether every required gate passed on its first recorded evaluation for each cycle.
- **R6.6** THE panel SHALL report recurring finding signatures that were cured and whether each signature appeared in a later eligible cycle.
- **R6.7** THE panel SHALL report work plans and one explicit state from `active`, `blocked`, `qa_pending`, `retro_pending`, `executed`, or `legacy_unverifiable`.
- **R6.8** WHILE zero eligible completed cycles exist, THE panel SHALL render an honest empty state and SHALL NOT fabricate a trend, percentage, or improvement claim.
- **R6.9** WHILE one eligible completed cycle exists, THE panel SHALL label aggregate conclusions `provisional`; WHILE two to four exist, it SHALL label them `observing`; WHILE five or more exist, it SHALL label them `supported`.
- **R6.10** WHEN a cure has zero later eligible cycles, THE panel SHALL label it `awaiting_observation`; WHEN it has one or two later cycles without recurrence, it SHALL label it `observing`; WHEN it has at least three later cycles without recurrence, it SHALL label it `supported`; WHEN it recurs later, it SHALL label it `recurred`.
- **R6.11** THE evidence implementation SHALL remain local, offline-capable, and scoped to one repository without any hosted service or person-level identity.

### Durable evidence capture and plan state

- **R7.1** WHEN `harness-retro` completes cures for a cycle and before it archives the ledger, THE workflow SHALL automatically persist one validated `CycleEvidenceV1` observation.
- **R7.2** THE capture SHALL write `.awm/evidence/cycles/<cycle-id>.json`, where `<cycle-id>` is an opaque SHA-256 digest of the repository identity, repo-relative plan path, and cycle start timestamp.
- **R7.3** WHEN the same cycle is captured again, THE capture SHALL deterministically replace the same observation rather than append a duplicate.
- **R7.4** THE evidence write SHALL use validation, an adjacent temporary file, and atomic rename.
- **R7.5** THE stored observation SHALL contain counts, states, timestamps, opaque signatures, and optional host-agnostic PR reference; it SHALL NOT contain usernames, absolute paths, raw ledger descriptions, prompts, logs, or secrets.
- **R7.6** WHILE a journal cycle is present, THE journal SHALL be authoritative for `active` and `blocked` plan states.
- **R7.7** WHEN all plan tasks are complete and `awm-qa-complete` is absent, THE plan state SHALL be `qa_pending`.
- **R7.8** WHEN `awm-qa-complete` is present and `awm-retro-complete` is absent, THE plan state SHALL be `retro_pending`.
- **R7.9** WHEN `awm-retro-complete` is present, THE plan state SHALL be `executed`.
- **R7.10** IF a historical plan lacks enough modern journal or marker evidence to classify it, THEN its state SHALL be `legacy_unverifiable`.

### Release and verification

- **R8.1** THE configuration dashboard release SHALL ship before the historical evidence release.
- **R8.2** THE existing `awm doctor --json` contract SHALL be frozen by regression fixtures before adding new renderers.
- **R8.3** THE implementation SHALL cover machine-only, healthy project, degraded project, partial source, corrupt source, hostile dynamic text, long histories, and large task-count fixtures.
- **R8.4** THE implementation SHALL verify that dashboard collection leaves the tree byte-for-byte unchanged except for an explicitly requested HTML target.
- **R8.5** THE implementation SHALL use TDD, including a demonstrated fail/pass/revert-fail/restore-pass cycle for each regression boundary.
- **R8.6** THE coordinated registry release SHALL declare and enforce the minimum published CLI version that supports `CycleEvidenceV1` before `harness-retro` invokes capture.
- **R8.7** THE final end-to-end acceptance SHALL run only against published immutable CLI and registry artifacts on Linux, macOS, and Windows.

## Scope and delivery sequence

The two issues share a visual surface but answer different questions and therefore ship separately:

1. **Release A — issue #86:** aggregate current structured diagnostics into `DashboardSnapshotV1`; add `--full`, `--html`, and `--force`; ship terminal and HTML renderers while freezing existing JSON.
2. **Release B — issue #87:** introduce `CycleEvidenceV1`, automatic local capture, plan history classification, impact calculations, and the evidence panel.
3. **Registry follow-up:** after the supporting CLI is published, update `awm-baseline-registry` with the minimum CLI compatibility and the `harness-retro` capture step.
4. **Published acceptance:** validate the complete flow using released artifacts only.

Release B depends on Release A. The registry cannot call the new capture contract until the compatible CLI version is public.

## Architecture

### Chosen approach

Use one canonical snapshot with pure renderers and no frontend framework or template dependency:

```text
existing structured sources
        │
        ▼
read-only source adapters ──► sanitizer ──► DashboardSnapshotV1 validator
                                               │
                         ┌─────────────────────┴─────────────────────┐
                         ▼                                           ▼
                  full terminal renderer                 self-contained HTML renderer

Release B additions:
harness-retro ──► CycleEvidenceV1 files ──► evidence/plan adapters ──► same snapshot
```

The current `awm doctor --json` path stays outside this new snapshot pipeline. This is deliberate: new renderers may evolve through a versioned dashboard contract without silently changing the existing automation contract.

### Components and boundaries

| Component | Responsibility | I/O boundary |
|---|---|---|
| Configuration adapters | Consume existing doctor, agent, registry, pin, preflight, sensor-status, and sensor-coverage structures | Read-only environment/project probes |
| Plan adapter | Parse `docs/plans` markers and task checkboxes; overlay active journal authority | Read-only project files |
| Evidence adapter | Validate and load every local `CycleEvidenceV1` observation | Read-only `.awm/evidence/cycles` |
| Sanitizer | Remove sensitive fields and normalize safe display values before rendering | Pure transform |
| Snapshot validator | Validate version, enums, remediation commands, ordering keys, and section invariants | Pure validation |
| Terminal renderer | Render the complete snapshot for `--full` | Pure string renderer |
| HTML renderer | Render semantic, escaped, CSP-protected static HTML | Pure string renderer |
| Atomic HTML writer | Validate target and perform the only requested filesystem mutation | Target path only |
| Evidence capture command | Derive a sanitized observation from journal, plan, gates, and ledger aggregates | Atomic local evidence file |
| `harness-retro` integration | Invoke capture after cures and before archive | Registry skill orchestration |

No renderer reads files or invokes commands. No adapter emits markup. This separation keeps privacy, determinism, and rendering testable without a real machine setup.

## Contracts

### `DashboardSnapshotV1`

The snapshot is a discriminated, versioned object with:

- `schema: 1`, generation timestamp, overall state, project detection state, and confidence label;
- ordered sections containing sanitized items, status, short detail, and canonical remediation command when non-ok;
- optional active plan/execution/QA/retro summaries;
- complete sanitized plan history and evidence observations;
- source availability metadata so missing data is distinguishable from a healthy zero.

Validation invariants:

- every public builder rejects invalid input with an explicit error;
- every actionable non-ok item has a non-empty command and stable finding ID;
- `not_applicable` is neutral and never carries a remediation;
- raw source payloads cannot cross the sanitizer boundary;
- ordering uses stable IDs/timestamps, never filesystem enumeration order;
- HTML and full terminal render from exactly the same snapshot instance.

### `CycleEvidenceV1`

Each observation stores only the minimum durable facts needed by issue #87:

- schema version, opaque cycle ID, start/end timestamps, duration, and terminal cycle state;
- repo-relative opaque plan reference and classified plan state;
- task count, per-task attempts/retries, jobs, and sanitized blocker count;
- QA finding/fix counts grouped by severity or opaque signature, never descriptions;
- required gate count, first-evaluation results, and first-pass boolean;
- cure signatures, cure timestamp, and later recurrence facts;
- optional PR number/provider kind without repository or person identity.

The record is local operational evidence, not a telemetry event. It is ignored by Git under `.awm/` and never uploaded by the dashboard.

## Information architecture and value by phase

| Phase | What is rendered | Decision it enables | Empty/unavailable behavior |
|---|---|---|---|
| Machine/install | Agents, tiers, versions, hooks, skills, registries, pins | “Can this machine run AWM coherently?” | Missing configuration includes its exact setup/update command |
| Project readiness | Profile, bundles, context, constitution, sensors, coverage, drift, preflight | “Is this repository ready for governed work?” | Outside a project: neutral `No project detected`; corrupt optional source: section unavailable |
| Design/planning | Active artifact, mode, requirements, tasks, plan state | “What was agreed and how far is the plan?” | No active plan is neutral; historical plans remain visible |
| Execution | Cycle, next action, tasks, attempts, jobs, blockers | “What is happening now and where is work stuck?” | No journal: unavailable or inactive, never inferred as successful |
| QA | Finding/fix counts, verification and gates | “Was quality evidence produced and closed?” | Missing QA marker yields `qa_pending`, not zero findings |
| Retro | Recurrences, cures, observation window | “Did the harness learn from failures?” | Cure without later cycles is `awaiting_observation` |
| Final/history | All plans/cycles, duration, retries, QA, first-pass, cure efficacy | “Is the method producing better outcomes over time?” | No history shows an honest empty state; all eligible rows remain visible |

The page intentionally avoids a composite score. It presents evidence and confidence, leaving judgment to the reader.

## UI Screens

| Screen | Description | Device | Status | Artifacts |
|---|---|---|---|---|
| Machine-only configuration dashboard | Self-contained projected view outside any project: machine/install health, exact remediation commands, neutral no-project state, privacy-safe source availability, and print/share treatment | DESKTOP | completed — Stitch `9aea6868f567454094cc83b59c73d3a4`; residual visual divergence accepted by user on 2026-08-22 | retired post-merge · projects/6188895816624130677 |
| Project lifecycle and impact dashboard | Complete project view with machine readiness followed by planning, execution, QA, retro, and full evidence history; includes honest provisional/observing/supported states and stress-safe dense data | DESKTOP | approved — Stitch `f272908125f54d60a0f81674114461f8` | `.stitch/designs/project-lifecycle-impact-evidence.html` · `.stitch/designs/project-lifecycle-impact-evidence.png` |

These are two states of the same renderer, but both require deliberate visual validation because their information density and empty-state behavior differ materially.

### Stitch design artifacts

- **Project:** `6188895816624130677` (`Doctor Dashboard Impact Evidence`)
- **Design system:** `assets/8247239042793499201` (`AWM Doctor Dashboard`)
- **Machine-only screen:** `.stitch/designs/machine-only-configuration-dashboard.html` and `.stitch/designs/machine-only-configuration-dashboard.png`
- **Project lifecycle screen:** `.stitch/designs/project-lifecycle-impact-evidence.html` and `.stitch/designs/project-lifecycle-impact-evidence.png`
- **Review status:** both screens were rendered in Stitch and approved before artifact download.

## CLI behavior

Supported invocations:

```text
awm doctor
awm doctor --json
awm doctor --full
awm doctor --html <path>
awm doctor --html <path> --force
```

`--html` never opens the artifact automatically. The command prints the final path after a successful atomic write. `--full` writes only to stdout. Existing default and JSON calls remain byte-for-byte contract-compatible except for already nondeterministic environmental values covered by current tests.

## Error handling

Errors are separated into three classes:

1. **Invocation/target errors:** fail before collection, exit 2, no target mutation.
2. **Optional source errors:** isolate the source, render its section unavailable, degrade overall state, include a canonical recovery command, and continue.
3. **Central trust-boundary errors:** snapshot validation, sanitization, core diagnostics, or atomic writing fail closed with exit 2 and no new/replaced artifact.

The implementation never catches an invalid public input merely to return `undefined`, `NaN`, or a partial snapshot. All public boundaries validate and throw explicit typed errors.

## Privacy and security

Share-safe is the default and only v1 export mode. Sanitization occurs before a renderer can observe data. Tests seed absolute paths, usernames, tokens, malicious HTML, ledger prose, command output, and stack traces, then assert none appear in the artifact.

The HTML contains no scripts. The CSP is emitted as a meta policy equivalent to:

```text
default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none';
connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

No cross-repository or person-level aggregation is collected, even locally.

## Testing and acceptance

### Contract and unit tests

- Freeze current `awm doctor` text and JSON behavior before adding flags.
- Validate `DashboardSnapshotV1` and `CycleEvidenceV1`, including unknown versions, invalid enums, unsafe strings, missing commands, invalid dates/counts, and duplicate IDs.
- Test pure terminal and HTML renderers against the same fixtures.
- Test plan-state precedence and every confidence/cure threshold boundary.

### CLI and filesystem tests

- Cover every valid and invalid flag combination.
- Cover missing, empty, flag-shaped, existing, directory, symlink, unwritable, and traversal-like target inputs.
- Verify atomic replacement, cleanup after failure, mode `0600`, and preservation without `--force`.
- Snapshot the tree before/after each dashboard run and permit only the requested HTML target.
- Run machine-only, healthy, degraded, partial, and corrupt-source fixtures.

### Security, accessibility, and stress tests

- Assert complete escaping and absence of injected tags/attributes.
- Assert CSP presence and absence of scripts, remote URLs, and network-capable elements.
- Check semantic landmarks, heading order, keyboard focus, contrast tokens, print CSS, and non-color state labels.
- Exercise long project names, hundreds of tasks/plans/cycles, missing optional fields, and narrow layouts without truncating observations.

### Evidence integration tests

- Capture after cures and before ledger archive.
- Demonstrate idempotent recapture and atomic failure recovery.
- Verify all four impact metrics plus plan-state history.
- Verify recurrence/non-recurrence across later cycles and honest no-history states.
- Verify the registry rejects an unpublished or incompatible CLI version before wiring capture.

### Delivery gates

Implementation follows TDD. Each regression boundary demonstrates fail, pass, revert-to-fail, and restore-to-pass. The feature then passes build, targeted tests, full CLI tests, sensors, preflight, post-implementation QA, harness retro, and published-artifact acceptance on Linux, macOS, and Windows.

## Non-goals

- No local web server, daemon, port, authentication layer, or hosted service.
- No new frontend framework, template engine, chart library, or runtime dependency.
- No change to the existing JSON contract.
- No automatic remediation from `doctor`; commands are shown, not executed.
- No team, person, or cross-repository analytics.
- No raw logs, prompts, ledger descriptions, filesystem paths, usernames, secrets, or error stacks in HTML.
- No artificial score, ranking, hidden observations, or claims unsupported by captured cycles.

## Specialist gate record

- **Architecture:** consulted; shaped the canonical snapshot, trust boundaries, pure renderers, and staged evidence adapter.
- **Technology:** consulted; no new framework or rendering dependency is justified for a static single-file artifact.
- **NFRs:** consulted; privacy, read-only behavior, offline operation, determinism, safe writes, accessibility, and honest missing-data semantics are release-blocking requirements.
