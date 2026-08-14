# R3 compatible and empirical sensor coverage

## Requirements

### Compatibility contract

- **R1.1** — THE first-party sensor-pack contract SHALL declare per-sensor variants with stable IDs, applicability conditions, operational requirements, certified version ranges, commands, assets, formatter, and a bounded compatibility probe.
- **R1.2** — THE contract SHALL distinguish a tool version that can operate from a tool version that AWM has certified with reproducible evidence.
- **R1.3** — WHEN a tool or runtime is newer than the certified range but satisfies the declared capability probe, THE resolver SHALL classify it as `compatible-unverified` and SHALL NOT classify it as certified.
- **R1.4** — WHEN a legacy or custom pack lacks compatibility metadata, THE resolver SHALL preserve its current operational behavior as `compatible-unverified` and SHALL NOT claim certified coverage.
- **R1.5** — IF two variants match with equal precedence, THEN THE resolver SHALL fail with an actionable ambiguity error naming the pack, sensor, and variants.
- **R1.6** — IF compatibility metadata is malformed or references an undeclared asset, command, formatter, or probe, THEN THE parser SHALL fail loudly with the source path and invalid field.
- **R1.7** — THE compatibility model SHALL keep pack, sensor, variant, and defect-class identifiers stable across operating systems and patch releases.

### Resolution and materialization

- **R2.1** — WHEN AWM resolves a sensor, THE resolver SHALL inspect only local project evidence: stack markers, project configuration, package-manager metadata, runtime version, installed tool version, and declared capabilities.
- **R2.2** — THE resolver SHALL return exactly one state from `certified`, `compatible-unverified`, `incompatible`, `missing-tool`, `unverifiable`, or `not-applicable`, with structured evidence and reason codes.
- **R2.3** — WHEN `awm sensors init` selects a variant, THE command SHALL record the selection and evidence in manifest schema v2 and SHALL materialize only that variant's declared AWM-owned assets.
- **R2.4** — WHEN `awm sensors init` encounters an existing user-owned or modified configuration, THE command SHALL preserve it, SHALL NOT overwrite it, and SHALL report the resulting native, adapted, or unverifiable state.
- **R2.5** — IF a previous AWM variant left an asset that the new variant no longer uses, THEN THE `awm sensors init` command SHALL report it as orphaned and SHALL NOT delete it automatically.
- **R2.6** — WHEN `init`, `status`, `preflight`, `run`, or `coverage` evaluates a configured sensor, THE command SHALL use the same central resolver and SHALL revalidate live evidence rather than trusting a stale manifest result.
- **R2.7** — IF package-manager declarations or lockfiles conflict, THEN THE resolver SHALL return `unverifiable` with an actionable conflict reason rather than guessing a command runner.
- **R2.8** — THE resolver and probes SHALL use structured argument vectors, SHALL NOT invoke a shell, SHALL NOT install or download dependencies, SHALL NOT use the network, and SHALL NOT mutate project files.

### Honest static coverage

- **R3.1** — WHEN at least one R2 detector maps to a `certified` sensor variant and satisfies its declared evidence, THE static coverage evaluator SHALL classify that defect class as covered.
- **R3.2** — IF every matching detector is `compatible-unverified` or `unverifiable`, THEN THE static evaluator SHALL report coverage as unverifiable and SHALL NOT emit a green certified result.
- **R3.3** — IF every matching detector is `incompatible` or `missing-tool`, THEN THE static evaluator SHALL report a gap with the compatibility reason and suggested read-only remedy.
- **R3.4** — WHEN a sensor is irrelevant to the detected project capabilities, THE resolver SHALL return `not-applicable` and the static evaluator SHALL exclude it from the applicable denominator without treating absence as success.
- **R3.5** — IF empirical evidence exists for a defect class whose detector was declared `not-applicable`, THEN THE report SHALL emit `applicability-contradiction`.
- **R3.6** — THE existing top-level `overall` field SHALL retain the R2 static meaning; empirical evidence SHALL NOT silently change its value or command exit behavior.
- **R3.7** — WHEN a defect class has multiple detectors, THE static evaluator SHALL apply the precedence `certified` over `coverage-unverifiable`, `coverage-unverifiable` over `gap`, and `gap` over `not-applicable`.

### First-party pack certification

- **R4.1** — THE R3 release SHALL migrate and certify the first-party `js-ts`, `python`, `shell`, and `generic` packs under the version-aware contract.
- **R4.2** — WHERE a project uses ESLint, THE `js-ts` pack SHALL resolve separately certified variants for ESLint 8 eslintrc, ESLint 8 flat config, ESLint 9, and ESLint 10.
- **R4.3** — WHERE a project uses TypeScript, THE normal typecheck sensor SHALL honor the project's effective TypeScript configuration; `tsconfig.awm.json` SHALL be an explicit hardening opt-in and SHALL NOT be copied or activated silently.
- **R4.4** — WHERE a JavaScript project does not contain TypeScript capability, THE TypeScript sensor SHALL be `not-applicable` rather than missing or covered.
- **R4.5** — WHERE a JavaScript package manager is identifiable, THE `js-ts` pack SHALL select a local execution form for npm, pnpm, Yarn, or Bun without downloading tools.
- **R4.6** — THE `js-ts` pack SHALL resolve Prettier, dependency-cruiser, Stryker, test scripts, and Semgrep against their local tool, runtime, command, and configuration capabilities.
- **R4.7** — THE `python` pack SHALL resolve Python environment and version plus mypy, Ruff, pytest, and Semgrep against native project configuration where available.
- **R4.8** — THE `shell` pack SHALL resolve ShellCheck locally, and all packs that expose Semgrep SHALL use one shared compatibility policy rather than divergent copies.
- **R4.9** — THE `generic` pack SHALL represent only capabilities it can actually detect and SHALL report all other reference coverage as inapplicable or inconclusive, never vacuously covered.
- **R4.10** — THE pack policy SHALL prefer native project configuration, MAY add a compatible AWM baseline adapter, and SHALL reserve stricter migrations for explicit hardening opt-in.

### Empirical coverage

- **R5.1** — WHEN `awm sensors coverage` runs, THE command SHALL read finding entries from all active and archived project ledgers and SHALL exclude `polarity: win` from defect-gap analysis.
- **R5.2** — WHERE a new finding's reusable defect class is known, THE ledger CLI SHALL accept optional `--defect-class <stable-id>` and SHALL persist it without changing the validity of older entries.
- **R5.3** — IF a historical finding lacks `defectClass`, THEN THE analyzer SHALL classify it as `unclassified` and SHALL NOT infer a class from `desc`, `signature`, or other free text.
- **R5.4** — WHEN findings share a `defectClass`, THE analyzer SHALL cluster only within that class using the existing deterministic exact-signature and convergent-cluster semantics.
- **R5.5** — THE empirical report SHALL preserve occurrence counts, cluster kind, sorted signatures, evidence references, maximum severity, and single-versus-recurrent status without exposing unrelated ledger content.
- **R5.6** — WHEN `--min` is omitted, THE analyzer SHALL use `2`; WHEN `--min` is valid, THE analyzer SHALL use it only for ordering and recurrence emphasis and SHALL keep lower-count findings visible.
- **R5.7** — IF `--min` is non-integer, non-finite, or less than one, THEN THE command SHALL fail loudly before reading or rendering evidence.
- **R5.8** — THE empirical section SHALL return exactly one analysis status from `evidence`, `no-evidence`, `partial`, or `inconclusive`, including skipped-entry counts and reason codes when evidence is incomplete.
- **R5.9** — WHEN an empirical defect class crosses static coverage, THE command SHALL classify it as `covered-by-sensor`, `gap`, `coverage-unverifiable`, `applicability-contradiction`, or `unmapped-class` according to the resolved sensor state.
- **R5.10** — THE empirical analysis SHALL be deterministic, read-only, provider-neutral, and independent of an LLM.
- **R5.11** — IF `--defect-class` is not a lowercase kebab-case identifier, THEN THE ledger CLI SHALL reject the new entry before writing it.
- **R5.12** — IF a persisted `defectClass` violates the lowercase kebab-case grammar, THEN THE empirical analyzer SHALL skip that historical entry and report an explicit malformed-evidence reason.

### Lifecycle placement

- **R6.1** — WHEN `awm sensors init` runs, THE harness SHALL resolve and materialize compatible variants as part of explicit project sensor configuration.
- **R6.2** — WHEN `awm preflight` or the planning gate validates sensors, THE harness SHALL resolve required compatibility and SHALL block false certification while preserving actionable degraded states.
- **R6.3** — WHEN `awm sensors run` starts, THE harness SHALL re-resolve each selected variant before execution and SHALL NOT execute a known incompatible command.
- **R6.4** — AFTER post-implementation QA succeeds and BEFORE ledger archival, THE `harness-retro` skill SHALL invoke the complete `awm sensors coverage` analysis exactly once for the current project state.
- **R6.5** — WHILE retro runs interactively, THE harness SHALL present empirical gaps for human remedy selection; WHILE retro runs unattended, THE harness SHALL apply only its existing authorized triage rules and SHALL preserve unresolved recommendations as evidence.
- **R6.6** — THE full empirical analysis SHALL remain manually available through `awm sensors coverage`, `awm sensors coverage --json`, and `awm sensors coverage --min <count>`.
- **R6.7** — THE QA phase SHALL NOT run the full empirical analysis while the ledger is still accumulating; compatibility checks MAY run there through normal sensor execution.

### Versioning and delivery

- **R7.1** — THE first-party `pack.json` contract SHALL use top-level schema version 2 for variant and compatibility metadata while accepting packs without that field as legacy and unverified.
- **R7.2** — THE project sensor manifest SHALL use schema version 2 for structured commands, selected variant, and compatibility evidence, while accepting and explicitly migrating legacy manifests during `awm sensors init`.
- **R7.3** — THE coverage JSON envelope SHALL use schema version 2 because compatibility and applicability extend the public vocabulary, while preserving the meaning of every existing R2 static field.
- **R7.4** — THE nested `coverage.schemaVersion: 1` class catalog SHALL remain unchanged because R3 changes detector resolution and report evidence rather than the generic class/remedy contract.
- **R7.5** — IF a consumer supplies an unknown manifest, pack, or coverage-envelope schema version, THEN THE AWM CLI SHALL fail with the supported versions and migration action rather than reinterpret it.
- **R7.6** — THE public breaking contract SHALL ship as the next AWM major release, expected to be `7.0.0`, and SHALL include an explicit migration note.
- **R7.7** — THE work SHALL remain one R3 implementation plan delivered through coordinated CLI and baseline-registry pull requests; issue #70 SHALL be resolved as part of issue #20 rather than through an independent plan.
- **R7.8** — THE CLI compatibility consumer SHALL land before the registry publishes v2 packs, and the final end-to-end acceptance SHALL run against the published CLI and a pinned registry tag.

### Security, robustness, and bounded operation

- **R8.1** — THE analyzer SHALL bound ledger file count, per-file bytes, entry count, JSON nesting, and rendered evidence size, and SHALL report truncation as partial or inconclusive rather than silent success.
- **R8.2** — IF a ledger or pack path escapes its declared project or registry root, including through a symbolic link, THEN THE AWM CLI SHALL reject it and SHALL NOT read the external target.
- **R8.3** — THE renderer SHALL treat descriptions, signatures, references, versions, paths, and probe output as untrusted data and SHALL serialize them without terminal or JSON injection.
- **R8.4** — IF a bounded probe cannot reach a conclusive result, THEN THE resolver SHALL return `unverifiable`; elapsed time alone SHALL NOT certify or reject the underlying project sensor.
- **R8.5** — THE new public resolver, parser, analyzer, and renderer functions SHALL validate their inputs and fail explicitly on invalid or impossible states.

### Certification and documentation

- **R9.1** — THE resolver SHALL have exhaustive controlled tests for every state and precedence branch on Linux, macOS, and native Windows.
- **R9.2** — THE first-party packs SHALL have real-tool boundary certification for minimum, current, and representative future versions, plus native-config and package-manager fixtures, without requiring a full Cartesian matrix.
- **R9.3** — THE CLI SHALL test active and archived ledgers, malformed entries, unclassified findings, recurrence thresholds, applicability contradictions, deterministic human and JSON output, and a before/after hash proving read-only analysis.
- **R9.4** — THE registry SHALL validate variant overlap, referenced assets, real command availability, stable IDs, generic defect classes, and generated support evidence.
- **R10.1** — WHEN R3 changes public behavior, THE implementation SHALL update the single canonical owner in the documentation information architecture and SHALL NOT create a duplicate guide.
- **R10.2** — THE functional framework guide SHALL explain static coverage, empirical coverage, compatibility certification, and the retro feedback loop independently of CLI internals.
- **R10.3** — THE configuration guide and registry pack-author guide SHALL document v2 variants, custom and legacy packs, future-version behavior, migration, probes, ranges, assets, and the native/baseline/hardening levels.
- **R10.4** — THE project-setup guide SHALL explain version-aware stack selection for greenfield and legacy projects and SHALL distinguish automatic baseline behavior from explicit hardening.
- **R10.5** — THE runbook SHALL document automatic retro placement, manual coverage use, compatibility drift, upgrades, orphaned assets, and actionable troubleshooting.
- **R10.6** — THE CLI reference SHALL document exact flags, states, exit behavior, schema v2, and migration; THE support matrix SHALL be generated from production manifests rather than maintained by hand.
- **R10.7** — THE architecture and testing documents SHALL explain the resolver boundary, CLI/registry ownership, probe security model, data flow, and certification matrix.
- **R10.8** — THE decisions log and changelog SHALL record the durable compatibility, false-green, schema, retro-placement, and major-release decisions.
- **R10.9** — WHEN documentation validation runs, THE repository SHALL compare documented flags with the compiled CLI registrations.
- **R10.10** — WHEN documentation validation runs, THE repository SHALL parse schema examples with the production parsers.
- **R10.11** — WHEN documentation validation runs, THE repository SHALL generate the support matrix from registry manifests and SHALL reject a hand-edited drift.
- **R10.12** — WHEN documentation validation runs, THE repository SHALL validate active-document links, anchors, and reachability from `README.md` or `docs/README.md`.
- **R10.13** — WHEN end-to-end evidence is produced, THE repository SHALL cross-check the exact registry tag consumed by the published CLI.
- **R10.14** — WHEN active editorial documentation changes, THE repository SHALL enforce English as its canonical language.

## Context and problem

R2 answers which generic defect classes appear to have a detector in a project. Its current evidence is structural: configured command fragments and referenced files. That is insufficient when the command or copied configuration is incompatible with the project's actual tool version. A configured ESLint sensor can therefore appear covered while its ESLint 8, 9, or 10 runtime cannot load the selected configuration. TypeScript currently exposes the inverse problem: `tsconfig.awm.json` may be copied but the default command does not consume it, and forcing its strict options onto a legacy codebase would be a migration rather than a safe sensor default.

Issue [#70](https://github.com/Kodria/agentic-workflow/issues/70) records these concrete ESLint and TypeScript symptoms. R3 absorbs that work because empirical coverage is only useful if the static side of the cross is trustworthy. Treating compatibility as a separate release would allow R3 to automate false conclusions.

R3 therefore has one outcome: turn sensor coverage into an evidence loop that understands the project's effective toolchain. Static evidence says what is demonstrably covered now; historical ledger evidence says what reviewers still find manually; the cross identifies where a detector is absent, incompatible, uncertain, or wrongly considered inapplicable.

## Goals and non-goals

R3 will:

- make compatibility a shared executable contract used by sensor initialization, inspection, preflight, execution, and coverage;
- certify all four official packs against bounded version and operating-system evidence;
- extend the R2 report with deterministic empirical analysis over project ledgers;
- integrate the complete report into the retrospective feedback loop; and
- update the functional, operational, reference, architecture, testing, decision, and release documentation as part of the same work.

R3 will not:

- install tools or change dependency versions;
- replace or rewrite a project's native lint, type, test, or security policy;
- infer reusable defect classes from reviewer prose;
- mutate sensors from `awm sensors coverage`;
- introduce remote telemetry, LLM classification, or a hosted service;
- implement an organizational sensor-policy floor; or
- add new stacks beyond the four existing first-party packs.

## Architecture

```text
project evidence + pack contract
              |
              v
     compatibility resolver
     - stack and capability
     - tool/runtime version
     - native project config
     - bounded local probe
              |
              v
       effective sensor state
 certified | compatible-unverified | incompatible
 missing-tool | unverifiable | not-applicable
              |
              v
      trustworthy R2 static coverage
              |
project active + archived ledgers
              |
              v
 deterministic empirical analysis
              |
              v
 static/empirical cross + retro signal
```

The baseline registry owns declarative facts: pack and sensor IDs, variants, operational requirements, certified ranges, commands, assets, formatters, probes, generic defect classes, and remedies. The CLI owns interpretation: schema parsing, evidence discovery, precedence, state resolution, materialization, live revalidation, static evaluation, empirical analysis, rendering, and exit behavior. A registry does not embed executable JavaScript, and the CLI does not hard-code first-party tool versions.

One central resolver serves `init`, `status`, `preflight`, `run`, and `coverage`. Command-specific callers decide what to do with the result, but cannot redefine compatibility. The manifest stores the selected variant and evidence for traceability; it is never the sole source of truth because installed tools and project configuration can drift after initialization.

## Compatibility contract

Each v2 sensor declares one or more variants. A variant contains:

- a stable variant ID;
- applicability signals and precedence;
- runtime and tool requirements;
- certified ranges separate from operational compatibility;
- default and changed-file commands as argument vectors;
- the exact AWM-owned assets it consumes;
- formatter identity; and
- a bounded local probe definition.

The parser rejects unknown schema versions, malformed ranges, undeclared assets, unsupported probe forms, and overlapping variants with equal precedence. A deterministic specificity order chooses one variant. Explicit project evidence outranks heuristic detection; native configuration outranks an AWM adapter; exact certified range outranks capability-only compatibility. If evidence remains tied, the resolver reports ambiguity rather than choosing by array order.

Compatibility is capability-first and version-informed. Versions select known boundaries efficiently, while the probe confirms that required capabilities and configuration can load. A future version inside no certified range may still operate as `compatible-unverified` after a successful probe. It cannot become `certified` until reproducible registry evidence expands the range. A legacy/custom pack without v2 metadata remains runnable under its existing command, but its coverage is explicitly unverifiable.

Probes are introspection, not project verification. They may inspect versions, resolve local binaries, parse local metadata, and ask a tool to load or print effective configuration through a bounded argv invocation. They cannot invoke a shell, fetch packages, install dependencies, write files, or access the network. A probe that exceeds its output or execution bound becomes `unverifiable`; it does not establish that the actual sensor failed.

## Resolution and project configuration

The resolver builds normalized evidence from the project root and selected registry pack. It detects operating system, stack capability, runtime, package manager, local tool, native configuration, and manifest history. Every result contains the state, selected variant when one exists, normalized versions, evidence source, and machine-readable reason codes. Rendering is separate from resolution.

`awm sensors init` is the only R3 path that materializes pack assets. It records manifest schema v2 and copies only assets referenced by the selected variant. It never overwrites a user-owned or modified config. Files created by a former AWM variant but no longer referenced are reported as orphaned for explicit owner action; automatic deletion would cross a destructive boundary.

Configuration has three deliberate levels:

1. **Native project behavior** — use the project's own effective configuration and scripts whenever they provide the required detector.
2. **Compatible AWM baseline** — add a narrowly scoped adapter or rule set that the resolved toolchain can load without redefining the project.
3. **Hardening opt-in** — stricter type, lint, mutation, or security policy that may require project migration and is never silently activated.

`status`, `preflight`, `run`, and `coverage` recalculate compatibility. If the live result differs from the manifest, they report drift and the explicit remediation path. `run` refuses a known incompatible command; `coverage` remains read-only and reports the corresponding gap or uncertainty.

## First-party pack migration

All official packs move together so R3 does not create one truthful stack and three version-blind ones.

The `js-ts` lint sensor distinguishes ESLint 8 eslintrc, ESLint 8 flat config, ESLint 9, and ESLint 10. Project-native configuration is preferred. The package manager is selected from `packageManager` and lockfiles for npm, pnpm, Yarn, or Bun; conflicts are unverifiable. Prettier, dependency-cruiser, Stryker, test scripts, and Semgrep resolve their real local commands and configuration. TypeScript typecheck uses the project's effective tsconfig. The existing `tsconfig.awm.json` is reclassified as hardening opt-in instead of a silently copied baseline asset.

The `python` pack resolves the active Python environment and version and locally installed mypy, Ruff, pytest, and Semgrep. It honors native `pyproject.toml` and tool-specific configuration before considering an adapter. The `shell` pack resolves local ShellCheck. Semgrep uses one shared resolver policy wherever a pack exposes it. The `generic` pack declares only universally detectable capabilities and reports the remainder honestly.

Applicability is explicit. A JavaScript-only project does not acquire a TypeScript gap merely because the pack can support TypeScript. Conversely, a later manual TypeScript finding contradicts that applicability decision and becomes visible rather than being discarded.

When more than one detector can cover a defect class, their aggregate precedence is deterministic: one certified detector covers the class; otherwise any compatible-unverified or unverifiable detector makes coverage unverifiable; otherwise any applicable missing or incompatible detector produces a gap; only a set composed entirely of inapplicable detectors produces `not-applicable`.

## Empirical analysis and report

`awm sensors coverage` reads every active and archived project ledger within bounded roots. Only `polarity: finding` participates. Syntactically or structurally invalid entries are skipped under the existing tolerant ledger policy, but the output includes counts and reason codes; incomplete evidence produces `partial` or `inconclusive`, never silent green.

New ledger entries may carry `defectClass`, an optional lowercase kebab-case stable ID aligned with the generic class catalog. The add command rejects an invalid ID. Historical entries remain valid when the field is absent; an invalid persisted field is skipped and counted as malformed evidence. Missing IDs are reported as `unclassified`; free text is not a safe deterministic taxonomy and is never used to invent the value. Clustering reuses the current exact-signature and convergent semantics, but never crosses defect-class boundaries.

The empirical block reports all observed classes and clusters. `--min 2` is the default emphasis threshold fixed by D-015. Counts below it remain visible; the threshold only separates recurrent evidence from single observations and controls ordering/highlighting. The cross with live static coverage yields:

| Empirical evidence and live static state | Result |
|---|---|
| certified detector | `covered-by-sensor` |
| detector missing, incompatible, or tool missing | `gap` |
| detector or legacy pack unverified | `coverage-unverifiable` |
| sensor declared inapplicable | `applicability-contradiction` |
| defect class absent from the pack catalog | `unmapped-class` |
| historical entry without `defectClass` | `unclassified` |

The top-level `overall` field keeps its R2 static meaning and exit behavior. R3 adds empirical evidence as a signal, not a gate. The JSON output is normalized and stably sorted; human output includes the same conclusions, short evidence references, and read-only remedies without printing arbitrary ledger descriptions or project secrets.

## Lifecycle integration

Compatibility resolution happens automatically at the cheapest correct boundary:

1. `awm sensors init` resolves and materializes the project configuration.
2. `awm preflight` and the planning gate validate compatibility before unattended execution.
3. `awm sensors run` revalidates immediately before executing a command.
4. Post-implementation QA runs the configured sensors but does not run the full empirical analysis while findings are still accumulating.
5. `harness-retro` runs `awm sensors coverage` once after QA and before archiving the ledger, then uses the report as another triage input.

Interactive retro presents gaps for a human decision. Unattended retro does not introduce new authority: it uses the existing severity, recurrence, generic-versus-project-specific, and remediation rules, and preserves recommendations it cannot safely apply. The coverage command itself never mutates configuration, satisfying D-014. Manual use remains available at any point through the normal, JSON, and `--min` variants.

## Public schemas and compatibility

Three public boundaries carry explicit versions:

1. A first-party `pack.json` uses top-level `schemaVersion: 2` for variants, structured commands, assets, requirements, and probes. A pack without the field is legacy.
2. A project `.awm/sensors.json` uses `schemaVersion: 2` for the selected variant, a structured local command, and initialization evidence. A manifest without the field is legacy.
3. `awm sensors coverage --json` emits envelope `schemaVersion: 2` because applicability and compatibility extend the report vocabulary and the `empirical` section becomes concrete.

The nested pack reference `coverage.schemaVersion: 1` remains intact. Its stable class IDs, generic descriptions, detector relationships, and read-only remedies do not change; R3 changes how a detector is resolved and how its evidence is reported.

The v2 coverage envelope retains `pack`, `registry`, `overall`, and `static`. Existing R2 static meanings remain stable. A detector gains a sanitized compatibility object; class status gains `not-applicable`; and `empirical` has a defined shape:

```text
CoverageEnvelopeV2
├── schemaVersion: 2
├── pack: string | null
├── registry: string | null
├── overall: covered | gaps | inconclusive
├── static
│   ├── status: covered | gaps | inconclusive
│   ├── reason: null | not_configured | no_reference
│   └── classes[]
│       ├── id, description
│       ├── status: covered | missing | unverifiable | not-applicable
│       ├── detectors[]
│       │   ├── sensor
│       │   ├── status: covered | missing | disabled | ineffective |
│       │   │           unverifiable | not-applicable
│       │   ├── compatibility
│       │   │   ├── state, reason, variantId
│       │   │   ├── toolVersion, runtimeVersion, certifiedRange
│       │   │   └── evidence[]
│       │   └── evidence[]
│       └── remedy
└── empirical
    ├── status: evidence | no-evidence | partial | inconclusive
    ├── min: positive integer
    ├── sources
    │   ├── activeFiles, archivedFiles, validFindings, skippedFindings
    │   └── skippedByReason
    ├── classes[]
    │   ├── defectClass, outcome, occurrences, recurrent, maxSeverity
    │   ├── staticClassId, clusters[], evidenceRefs[]
    │   └── remedy
    └── unclassified
        ├── occurrences
        └── evidenceRefs[]
```

Compatibility evidence exposes normalized versions, relative paths, probe kinds, and reason codes, never full commands, marker values, configuration contents, environment values, or raw probe output. Empirical classes sort by recurrence emphasis, descending occurrence count, then class ID. Clusters retain the existing deterministic order: descending count, convergent before exact, then representative signature. References are sanitized, deduplicated, bounded, and sorted.

Legacy manifests and v1 custom packs are accepted in explicit degraded state. `awm sensors init` migrates a legacy project only after resolving its current environment and preserving user configuration. Unknown future schema versions fail loudly. Because the JSON contract is public, R3 ships as a major AWM release, expected `7.0.0`, with a migration guide and changelog entry.

## Security and failure model

Certification fails closed while operation degrades explicitly. Missing tools, unsupported versions, inconclusive probes, configuration drift, malformed contracts, and ambiguous variants each have distinct reason codes and remedies. None can become covered through absence of evidence.

File discovery is confined to the project, registry, and declared ledger roots. Symlinks are resolved and rejected if they escape those roots. The analyzer bounds file count, bytes, entry count, nesting, and rendered evidence. Ledger and probe strings are untrusted and are safely serialized. Probes use argv without a shell, network, package installation, or mutation. Public functions validate inputs and reject non-finite thresholds, unknown enums, impossible state combinations, and malformed paths.

## Verification and certification strategy

CLI unit tests exercise every resolver state, precedence rule, drift path, schema migration, malformed input, and renderer branch using isolated temporary projects. Empirical fixtures cover active and archived ledgers, wins, malformed lines, missing classes, exact and convergent clusters, thresholds, contradictions, sorting, output bounds, and a before/after project hash proving the command is read-only.

Registry contract tests validate schemas, stable identifiers, range overlap, asset references, generic class boundaries, and commands. Real-tool certification uses boundary representatives rather than an unbounded Cartesian product: minimum certified, current certified, and representative future versions, native configuration cases, and package-manager cases. The resolver's controlled suite runs across Linux, macOS, and native Windows; real-tool coverage is deepest on Linux with targeted smoke evidence on the other two systems. Every support claim records whether it is certified, compatible-unverified, unsupported, or not applicable.

End-to-end acceptance pins the published CLI and exact registry tag, initializes representative new and legacy projects, verifies live status/preflight/run/coverage behavior, completes a retro before archive, and reproduces the sanitized empirical fixture with its hash and command.

## Documentation contract

Documentation is part of each implementation task's definition of done. Public behavior is not complete until its canonical owner is updated:

| Subject | Canonical owner |
|---|---|
| Framework meaning, static/empirical quality loop, retro feedback | `docs/framework.md` |
| Custom packs, legacy behavior, variants, future versions, v2 migration | `docs/configuration.md` |
| Stack/version selection, greenfield/legacy setup, hardening opt-in | `docs/project-setup.md` |
| Automatic retro, manual commands, drift, upgrades, troubleshooting | `docs/runbook.md` |
| Exact flags, states, exits, JSON schema v2 | `docs/cli-reference.md` |
| Generated pack/tool/version/OS evidence | `docs/support-matrix.md` |
| Resolver, CLI/registry boundary, probes, data flow | `docs/architecture.md` |
| Certification policy and matrices | `docs/testing/` |
| Durable product and compatibility decisions | `docs/decisions.md` |
| Breaking change and migration summary | `CHANGELOG.md` |

`README.md` and `docs/README.md` change only if navigation needs a new link; they do not repeat the guide. In the baseline registry, `sensor-packs/README.md` is the canonical pack-author reference and covers the formal v2 schema, examples, probes, assets, migration, legacy packs, custom packs, and future-version rules. The CLI configuration guide links there instead of duplicating it. The registry changelog records the pack contract release.

Freshness is enforced: CLI flags are checked against compiled registration; schema examples are parsed by production parsers; the support matrix is generated from manifests; active-document links, anchors, language, and hub reachability are validated; and end-to-end evidence cross-checks the exact registry tag. Plans, research, ledgers, and harness-produced artifacts retain their contractual locations and are not reorganized.

## Delivery sequence

R3 is one implementation plan spanning two repositories and normally produces two coordinated pull requests:

1. Land the backward-compatible CLI consumer: v2 parser, central resolver, manifest migration, command integration, empirical analysis, schema v2 rendering, tests, and CLI-owned documentation.
2. Publish the CLI major release so the registry can depend on a real consumer contract.
3. Migrate all first-party packs and `harness-retro` in the baseline registry, including pack-author documentation and certification evidence.
4. Run end-to-end acceptance using the published CLI and pinned registry tag; fix either repository under the same R3 plan.
5. Update issue #20 with delivery evidence and close issue #70 as resolved by R3.

This sequence avoids publishing v2 content before a consumer can interpret it. It does not split compatibility into a separate roadmap item or plan.

## Decision traceability

- D-013 remains the ownership rule for reference coverage inside each pack.
- D-014 remains the mutation boundary: coverage reports and recommends; only explicit configuration commands materialize assets.
- D-015 resolves DA-5 at a default threshold of two while preserving single findings.
- Issue #70 supplies the concrete ESLint/TypeScript compatibility evidence and is absorbed into R3.
- The documentation information architecture in `2026-08-13-documentation-information-architecture-design.md` defines every canonical documentation owner and the no-move boundary for harness artifacts.
- No UI screens are introduced; the user surface is CLI output and documentation.
