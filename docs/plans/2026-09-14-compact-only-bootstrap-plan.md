# Compact-only Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> to implement this plan. Execute the single slice with TDD, specification review,
> code-quality review, and all closure gates.

**Goal:** Remove the self-hosting blocker for compact-only planning by accepting canonical dotted requirement IDs and making unmarked plans fail closed as `migration-required`.

**Architecture:** Keep `compact-slices/v1` backward compatible. Split requirement-ID validation from internal entity-ID validation, preserve the current five Markdown subsection names, and replace only the plan-domain `legacy` report with an explicit migration state and exit 2. The validator remains read-only and provider-neutral.

**Tech Stack:** Node.js 24 for local verification (package contract remains Node.js >=22), TypeScript 5.9, Commander 14, Jest 30.

**Modo de ejecución:** desatendido

This is a one-time bootstrap plan. Its temporary hyphen-only requirement IDs exist because
the pre-change CLI cannot validate the canonical dotted IDs that this slice enables. The
mapping is exact: `BOOT-ID-GRAMMAR` maps to `RF-1.3`, `BOOT-V1-COMPAT` maps to `RF-1.4`,
`BOOT-MIGRATION-STATE` and `BOOT-CLI-OUTPUT` map to `RF-2.1`, and
`BOOT-ROBUSTNESS` maps to `RNF-T.2`. After this slice passes every gate, all newly authored
plans use the canonical IDs directly; there is no permanent translation layer.

---

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-126-compact-only-bootstrap",
  "requirements": [
    "BOOT-ID-GRAMMAR",
    "BOOT-V1-COMPAT",
    "BOOT-MIGRATION-STATE",
    "BOOT-CLI-OUTPUT",
    "BOOT-ROBUSTNESS"
  ],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-09-14-compact-only-unattended-execution-design.md",
      "locator": "### Bootstrap CLI plan — `agentic-workflow`",
      "fact": "Approved one-slice self-hosting boundary and exact mapping to canonical requirements"
    },
    {
      "id": "SRC-VALIDATOR",
      "path": "cli/src/core/plan/validate.ts",
      "locator": "export function validatePlanFile(planPath: string",
      "fact": "Stable validator entry point for requirement and internal-entity grammar and plan classification"
    },
    {
      "id": "SRC-TYPES",
      "path": "cli/src/core/plan/types.ts",
      "locator": "export type PlanValidationReport =",
      "fact": "Stable public plan-validation union changed by the bootstrap migration state"
    },
    {
      "id": "SRC-COMMAND",
      "path": "cli/src/commands/plan/index.ts",
      "locator": "export function exitCodeFor(report: PlanValidationReport)",
      "fact": "Stable command boundary for semantic validation exit codes and report rendering"
    },
    {
      "id": "SRC-CORE-TEST",
      "path": "cli/tests/core/plan/validate.test.ts",
      "locator": "describe('validatePlanFile',",
      "fact": "Core validator regression suite for grammar, classification, containment, and read-only behavior"
    },
    {
      "id": "SRC-COMMAND-TEST",
      "path": "cli/tests/commands/plan/index.test.ts",
      "locator": "describe('plan validate Commander wiring'",
      "fact": "Command regression suite for human and JSON output, safety, and exit status"
    }
  ],
  "commands": [
    {
      "id": "CMD-FOCUSED",
      "program": "npm",
      "args": [
        "--prefix",
        "cli",
        "test",
        "--",
        "--runInBand",
        "tests/core/plan/validate.test.ts",
        "tests/commands/plan/index.test.ts"
      ],
      "covers": [
        "BOOT-ID-GRAMMAR",
        "BOOT-V1-COMPAT",
        "BOOT-MIGRATION-STATE",
        "BOOT-CLI-OUTPUT",
        "BOOT-ROBUSTNESS"
      ]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["BOOT-MIGRATION-STATE", "BOOT-CLI-OUTPUT"]
    },
    {
      "id": "CMD-BUILD",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "build"],
      "covers": ["BOOT-ID-GRAMMAR", "BOOT-MIGRATION-STATE", "BOOT-CLI-OUTPUT"]
    },
    {
      "id": "CMD-DEPCHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "depcheck"],
      "covers": []
    },
    {
      "id": "CMD-FULL",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand"],
      "covers": []
    },
    {
      "id": "CMD-SENSORS",
      "program": "awm",
      "args": ["sensors", "run"],
      "covers": []
    },
    {
      "id": "CMD-DIFF",
      "program": "git",
      "args": ["diff", "--check"],
      "covers": []
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Enable canonical IDs and fail-closed migration",
      "requirements": [
        "BOOT-ID-GRAMMAR",
        "BOOT-V1-COMPAT",
        "BOOT-MIGRATION-STATE",
        "BOOT-CLI-OUTPUT",
        "BOOT-ROBUSTNESS"
      ],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": [
        "SRC-DESIGN",
        "SRC-VALIDATOR",
        "SRC-TYPES",
        "SRC-COMMAND",
        "SRC-CORE-TEST",
        "SRC-COMMAND-TEST"
      ],
      "redCommands": ["CMD-FOCUSED"],
      "greenCommands": ["CMD-FOCUSED", "CMD-TYPECHECK", "CMD-BUILD"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "bounded",
      "fallback": [
        "Revert the slice as one unit if existing valid compact-slices/v1 plans stop validating or any unmarked plan can still exit successfully"
      ]
    }
  ],
  "closureCommands": ["CMD-DEPCHECK", "CMD-FULL", "CMD-SENSORS", "CMD-DIFF"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Enable canonical IDs and fail-closed migration

#### Surfaces

Modify `cli/src/core/plan/validate.ts`, `cli/src/core/plan/types.ts`, and
`cli/src/commands/plan/index.ts`. Extend `cli/tests/core/plan/validate.test.ts` and
`cli/tests/commands/plan/index.test.ts`. Do not modify the schema identifier, the five
required v1 Markdown subsection names, plan execution skills, journal behavior, provider
adapters, or any unrelated domain that also uses the word legacy.

#### Implementation

- [ ] In `cli/tests/core/plan/validate.test.ts`, first replace the unmarked-plan expectation
  with `{ state: 'migration-required', reason: 'unmarked-plan' }`. Add table-driven valid
  requirement cases for `RF-1.3`, `RNF-T.2`, and the existing `R4-VAL-2`; add invalid cases
  for leading/trailing/adjacent dots, lowercase, whitespace, path separators, non-ASCII,
  control bytes, and an ASCII ID longer than 64 bytes. Prove a dotted source, command, or
  slice ID remains invalid so the change cannot expand internal entity identifiers.
- [ ] Add a regression that enumerates every tracked Markdown file under `docs/plans/`
  containing the `AWM:COMPACT-SLICES:START v1` marker and asserts that every plan which is
  valid before the production change remains valid afterward. Record the exact fixture
  count in the test failure message so accidentally testing zero plans fails loudly. Do not
  rewrite historical plans.
- [ ] In `cli/tests/commands/plan/index.test.ts`, replace the legacy report fixture with
  `{ state: 'migration-required', reason: 'unmarked-plan' }`. Assert deterministic human
  output, stable JSON containing `state`, `path`, and `reason`, exit 2, and the absence of
  any message that offers an executable alternative. Keep the existing write-before-exit
  ordering assertion and include the new state in the public exit-code table.
- [ ] Run `CMD-FOCUSED` and capture RED failures for the dotted requirements, the core
  migration state, human/JSON command output, and exit status before changing production
  code. If any new assertion passes against the old behavior, tighten it before proceeding.
- [ ] In `cli/src/core/plan/validate.ts`, retain the current internal entity grammar as
  `ENTITY_ID`. Add a separate ASCII-only `REQUIREMENT_ID` capped at 64 total characters
  that accepts one or more non-empty dot-separated segments while retaining safe existing
  hyphenated IDs. Apply it only to top-level requirements and requirement references;
  `validId` must continue validating source, command, and slice IDs with `ENTITY_ID`.
- [ ] In `cli/src/core/plan/types.ts`, replace `{ state: 'legacy' }` in
  `PlanValidationReport` with exactly
  `{ state: 'migration-required'; reason: 'unmarked-plan' }`. In
  `validatePlanFile`, return that state only when no compact marker/schema signal exists.
  Preserve byte-for-byte read-only behavior and all existing invalid/unsupported
  classifications.
- [ ] In `cli/src/commands/plan/index.ts`, render `migration-required` in human and JSON
  modes with bounded terminal-safe fields and migration-only guidance. `exitCodeFor` returns
  0 only for `valid`; `migration-required`, `invalid`, and `unsupported` return 2. Remove
  only the plan validator's full-quality-path language.
- [ ] Run `CMD-FOCUSED`, `CMD-TYPECHECK`, and `CMD-BUILD`. After the build, create one
  temporary unmarked Markdown file inside the worktree, invoke
  `cli/dist/src/index.js plan validate` against it in human and JSON modes, and verify both
  commands exit 2, the JSON parses, neither output offers execution, and the input hash is
  unchanged. Remove only that temporary fixture after recording the evidence.
- [ ] Run specification review against the five bootstrap mappings and the approved design,
  fix every finding, then run code-quality review over the complete slice diff and fix every
  finding. Repeat focused tests after each correction and commit the bounded implementation
  with `fix(plan): require compact migration (#126)`.

#### Edge cases

The total 64-character bound applies to a complete requirement ID rather than independently
to each dotted segment. Empty segments, leading or trailing dots, lowercase, Unicode,
whitespace, control bytes, and path syntax are rejected. Existing hyphen-only requirements
and all already-valid v1 plan headings remain accepted. Marker-like malformed or future
schema input remains `invalid` or `unsupported`, never `migration-required`. The migration
state applies only to plan validation; sensor, journal, bundle, and dashboard compatibility
states are outside this slice.

#### Evidence

RED evidence consists of focused Jest failures proving the old validator rejects dotted
requirements and admits unmarked input with exit 0. GREEN evidence consists of the same
focused suites, TypeScript compilation, the tracked-plan v1 regression, and compiled CLI
human/JSON negative controls. The compiled check also records the unmarked file hash before
and after validation. Specification and code-quality reviews must each produce a clean
verdict after fixes; test success alone does not replace either review.

#### Fallback

If separating entity and requirement grammars reveals a previously valid requirement that
the new bounded expression rejects, add that observed safe form to an explicit regression
and adjust only `REQUIREMENT_ID`; do not relax `ENTITY_ID`, the ASCII constraint, or the
total bound. If command rendering cannot preserve its stable JSON boundary, keep the payload
minimal (`state`, `path`, `reason`) and route human guidance only through `formatReport`.
Any failure that lets unmarked input exit 0 or invalidates an existing valid v1 plan reverts
the complete slice and blocks authoring the two main R1 plans.

## Traceability matrix

| Bootstrap requirement | Canonical requirement | Owner | Direct verification |
|---|---|---|---|
| `BOOT-ID-GRAMMAR` | `RF-1.3` | S1 | dotted/hyphenated valid table, adversarial invalid table, focused suite, compiled build |
| `BOOT-V1-COMPAT` | `RF-1.4` | S1 | all tracked previously valid v1 plans remain valid; subsection vocabulary unchanged |
| `BOOT-MIGRATION-STATE` | `RF-2.1` | S1 | core unmarked classification and public exit-code assertions |
| `BOOT-CLI-OUTPUT` | `RF-2.1` | S1 | exact human/JSON assertions and compiled CLI negative control |
| `BOOT-ROBUSTNESS` | `RNF-T.2` | S1 | 64-byte ASCII bound, adversarial inputs, byte-for-byte read-only check |

Forward coverage: all five temporary bootstrap requirements have exactly one owner and at
least one behavioral verification command. Backward coverage: every production file and
test named in the slice traces to the grammar, compatibility, migration, output, or
robustness contract. No requirement from the main R1 implementation is silently pulled into
this bootstrap.

## Closure gates

After S1 is committed and both reviews are clean, run `CMD-DEPCHECK`, `CMD-FULL`,
`CMD-SENSORS`, and `CMD-DIFF`. Continue through `post-implementation-qa`,
`post-implementation-docs`, `harness-retro`, `verification-before-completion`, and
`finishing-a-development-branch` as routed by `development-process`. The bootstrap is
complete only when all gates pass and the compiled CLI validates new plans containing
canonical dotted IDs while rejecting unmarked input with exit 2.

Do not publish a release from this bootstrap alone. Its verified CLI behavior unlocks the
two canonical R1 plans; cross-repository publication remains governed by the approved design.

## Planning amendment record

Before the S1 dispatch, the controller found that five original manifest locators would be
deleted by the required production and test edits. Source locators were reanchored to stable
declarations/suite headings, and their facts were made valid across the before/after state.
The exact pre-change behavior remains specified in S1 and its RED checks. This is a
plan-validity correction only: no requirement, surface, role, command, or gate was removed.
The controller must revalidate this amended plan before dispatch and after the slice.
