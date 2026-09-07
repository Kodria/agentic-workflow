# Retire `onSignal` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the inert `onSignal` property from AWM's operational bundle model while preserving CLI 9 compatibility for legacy registries and migrating the baseline registry to canonical string references.

**Architecture:** Parse bundle manifests through one strict compatibility boundary that returns canonical `string[]` skills plus bounded diagnostics. Keep resolution and installation provider-neutral, route deprecation output through an injected once-per-command reporter, and ship the baseline cleanup as an independent, order-safe PR.

**Tech Stack:** Node.js 22, TypeScript 5.9, Commander 14, Jest 30, JSON bundle manifests, Node test runner, GitHub Actions.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

---

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-112-retire-onsignal",
  "requirements": ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"],
  "sources": [
    {"id":"SRC-DESIGN","path":"docs/plans/2026-09-07-retire-onsignal-design.md","locator":"## Requirements","fact":"Approved requirements and staged-retirement decision for issue 112"},
    {"id":"SRC-BUNDLES","path":"cli/src/core/bundles.ts","locator":"export interface BundleDefinition","fact":"Current operational model, manifest parser, and multi-root bundle resolver"},
    {"id":"SRC-INSTALL","path":"cli/src/core/bundle-install.ts","locator":"function bundleArtifacts","fact":"Provider-neutral artifact expansion currently consumes only skill names"},
    {"id":"SRC-GUIDE","path":"docs/guides/authoring-a-registry-with-an-orchestrator.md","locator":"bundle.json","fact":"Active registry authoring guide already presents canonical string skill references"},
    {"id":"SRC-PROVIDERS","path":"cli/src/providers/index.ts","locator":"export const AGENT_TARGETS","fact":"Authoritative six-provider target list used by installation and tests"}
  ],
  "commands": [
    {"id":"CMD-BUNDLES","program":"npm","args":["--prefix","cli","test","--","--runInBand","tests/core/bundles.test.ts","tests/core/bundles-multiroot.test.ts","tests/core/bundles-overrides.test.ts"],"covers":["R1","R2","R3"]},
    {"id":"CMD-CONSUMERS","program":"npm","args":["--prefix","cli","test","--","--runInBand","tests/core/bundle-install.test.ts","tests/core/export/resolve.test.ts","tests/core/init/mutation-targets.test.ts","tests/utils/grouping.test.ts","tests/utils/registry-view.test.ts"],"covers":["R4"]},
    {"id":"CMD-CONTRACT","program":"npm","args":["--prefix","cli","test","--","--runInBand","tests/structural/bundle-skill-reference-contract.test.ts"],"covers":["R6","R7"]},
    {"id":"CMD-BASELINE","program":"npm","args":["exec","--","node","--test","../../../.worktrees/baseline-issue-112-retire-onsignal/tests/bundle-skill-reference-contract.test.mjs"],"covers":["R5"]},
    {"id":"CMD-PLATFORMS","program":"npm","args":["--prefix","cli","test","--","--runInBand","tests/commands/sensors/exec-windows.test.ts","tests/commands/sensors/status-windows.test.ts","tests/commands/sensors/changed-windows.test.ts","tests/providers/index.test.ts"],"covers":["R8"]},
    {"id":"CMD-TYPECHECK","program":"npm","args":["--prefix","cli","run","typecheck"],"covers":["R1","R4"]},
    {"id":"CMD-FULL","program":"npm","args":["--prefix","cli","test","--","--runInBand"],"covers":[]},
    {"id":"CMD-SENSORS","program":"awm","args":["sensors","run"],"covers":[]}
  ],
  "slices": [
    {"id":"S1","title":"Canonicalize bundle skill references at discovery","requirements":["R1","R2","R3"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SRC-DESIGN","SRC-BUNDLES"],"redCommands":["CMD-BUNDLES"],"greenCommands":["CMD-BUNDLES","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["Retain the array-returning discovery facade while isolating legacy parsing in a new result-returning helper"]},
    {"id":"S2","title":"Migrate consumers without changing provider artifacts","requirements":["R4"],"dependsOn":["S1"],"sectionAnchor":"slice-s2","sources":["SRC-BUNDLES","SRC-INSTALL","SRC-PROVIDERS"],"redCommands":["CMD-CONSUMERS"],"greenCommands":["CMD-CONSUMERS","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["Use mechanical string migration only and preserve every existing resolver and installer boundary"]},
    {"id":"S3","title":"Publish the compatibility and removal contract","requirements":["R6","R7"],"dependsOn":["S1"],"sectionAnchor":"slice-s3","sources":["SRC-DESIGN","SRC-GUIDE"],"redCommands":["CMD-CONTRACT"],"greenCommands":["CMD-CONTRACT"],"reviewEvidence":["specification","code-quality"],"risk":"bounded","fallback":["Keep historical plans untouched and limit the contract to active authoring documentation and structural tests"]},
    {"id":"S4","title":"Migrate baseline and certify cross-platform closure","requirements":["R5","R8"],"dependsOn":["S2","S3"],"sectionAnchor":"slice-s4","sources":["SRC-DESIGN","SRC-PROVIDERS"],"redCommands":["CMD-BASELINE","CMD-PLATFORMS"],"greenCommands":["CMD-BASELINE","CMD-PLATFORMS"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["Keep the two PRs independent and do not remove CLI 9 legacy parsing if either repository gate is unavailable"]}
  ],
  "closureCommands": ["CMD-FULL", "CMD-SENSORS"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

## Repository layout

The CLI work is isolated at `agentic-workflow/.worktrees/issue-112-retire-onsignal` on `fix/issue-112-retire-onsignal`. The baseline work is isolated at `.worktrees/baseline-issue-112-retire-onsignal` on its own branch with the same name. Neither checkout shares commits, lockfiles, or generated outputs; integration is through the published manifest contract only.

<a id="slice-s1"></a>
### Slice S1: Canonicalize bundle skill references at discovery

#### Surfaces

Modify `cli/src/core/bundles.ts`. Add behavioral coverage to `cli/tests/core/bundles.test.ts`, `cli/tests/core/bundles-multiroot.test.ts`, and `cli/tests/core/bundles-overrides.test.ts`. This slice owns R1-R3.

#### Implementation

- [x] In `bundles.test.ts`, change the canonical expectation to `['brainstorming', 'architecture-advisor']`; add a legacy fixture that captures diagnostics and proves `{name, onSignal}` becomes only the name. Assert one diagnostic for multiple legacy references in one manifest, no control bytes or serialized object contents, a bounded length, canonical replacement syntax, and the `v10` removal boundary.
- [x] Add table-driven RED cases for an absent/non-array `skills`, empty strings, arrays, nulls, objects with empty/non-string `name`, non-boolean `onSignal`, and unknown object keys. Require an explicit error containing the safe manifest identity and `skills[index]`; never accept or silently drop an invalid entry.
- [x] Replace `BundleSkillRef` with `skills: string[]` and introduce the explicit result contract:

```ts
export interface BundleDiscoveryResult {
    bundles: BundleDefinition[];
    diagnostics: string[];
}

export type BundleDiagnosticReporter = (diagnostic: string) => void;
```

- [x] Implement a strict `normalizeSkillRefs(raw, manifestPath)` returning `{ skills, diagnostics }`. Canonical entries are non-empty strings. Legacy objects may contain exactly `name` and optional boolean `onSignal`; increment a per-manifest count, return only `name`, and never echo the object. Sanitize the manifest identity with `sanitizeDiagnosticText`, cap it before interpolation, and emit exactly one migration diagnostic for the manifest.
- [x] Add result-returning `inspectBundles(contentDir)` and `inspectAllBundles(roots = contentRoots())` functions. Preserve the existing array-returning `discoverBundles` and `discoverAllBundles` facades for internal callers, but let them accept an injected reporter and forward each deduplicated diagnostic. The default reporter used by CLI execution must prefix `warning:` and suppress the same diagnostic for repeated discovery passes within one command; tests inject a collector instead of capturing global stderr.
- [x] Extend multi-root and override tests to prove diagnostics survive composition once, and that an overridden bundle contributes only its own canonical skills without reviving metadata from the shadowed definition.
- [x] Run `CMD-BUNDLES` and confirm the new tests fail before production edits, then pass afterward. Run `CMD-TYPECHECK` and commit:

```bash
git add cli/src/core/bundles.ts cli/tests/core/bundles.test.ts cli/tests/core/bundles-multiroot.test.ts cli/tests/core/bundles-overrides.test.ts
git commit -m "fix(bundles): canonicalize legacy skill references (#112)"
```

#### Edge cases

An empty `skills` array is valid; a missing or non-array value is invalid because it crosses an untrusted manifest boundary. Diagnostic text is single-line and bounded before interpolation. Two affected manifests produce two diagnostics; repeated inspection of the same manifest in one command produces one. Legacy `onSignal: false` and `true` are both accepted and ignored through CLI 9.

#### Evidence

The RED run demonstrates that current code retains `onSignal`, silently drops malformed entries, and has no diagnostic. The GREEN run proves canonicalization, strict validation, bounded output, multi-root deduplication, and the unchanged array facade. Revert only the parser/model production hunk and confirm the focused regression fails before restoring it.

#### Fallback

If changing both discovery facades at once creates uncontrolled caller churn, retain their current array return and put the explicit result solely in `inspectBundles`/`inspectAllBundles`; do not retain `onSignal` in `BundleDefinition` and do not emit directly from the parser.

<a id="slice-s2"></a>
### Slice S2: Migrate consumers without changing provider artifacts

#### Surfaces

Modify `cli/src/core/bundle-install.ts`, `cli/src/index.ts`, `cli/src/utils/grouping.ts`, and `cli/src/utils/registry-view.ts`. Mechanically migrate `BundleDefinition` fixtures in all TypeScript tests found by `rg -l 'BundleDefinition|onSignal' cli/tests`. Add equivalence coverage to `cli/tests/core/bundle-install.test.ts` and preserve export/init tests. This slice owns R4.

#### Implementation

- [x] Add a RED differential test that creates canonical and legacy manifests with the same ordered names, discovers each through the compatibility boundary, and compares `expandBundleArtifacts` outputs byte-for-byte for all six values from `AGENT_TARGETS`. Include dependency closure and a duplicate skill name.
- [x] Replace object reads mechanically: `s.name` becomes `s` in `resolveBundleSkills` and `bundleArtifacts`; `bundle.skills.map(sk => sk.name)` becomes `bundle.skills`; grouping and registry-view use the array directly. Do not modify provider renderers, hooks, context strategies, scope selection, or artifact planning.
- [x] Convert production and test constructors from `skills: [{name: 'x', onSignal: false}]` to `skills: ['x']`. Keep object syntax only in the dedicated compatibility tests. Run `rg -n '\\.onSignal|onSignal:' cli/src cli/tests` and require all remaining matches to be the parser, its deprecation message, or explicit legacy tests.
- [x] Update command-level discovery call sites in `cli/src/index.ts`, `cli/src/commands/init.ts`, `cli/src/commands/sync.ts`, `cli/src/commands/registry/add.ts`, `cli/src/commands/registry/index.ts`, `cli/src/commands/registry/install-bundles.ts`, `cli/src/commands/registry/status.ts`, `cli/src/core/diagnostics/context.ts`, `cli/src/core/export/resolve.ts`, and `cli/src/core/reconciliation.ts` to forward one command-scoped reporter or explicitly consume an inspection result. Cache discovery inside actions that currently call it twice so the same manifest warning is not duplicated.
- [x] Add command tests proving one warning on `awm add`, `awm init`, `awm sync`, `awm update`, `awm export`, `awm doctor`, `awm list`, `awm remove`, and registry add/status paths when a legacy fixture is present, and no warning for canonical fixtures. Use injected loggers and isolated homes; do not inspect ANSI-rendered global output where a pure core seam exists.
- [x] Run `CMD-CONSUMERS`, the touched command suites, and `CMD-TYPECHECK`. Commit:

```bash
git add cli/src cli/tests
git commit -m "refactor(bundles): consume canonical skill names (#112)"
```

#### Edge cases

Skill order and dependency-first deduplication remain unchanged. A legacy warning cannot alter exit status, stdout JSON, or generated artifacts. Commands that intentionally do not discover bundles, including machine-only preflight and plan validation, do not scan registries merely to warn. Provider selection is data-driven from `AGENT_TARGETS`; no six-provider switch is added.

#### Evidence

The differential test proves behavior rather than merely compiling the new shape. Existing export, reconciliation, init, grouping, and registry-view tests demonstrate that every downstream path still receives the same names. Injected Windows tests cover path and platform branches; native Windows CI remains the filesystem authority.

#### Fallback

If a command cannot safely expose diagnostics without changing its stable JSON contract, write the warning only to stderr through its existing command-result channel. Never add it to stdout or to the machine-readable payload.

<a id="slice-s3"></a>
### Slice S3: Publish the compatibility and removal contract

#### Surfaces

Modify `docs/guides/authoring-a-registry-with-an-orchestrator.md`. Create `cli/tests/structural/bundle-skill-reference-contract.test.ts`. Do not edit historical plans. This slice owns R6-R7.

#### Implementation

- [ ] Write the structural test first. It must assert that active source exports no `BundleSkillRef`, operational `BundleDefinition.skills` is `string[]`, active docs use string examples, and the guide states that CLI 9 accepts `{ "name": "skill", "onSignal": true }` only for migration and CLI 10 rejects it. Scope source assertions narrowly so unrelated signal-handler functions named `onSignal` remain valid.
- [ ] Run `CMD-CONTRACT` and confirm RED against the missing contract.
- [ ] Add a short compatibility note immediately after the guide's `bundle.json` example. State that strings are canonical, both legacy boolean values are ignored, CLI 9 emits a warning, and CLI 10 removes object support. Do not describe dynamic loading or reserved behavior.
- [ ] Run `CMD-CONTRACT`, parse every JSON fence touched by the edit, and run `git diff --check`. Deliberately replace one canonical string example with a legacy object, confirm the structural test fails with its intended message, then restore it.
- [ ] Commit:

```bash
git add docs/guides/authoring-a-registry-with-an-orchestrator.md cli/tests/structural/bundle-skill-reference-contract.test.ts
git commit -m "docs(bundles): deprecate object skill references (#112)"
```

#### Edge cases

Historical design and plan files retain `onSignal` as provenance and are excluded from the structural assertion. The active guide may mention the token only inside the deprecation note. The test verifies semantic anchors separately rather than using one broad occurrence count.

#### Evidence

The structural test binds model shape, canonical example, compatibility window, and removal boundary to distinct assertions. The deliberate mutation proves that the guard observes the active authoring example rather than passing from unrelated text.

#### Fallback

If wording changes make literal assertions brittle, test stable semantic fragments and parse the guide's JSON block independently; do not weaken the source-model assertion or scan historical plans.

<a id="slice-s4"></a>
### Slice S4: Migrate baseline and certify cross-platform closure

#### Surfaces

Execute the sibling plan `docs/plans/2026-09-07-retire-onsignal-baseline.md` in the baseline worktree. Return to the CLI worktree for integration checks and PR creation. This slice owns R5 and R8.

#### Implementation

- [ ] Execute the baseline plan with TDD, preserving all 24 skill names and their order while converting the ten object references to strings and bumping `dev` from 3.9.3 to 3.9.4 in both manifests.
- [ ] Run `CMD-BASELINE` and the complete baseline validation workflow. Record its commit and create the baseline PR first with title `fix(bundles): retire inert onSignal metadata`; reference `Kodria/agentic-workflow#112` without closing the cross-repository issue.
- [ ] In the CLI worktree, run `CMD-PLATFORMS`, `CMD-TYPECHECK`, `npm --prefix cli run build`, `CMD-FULL`, and `CMD-SENSORS`. Verify `git diff --check` and that `git status --short` contains no generated native build output.
- [ ] Run specification and code-quality reviews per slice, then `post-implementation-qa`, documentation completion, and harness retro. Fix every finding and repeat affected gates.
- [ ] Push the CLI branch and create its PR with title `fix(bundles): retire inert onSignal contract`; include `Closes #112`, the baseline PR URL, RED/GREEN evidence, 3,515-test baseline comparison, and the authoritative Windows/macOS CI requirement.
- [ ] Watch both PRs until all required checks are terminal. Diagnose failures from logs; do not iterate blindly. The objective ends with both PRs open, green, and merge-ready.

#### Edge cases

The PRs are order-independent: old CLI versions accept string manifests, and the new CLI accepts both old and migrated manifests. A baseline tag is created automatically only after merge. Native package completeness is certified by CI because a single machine cannot build every architecture.

#### Evidence

Local Linux tests establish behavior and regression freedom; injected platform tests establish portable logic; GitHub's native Windows and macOS jobs establish filesystem/runtime behavior. Repository search proves no active AWM-owned bundle manifest retains the field. Both PR check summaries are required evidence, not merely successful pushes.

#### Fallback

If either repository's CI reveals a platform-specific defect, keep both compatibility directions intact, diagnose the first failing boundary from logs, and amend the relevant PR. Do not merge or remove CLI 9 compatibility while one repository remains red.

## Traceability matrix

| Requirement | Owner | Direct verification |
|---|---|---|
| R1 | S1 | canonical model assertions in `bundles.test.ts`; `CMD-TYPECHECK` |
| R2 | S1 | legacy normalization, one-diagnostic, bounded-output tests in `bundles.test.ts` |
| R3 | S1 | table-driven malformed-entry rejection tests in `bundles.test.ts` |
| R4 | S2 | canonical-vs-legacy artifact differential plus export/init/grouping/view suites |
| R5 | S4 | baseline `bundle-skill-reference-contract.test.mjs` and ordered manifest assertion |
| R6 | S3 | active-guide JSON and canonical string assertions in the structural test |
| R7 | S3 | separate CLI 9 compatibility and CLI 10 removal assertions |
| R8 | S4 | injected platform suites, full Linux suite, sensors, and native CI jobs |

Forward coverage: R1-R8 each have one owning slice and a direct behavioral or structural check. Backward coverage: every slice, planned file, and test traces to at least one listed requirement; no UI, renderer, hook, or dynamic-loading work is included.
