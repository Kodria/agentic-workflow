# Cursor CLI Parity Implementation Plan (Plan B — capas 1–2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AWM CLI install Cursor skills, agents, project guidance, and the three native hooks from registry `v4.9.0+`, self-sufficient and subset-safe with Claude/Codex.

**Architecture:** Extend existing frontiers only — `ProviderConfig`, Codex-style hooks adapter, `CodexAgentsStrategy` injection path, artifact-state migration for `cursor-mdc`, doctor/diagnostics. No `agent === 'cursor'` ternaries in command handlers; dispatch on `HookConfig.type` and directory equality for the shared skill group.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, existing hooks/`shared.ts` helpers, registry hooks published at `awm-baseline-registry` tag `v4.9.0`.

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Design:** `docs/plans/2026-09-28-cursor-full-parity-design.md` (approved 2026-09-28). Plan A (registry hooks) published as `v4.9.0`. Plan C (execution/admission) is out of scope.

<!-- AWM:COMPACT-SLICES:START v1 -->
{"schema":"compact-slices/v1","planId":"cursor-cli-parity-plan-b","requirements":["R1","R2","R3","R3.1","R4","R5","R5.1","R6","R7","R8","R8.1","R9","R10","R11","R12","R13","R13.1","R16.2","R17.1","R18","R19","R20"],"sources":[{"id":"SRC-DESIGN-B","path":"docs/plans/2026-09-28-cursor-full-parity-design.md","locator":"## Requirements","fact":"Plan B owns R1\u2013R13.1, R16.2 (CLI side), R17.1\u2013R19, R5 (CLI side); registry scripts already published under R20 as v4.9.0."},{"id":"SRC-DESIGN-CONTRACT","path":"docs/plans/2026-09-28-cursor-full-parity-design.md","locator":"**Contrato que Plan A fija para Plan B:**","fact":"CLI copies hooks/cursor-session-start|pre-compact|post-tool-use to <AWM_HOME>/hooks/cursor/ as session-start|pre-compact|post-tool-use; using-awm.md is written beside them by the adapter."},{"id":"SRC-PROVIDERS","path":"cli/src/providers/index.ts","locator":"export type HookConfig","fact":"HookConfig.type is only 'cc-settings-merge' | 'codex-hooks-json'; Cursor skills still use cursor-mdc under ~/.cursor/rules with agent:null and no hooks."},{"id":"SRC-SHARED","path":"cli/src/core/install-planner.ts","locator":"function agentsSharingSkillTarget","fact":"Shared skill groups are formed by equal skill.global/local directory strings; Cursor joining ~/.agents/skills and .agents/skills with renderer link enters the Codex/OpenCode group with no planner logic change."},{"id":"SRC-CODEX-HOOKS","path":"cli/src/commands/hooks/codex.ts","locator":"export function installCodexHook","fact":"Codex adapter syncs registry hooks/codex-session-start to scriptsDir/session-start, merges one AWM entry into hooks.json with backup, prunes dead/stale entries, and derives trust from heartbeat.json hash."},{"id":"SRC-HOOK-DISPATCH","path":"cli/src/commands/hooks/install.ts","locator":"export function installHook","fact":"install/status/uninstall/resync switch exhaustively on HookConfig.type; adding cursor-hooks-json requires a new case in each dispatcher."},{"id":"SRC-INJECT","path":"cli/src/core/context/strategies/codex-agents.ts","locator":"function withProjectGuidance","fact":"For Cursor (globalPath null) inject() writes full using-awm plus PROJECT_GUIDANCE into project AGENTS.md; injectProject writes .cursor/rules/awm.mdc with PROJECT_GUIDANCE only."},{"id":"SRC-ARTIFACTS","path":"cli/src/core/artifact-state.ts","locator":"export type ManagedArtifactRecord","fact":"Managed installs record renderer and targetPath under <AWM_HOME>/state/artifacts.json; R8 migration removes only records with renderer cursor-mdc under cursor rules dirs."},{"id":"SRC-TIER","path":"cli/src/core/diagnostics/provider-checks.ts","locator":"export function providerTier","fact":"Presence of provider.hooks yields hooks-native; Cursor is agents-md-managed until hooks are declared."},{"id":"SRC-BUDGET","path":"cli/src/commands/context-budget/budget.ts","locator":"const DEFAULT_FILES","fact":"awm context-budget today measures only AGENTS.md/CONSTITUTION.md/CLAUDE.md pins, not Cursor hook payload sizes."}],"commands":[{"id":"CMD-TYPECHECK","program":"npm","args":["--prefix","cli","run","typecheck"],"covers":["R1","R2","R6","R9","R12","R18"]},{"id":"CMD-PROVIDERS","program":"npm","args":["--prefix","cli","test","--","--runInBand","--silent","tests/providers/index.test.ts","tests/core/install-planner.test.ts"],"covers":["R1","R2","R6","R7","R9"]},{"id":"CMD-HOOKS","program":"npm","args":["--prefix","cli","test","--","--runInBand","--silent","tests/commands/hooks/cursor.test.ts","tests/commands/hooks/install.test.ts","tests/commands/hooks/status.test.ts","tests/commands/hooks/uninstall.test.ts","tests/commands/hooks/resync.test.ts"],"covers":["R12","R13","R13.1","R16.2","R17.1","R20"]},{"id":"CMD-CONTEXT","program":"npm","args":["--prefix","cli","test","--","--runInBand","--silent","tests/core/context/strategies/codex-agents.test.ts","tests/core/context/agents-md-single-slot.test.ts"],"covers":["R4","R5.1","R8","R8.1","R10","R11"]},{"id":"CMD-DOCTOR","program":"npm","args":["--prefix","cli","test","--","--runInBand","--silent","tests/core/diagnostics/provider-tier.test.ts","tests/core/diagnostics/provider-checks.test.ts","tests/commands/doctor.test.ts"],"covers":["R17.1","R18","R19"]},{"id":"CMD-SUBSETS","program":"npm","args":["--prefix","cli","test","--","--runInBand","--silent","tests/integration/cursor-subset-gate.test.ts"],"covers":["R3","R3.1"]},{"id":"CMD-BUDGET","program":"npm","args":["--prefix","cli","test","--","--runInBand","--silent","tests/commands/context-budget/budget.test.ts"],"covers":["R5"]},{"id":"CMD-MATRIX","program":"npm","args":["--prefix","cli","run","docs:matrix"],"covers":["R18","R19"]}],"slices":[{"id":"S1","title":"ProviderConfig joins shared skills and native agents","requirements":["R1","R2","R6","R7","R9"],"dependsOn":[],"sectionAnchor":"slice-s1","sources":["SRC-DESIGN-B","SRC-PROVIDERS","SRC-SHARED"],"redCommands":["CMD-PROVIDERS","CMD-TYPECHECK"],"greenCommands":["CMD-PROVIDERS","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["public-contract"]},{"id":"S2","title":"Cursor hooks adapter and registry floor","requirements":["R12","R13","R13.1","R16.2","R17.1","R20"],"dependsOn":["S1"],"sectionAnchor":"slice-s2","sources":["SRC-DESIGN-CONTRACT","SRC-CODEX-HOOKS","SRC-HOOK-DISPATCH"],"redCommands":["CMD-HOOKS","CMD-TYPECHECK"],"greenCommands":["CMD-HOOKS","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["security","public-contract"]},{"id":"S3","title":"PROJECT_GUIDANCE-only AGENTS.md and mdc migration","requirements":["R4","R5.1","R8","R8.1","R10","R11"],"dependsOn":["S1"],"sectionAnchor":"slice-s3","sources":["SRC-INJECT","SRC-ARTIFACTS","SRC-DESIGN-B"],"redCommands":["CMD-CONTEXT","CMD-TYPECHECK"],"greenCommands":["CMD-CONTEXT","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["public-contract"]},{"id":"S4","title":"Doctor, subset gate, budget, and support matrix","requirements":["R3","R3.1","R5","R18","R19"],"dependsOn":["S1","S2","S3"],"sectionAnchor":"slice-s4","sources":["SRC-TIER","SRC-BUDGET","SRC-DESIGN-B"],"redCommands":["CMD-DOCTOR","CMD-SUBSETS","CMD-BUDGET"],"greenCommands":["CMD-DOCTOR","CMD-SUBSETS","CMD-BUDGET","CMD-MATRIX","CMD-TYPECHECK"],"reviewEvidence":["specification","code-quality"],"risk":"full-context","fallback":["public-contract"]}],"closureCommands":["CMD-PROVIDERS","CMD-HOOKS","CMD-CONTEXT","CMD-DOCTOR","CMD-SUBSETS","CMD-BUDGET","CMD-TYPECHECK","CMD-MATRIX"]}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: ProviderConfig joins shared skills and native agents

#### Surfaces
Own R1/R2/R6/R7/R9 in `cli/src/providers/index.ts` and planner/provider tests. Cursor must install skills at the same physical paths as Codex/OpenCode (`~/.agents/skills`, `.agents/skills`, renderer `link`), install canonical agents under `~/.cursor/agents` / `.cursor/agents` with renderer `link`, and stop depending on `~/.claude/*` or `cursor-mdc` skill delivery. Grouping: one cohesive provider-table change that makes the shared-group invariant true by directory equality (SRC-SHARED).

#### Implementation
1. RED — extend `cli/tests/providers/index.test.ts` and `cli/tests/core/install-planner.test.ts` so that with only `cursor` enabled, `providerFor('cursor').skill` equals `{ global: <home>/.agents/skills, local: '.agents/skills', renderer: 'link' }`, `agent` is non-null with global under resolved `.cursor/agents` and local `.cursor/agents`, and `agentsSharingSkillTarget('cursor','global')` includes `codex` and `opencode`. Run CMD-PROVIDERS; observe fail on current `cursor-mdc` / `agent:null` config.
2. In `cli/src/providers/index.ts` change the `cursor` block to:

```ts
cursor: {
    label: 'Cursor',
    configHome: configHomeFor('cursor'),
    skill: {
        global: path.join(home, '.agents/skills'),
        local: '.agents/skills',
        renderer: 'link',
    },
    workflow: null,
    agent: {
        global: path.join(root('cursor'), 'agents'),
        local: '.cursor/agents',
        renderer: 'link',
    },
    // hooks added in S2
    injection: {
        type: 'managed-agents-md',
        globalPath: null,
        localFile: 'AGENTS.md',
    },
},
```

3. Keep `cursor-mdc` registered in renderers for migration reads (S3); do not remove the renderer module.
4. GREEN — CMD-PROVIDERS + CMD-TYPECHECK. SRC-DESIGN-B / SRC-PROVIDERS / SRC-SHARED supply the target shape.

#### Edge cases
- Enabling `{cursor}` alone must succeed without Claude/Codex installed (R1).
- Enabling `{codex,cursor}` or `{opencode,cursor}` must not trip `assertCompleteSharedGroup` when the full shared group for that directory is selected by init/add (R7).
- `assertLinkRenderer` must still reject accidental non-link skill installs into rules paths.

#### Evidence
CMD-PROVIDERS proves path/renderer/shared-group; CMD-TYPECHECK for ProviderConfig typing. Distinct specification and code-quality reviews; reconcile files/tests/plan digest before slice complete.

#### Fallback
Public-contract risk: if Cursor rejects `link` skills under `~/.agents/skills` in real verification later, amend with durable evidence and keep R1 (never fall back to requiring Claude imports). Full relevant context under Evidence Capsule v1; do not invent `~/.cursor/skills` without design amendment.

---

<a id="slice-s2"></a>
### Slice S2: Cursor hooks adapter and registry floor

#### Surfaces
Own R12/R13/R13.1/R16.2/R17.1/R20 in a new `cli/src/commands/hooks/cursor.ts` plus dispatcher switches and provider `hooks` config. Copies the three Plan A scripts from the registry into `<AWM_HOME>/hooks/cursor/`, merges `~/.cursor/hooks.json` (`version: 1`) with exactly one AWM command per `sessionStart` / `preCompact` / `postToolUse`, writes `using-awm.md` beside the scripts, reports trust as `pending-first-run`|`stale`|`healthy`, and refuses install when baseline registry tag `< 4.9.0`. Grouping: one adapter family mirroring Codex (SRC-CODEX-HOOKS) with multi-event JSON.

#### Implementation
1. RED — add `cli/tests/commands/hooks/cursor.test.ts` modeled on `codex.test.ts`:
   - install merges three events, preserves non-AWM entries, backups previous file
   - invalid JSON / unknown version / duplicate AWM entries abort with no write (R13)
   - dead/stale AWM entries pruned (R13.1)
   - missing heartbeat → `pending-first-run`; hash mismatch → `stale`; match → `healthy` (R17.1)
   - registry fixture without `hooks/cursor-session-start` → install fails; with scripts from a temp registry root → success
   - floor: when resolved baseline version is `4.8.1`, install throws a clear "requires registry >= 4.9.0" error; `4.9.0` succeeds (R20)
   - R16.2: export a pure helper `shouldDisableDeferredReanchor({ deliveryVerified, p95Ms })` that returns true when `deliveryVerified===false` or `p95Ms>50`; install omits preCompact/postToolUse entries when an explicit options flag `disableDeferredReanchor: true` is set (default false until real measurement says otherwise)
   Run CMD-HOOKS RED.
2. Extend `HookConfig` in `cli/src/providers/index.ts`:

```ts
export type HookConfig = {
    type: 'cc-settings-merge' | 'codex-hooks-json' | 'cursor-hooks-json';
    settingsPath: string;
    scriptsDir: string;
    matcher: string;      // unused for cursor (empty string)
    eventName: string;    // unused for cursor (empty string)
};
```

Add to the cursor provider (after S1 fields):

```ts
hooks: {
    type: 'cursor-hooks-json',
    settingsPath: path.join(root('cursor'), 'hooks.json'),
    scriptsDir: path.join(awm, 'hooks/cursor'),
    matcher: '',
    eventName: '',
},
```

3. Implement `cli/src/commands/hooks/cursor.ts` with `installCursorHook`, `computeCursorHookStatus`, `uninstallCursorHook`, `resyncCursorHookFiles`, `cursorResyncSourcesExist`:
   - Sources: `hooks/cursor-session-start`, `hooks/cursor-pre-compact`, `hooks/cursor-post-tool-use` → dest names `session-start`, `pre-compact`, `post-tool-use` via `syncExecutable`
   - Write composed `using-awm.md` into `scriptsDir` from the same source `buildContext` / registry skill path Codex uses for its guide file (inline: read `skills/using-awm/SKILL.md` body from `registryRoot` and write atomically; if missing, abort install)
   - `hooks.json` shape:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "<scriptsDir>/session-start" }],
    "preCompact":   [{ "command": "<scriptsDir>/pre-compact" }],
    "postToolUse":  [{ "command": "<scriptsDir>/post-tool-use" }]
  }
}
```

   - Absolute command paths; no matchers. Identify AWM entries by command path under `scriptsDir`. Backup via `backupManagedFile`. Preserve non-AWM entries per event array.
   - Registry floor helper: resolve baseline version from installed registry checkout / pin (reuse `machineVersionOpts` / registry version helpers already used by update); compare with `compareSemver` against `4.9.0`.
4. Wire `cursor-hooks-json` cases into `install.ts`, `status.ts`, `uninstall.ts`, `resync.ts` (exhaustive switches).
5. GREEN — CMD-HOOKS + CMD-TYPECHECK.

#### Edge cases
- `hooks.json` absent → create `{version:1,hooks:{...}}`.
- Event key present but not an array → abort (R13).
- Parallel second AWM_HOME entry that is still live → do not prune (same rule as Codex stale detector); only prune dead/stale paths.
- Windows: if Cursor cannot exec shebang scripts, follow-up wrapper is Plan C/discovery — this slice keeps the Node shebang scripts Plan A shipped; document in support matrix as unverified on Windows until playbook exists.

#### Evidence
CMD-HOOKS covers merge/prune/trust/floor; SRC-DESIGN-CONTRACT names the three scripts. Spec + quality reviews on adapter and dispatchers.

#### Fallback
Security/public-contract: if Cursor's hooks.json schema rejects absolute paths, amend with relative-to-`~/.cursor` commands and revalidate. R16.2 degradation path must remove only deferred entries and keep `sessionStart`. Never invent approval-trust UX (Cursor has none).

---

<a id="slice-s3"></a>
### Slice S3: PROJECT_GUIDANCE-only AGENTS.md and mdc migration

#### Surfaces
Own R4/R5.1/R8/R8.1/R10/R11 in `cli/src/core/context/strategies/codex-agents.ts` and migration during init/update after skills install. Cursor project `AGENTS.md` managed block must contain only `PROJECT_GUIDANCE` (not full `using-awm`); `.cursor/rules/awm.mdc` remains the versioned carrier; after link skills are installed, remove only artifact-state records with `renderer === 'cursor-mdc'` under `~/.cursor/rules` or `<project>/.cursor/rules`, never unrecorded files, never `awm.mdc`.

#### Implementation
1. RED — update `cli/tests/core/context/strategies/codex-agents.test.ts` and `agents-md-single-slot.test.ts`:
   - `inject` for cursor writes a managed block whose body equals `PROJECT_GUIDANCE` only (no using-awm headings)
   - `awm.mdc` still receives PROJECT_GUIDANCE with `alwaysApply: true`
   - Copilot path unchanged (still needs full context when it is the sole carrier)
   - New migration test: seed `artifacts.json` with a `cursor-mdc` skill record pointing at `~/.cursor/rules/foo.mdc` plus an unrecorded `custom.mdc` and `awm.mdc`; after migration helper runs, only `foo.mdc` is deleted and the ledger row removed
   Run CMD-CONTEXT RED.
2. Change Cursor injection so local `inject` uses PROJECT_GUIDANCE only. Minimal approach in `codex-agents.ts`: when `provider` is cursor (pass `agent` into `inject` or branch on `globalPath===null && localFile==='AGENTS.md' && skill renderer is link and label Cursor — prefer explicit `agent === 'cursor'` at the `regenerate`/`inject` call sites that already know the agent). Exact call-site fact: `cli/src/core/context/regenerate.ts` and init steps pass `agent`; thread `agent` into `inject` and:

```ts
const body = agent === 'cursor' ? PROJECT_GUIDANCE : withProjectGuidance(markdown, scope);
```

for the managed-block write. Status hashing must expect the same body.
3. Add `migrateCursorMdcSkills({ awmHome, projectRoot?: string })` in a small module (e.g. `cli/src/core/init/migrate-cursor-mdc.ts`) called from init/update after skill install for cursor-enabled machines. Pseudo:

```ts
for (const rec of readArtifactState()) {
  if (rec.renderer !== 'cursor-mdc') continue;
  if (rec.name === 'awm' || path.basename(rec.targetPath) === 'awm.mdc') continue;
  if (!isUnderCursorRules(rec.targetPath, projectRoot)) continue;
  safeUnlinkManaged(rec.targetPath); // only if still recorded and regular file
  // drop record from state
}
```

4. GREEN — CMD-CONTEXT + CMD-TYPECHECK.

#### Edge cases
- Existing AGENTS.md with full using-awm managed block: next inject replaces managed slot with PROJECT_GUIDANCE only (R10); do not delete user content outside markers.
- R5.1: PROJECT_GUIDANCE may appear in both AGENTS.md and awm.mdc; that dual carrier is required.
- Unrecorded `.mdc` in `.cursor/rules` must survive (R8.1).

#### Evidence
CMD-CONTEXT proves R10/R11/R8; R4 is satisfied because global using-awm moves to the hook (S2) while AGENTS.md stops carrying it.

#### Fallback
If stripping using-awm from AGENTS.md breaks a documented Cursor mode that does not run hooks, amend design before reverting — do not reintroduce dual full carriers (violates R3/R4).

---

<a id="slice-s4"></a>
### Slice S4: Doctor, subset gate, budget, and support matrix

#### Surfaces
Own R3/R3.1/R5/R18/R19 in diagnostics, a new isolated integration test for all seven non-empty subsets of `{claude-code,codex,cursor}`, context-budget reporting for Cursor hook payload caps, and regenerated support matrix. Tier becomes `hooks-native` automatically once S2 lands; doctor must surface `pending-first-run` and an informational duplicate-delivery note when Claude is also enabled.

#### Implementation
1. RED —
   - Update `provider-tier.test.ts` expectation: `cursor: 'hooks-native'`.
   - Extend provider-checks/doctor tests for trust label `pending-first-run` (map in `hookTrustCheck` / status printer; remediation text: run any Cursor Agent session once — not Codex's open-hooks-trust).
   - Add informational check when `claude-code` and `cursor` are both enabled: detail mentions third-party Claude hook import and that R15 suppression depends on cursor session-start being installed.
   - Add `cli/tests/integration/cursor-subset-gate.test.ts`: for each non-empty subset of the three agents, with isolated `HOME`/`AWM_HOME` and a temp registry that includes cursor hooks + using-awm, run the init/install path and assert (a) `using-awm` skill name appears once under discovered skill roots Cursor cares about, (b) no second copy under `~/.cursor/rules/*.mdc` for that skill, (c) when cursor∈subset, `hooks/cursor/session-start` exists and `hooks.json` has the three AWM commands.
   - Budget: extend `budget.ts` so `.awm/context-budget.json` may declare optional pins `cursor.sessionStartMaxBytes` (default 24576) and `cursor.reanchorMaxBytes` (default 4096); when `~/.awm/hooks/cursor/` scripts exist, measure a dry fixture run or the documented constants exported from a tiny shared `cli/src/core/cursor-budgets.ts` (`export const CURSOR_SESSION_START_MAX_BYTES = 24 * 1024` …) and mark `over` if constants disagree with pins — practical approach: document pins and validate the constants module + that `cursor-session-start` source in the **test registry fixture** still contains the matching numeric literals Plan A shipped (`24 * 1024`, `4 * 1024`). Prefer reading the installed script text for `MAX_SESSION_BYTES` / `MAX_REANCHOR_BYTES` assignments when present.
   Run CMD-DOCTOR, CMD-SUBSETS, CMD-BUDGET RED as tests are added.
2. Implement the doctor/trust/duplicate check and subset integration test; extend budget as above.
3. Run CMD-MATRIX (`npm --prefix cli run docs:matrix`) and commit the regenerated `docs/support-matrix.md` rows for Cursor (skills `~/.agents/skills`, hooks native, tier hooks-native).
4. GREEN — CMD-DOCTOR, CMD-SUBSETS, CMD-BUDGET, CMD-MATRIX, CMD-TYPECHECK.

#### Edge cases
- Subset `{cursor}` must not require `~/.claude` or `~/.codex` directories to exist (R1/R3.1).
- Duplicate-delivery check is informational never overall-red by itself (R19).
- Budget without cursor hooks installed → skip cursor pins (unmeasurable/absent), do not fail.

#### Evidence
Seven-subset gate is the R3.1 proof; doctor tests cover R17.1/R18/R19; budget tests cover R5 CLI reporting.

#### Fallback
If full seven-subset init is too slow for CI, keep one exhaustive unit assertion on delivery uniqueness plus three representative integration subsets, and amend the plan with measured timings — do not drop R3.1. Matrix regeneration failure blocks merge.

---

## Traceability matrix

| Req | Slice(s) | Test command / focus |
|-----|----------|----------------------|
| R1 | S1, S4 | CMD-PROVIDERS; CMD-SUBSETS `{cursor}` alone |
| R2 | S1, S4 | CMD-SUBSETS no reads of `~/.claude` required |
| R3 | S3, S4 | CMD-CONTEXT + CMD-SUBSETS single using-awm |
| R3.1 | S4 | CMD-SUBSETS seven subsets |
| R4 | S3 | CMD-CONTEXT AGENTS.md without full using-awm |
| R5 | S4 | CMD-BUDGET cursor byte pins |
| R5.1 | S3 | CMD-CONTEXT dual PROJECT_GUIDANCE carriers |
| R6 | S1 | CMD-PROVIDERS paths |
| R7 | S1 | CMD-PROVIDERS shared group |
| R8 | S3 | CMD-CONTEXT mdc migration |
| R8.1 | S3 | CMD-CONTEXT unrecorded preserved |
| R9 | S1 | CMD-PROVIDERS agents paths |
| R10 | S3 | CMD-CONTEXT PROJECT_GUIDANCE only |
| R11 | S3 | CMD-CONTEXT awm.mdc |
| R12 | S2 | CMD-HOOKS three events |
| R13 | S2 | CMD-HOOKS abort paths |
| R13.1 | S2 | CMD-HOOKS prune/backup |
| R16.2 | S2 | CMD-HOOKS disable helper + flag |
| R17.1 | S2, S4 | CMD-HOOKS + CMD-DOCTOR trust labels |
| R18 | S2, S4 | CMD-DOCTOR tier hooks-native |
| R19 | S4 | CMD-DOCTOR duplicate informational |
| R20 | S2 | CMD-HOOKS registry floor 4.9.0 |

## Execution handoff

Plan ready for review. After owner approval: admit with `awm plan admit docs/plans/2026-09-29-cursor-cli-parity-plan.md --provider <native> --cwd . --require-current --verify-sensors --json`, then `subagent-driven-development` slice by slice. Plan C (R21–R26 execution) stays blocked until this plan merges and `agent -p` discovery evidence exists.
