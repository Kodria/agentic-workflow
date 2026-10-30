# Issue #240 read-only tool-cache strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under `runSensors({ readOnly: true })`, strip allowlisted ESLint tool-cache argv before spawn so admission is not blocked by `./.eslintcache`, without changing operator cache behavior or RF-2.11 / B-R5.

**Architecture:** Two serial CLI slices. S1 adds a pure `stripReadOnlyToolCacheArgs` helper with unit tests. S2 wires it in `runPreparedSlot` only when `readOnly` is true and the prepared command is structured, plus integration tests. Registry pack `--cache-location` (design R4) is a **companion plan** in `awm-baseline-registry`, not owned here.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, existing `runSensors` / `executePrepared` / `runStructuredCommand` path.

**Change Record:** `issue-240-readonly-tool-cache`

**Criterios de aceptación:**
- En un proyecto js-ts con lint `--cache` (sin location o con location bajo `node_modules`), `awm plan admit … --verify-sensors` en frío no reporta `read-only-mutation-detected` solo por `.eslintcache`
- `awm sensors run` (sin readOnly) sigue pasando `--cache` al tool
- Admit sigue sin escribir/leer `.awm/sensors/runs/cache-*.json` (RF-2.11)

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** `docs/plans/2026-10-30-issue-240-readonly-tool-cache-design.md`. Issue #240. Owner did not select AWM routing → `compact-slices/v1`. This plan owns design R1–R3 and R5–R8; R4 is deferred to the registry companion.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-240-readonly-tool-cache",
  "requirements": ["R1", "R2", "R3", "R5", "R6", "R7", "R8"],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-30-issue-240-readonly-tool-cache-design.md",
      "locator": "## Requirements",
      "fact": "R1 strip allowlisted --cache and paired --cache-location+operand under readOnly; R2 no strip without readOnly; R3 RF-2.11 unchanged; R5 no false mutation from eslintcache; R6 pure non-mutating helper; R7 real mutations still detected; R8 legacy cmd not stripped. DD-7: lone --cache-location without --cache in the same argv is not stripped."
    },
    {
      "id": "SRC-RUN",
      "path": "cli/src/commands/sensors/run.ts",
      "locator": "async function runPreparedSlot",
      "fact": "runPreparedSlot(slot, projectCwd, baseline, cacheEnabled, writeCache) calls executePrepared(execution, projectCwd) after optional result-cache hit. pooled map at ~L667 does not pass readOnly today. cacheEnabled = opts.useCache === true && !opts.ignoreBaseline && !opts.readOnly (RF-2.11)."
    },
    {
      "id": "SRC-RESULT",
      "path": "cli/src/commands/sensors/result.ts",
      "locator": "export async function executePrepared",
      "fact": "executePrepared validates prepared; if command.kind === 'structured' calls runStructuredCommand(prepared.command.value, options) with value.args unchanged. Legacy uses runCommand(string)."
    },
    {
      "id": "SRC-TYPES",
      "path": "cli/src/commands/sensors/types.ts",
      "locator": "export type PreparedSensorExecution",
      "fact": "command?: { kind: 'legacy'; value: string } | { kind: 'structured'; value: PreparedStructuredCommand }; PreparedStructuredCommand.args: string[]."
    },
    {
      "id": "SRC-ADMISSION",
      "path": "cli/src/core/admission/registry-contracts.ts",
      "locator": "await (dependencies.runSensors ?? runSensors)({ cwd: input.cwd, all: true, readOnly: true })",
      "fact": "Admission verify-sensors path passes readOnly: true and does not set useCache."
    },
    {
      "id": "SRC-RO-TEST",
      "path": "cli/tests/commands/sensors/run-read-only.test.ts",
      "locator": "describe('runSensors read-only observation (admission)'",
      "fact": "Existing readOnly fixtures mock runCommand (legacy). New structured coverage should mock runStructuredCommand like run-cache.test.ts."
    },
    {
      "id": "SRC-CACHE-TEST",
      "path": "cli/tests/commands/sensors/run-cache.test.ts",
      "locator": "it('does not read or write cache when useCache is unset, readOnly, or ignoreBaseline (RF-2.11/2.13)'",
      "fact": "RF-2.11 regression already asserts readOnly + useCache true still executes and does not rely on cache write for the strip feature; keep GREEN after wire-up."
    }
  ],
  "commands": [
    {
      "id": "CMD-UNIT",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/read-only-tool-cache.test.ts"],
      "covers": ["R1", "R6"]
    },
    {
      "id": "CMD-RO",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/run-read-only-tool-cache.test.ts"],
      "covers": ["R2", "R3", "R5", "R7", "R8"]
    },
    {
      "id": "CMD-CACHE-RF211",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/run-cache.test.ts", "-t", "does not read or write cache when useCache is unset, readOnly, or ignoreBaseline"],
      "covers": ["R3"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["R1", "R2", "R6"]
    },
    {
      "id": "CMD-LINT",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "lint"],
      "covers": ["R1", "R2", "R3", "R5", "R6", "R7", "R8"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Pure stripReadOnlyToolCacheArgs helper",
      "requirements": ["R1", "R6"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DESIGN", "SRC-TYPES"],
      "redCommands": ["CMD-UNIT"],
      "greenCommands": ["CMD-UNIT", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S2",
      "title": "Wire strip into readOnly execute path",
      "requirements": ["R2", "R3", "R5", "R7", "R8"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-DESIGN", "SRC-RUN", "SRC-RESULT", "SRC-ADMISSION", "SRC-RO-TEST", "SRC-CACHE-TEST"],
      "redCommands": ["CMD-RO"],
      "greenCommands": ["CMD-RO", "CMD-CACHE-RF211", "CMD-UNIT", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-UNIT", "CMD-RO", "CMD-CACHE-RF211", "CMD-TYPECHECK", "CMD-LINT"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Pure stripReadOnlyToolCacheArgs helper

#### Surfaces

Owns R1 (algorithm) and R6 (purity). Create `cli/src/commands/sensors/read-only-tool-cache.ts` and `cli/tests/commands/sensors/read-only-tool-cache.test.ts`. No wire into `run.ts` yet. Grouping: helper + unit tests are one closed TDD unit before execute-path coupling.

#### Implementation

- [ ] **RED:** Add `cli/tests/commands/sensors/read-only-tool-cache.test.ts`:

```typescript
import { stripReadOnlyToolCacheArgs } from '../../../src/commands/sensors/read-only-tool-cache';

describe('stripReadOnlyToolCacheArgs', () => {
    it('removes --cache when present', () => {
        expect(stripReadOnlyToolCacheArgs(['.', '--cache', '--format', 'json']))
            .toEqual(['.', '--format', 'json']);
    });

    it('removes --cache and --cache-location plus operand when --cache is present (DD-7 pair)', () => {
        expect(stripReadOnlyToolCacheArgs([
            '.', '--config', 'eslint.config.awm.mjs', '--cache', '--cache-location', 'node_modules/.cache/eslint/', '--format', 'json',
        ])).toEqual(['.', '--config', 'eslint.config.awm.mjs', '--format', 'json']);
    });

    it('does not strip lone --cache-location without --cache in the same argv (DD-7)', () => {
        const args = ['.', '--cache-location', '/tmp/x', '--format', 'json'];
        expect(stripReadOnlyToolCacheArgs(args)).toEqual(args);
    });

    it('does not mutate the input array (R6)', () => {
        const args = Object.freeze(['.', '--cache', '--format', 'json']) as string[];
        const copy = [...args];
        const out = stripReadOnlyToolCacheArgs(args);
        expect(out).toEqual(['.', '--format', 'json']);
        expect([...args]).toEqual(copy);
        expect(out).not.toBe(args);
    });

    it('rejects non-array input', () => {
        expect(() => stripReadOnlyToolCacheArgs(null as unknown as string[])).toThrow(/args/);
    });

    it('skips --cache-location operand when --cache present even if location is last (no hanging operand crash)', () => {
        expect(stripReadOnlyToolCacheArgs(['--cache', '--cache-location'])).toEqual([]);
    });
});
```

- [ ] Run CMD-UNIT — expect FAIL (module missing).
- [ ] **GREEN:** Add `cli/src/commands/sensors/read-only-tool-cache.ts`:

```typescript
/**
 * Admission readOnly spawn filter (issue #240). Removes ESLint-shaped tool-cache
 * argv so sensors do not create observed files such as ./.eslintcache.
 * Only used when runSensors({ readOnly: true }); operator runs keep --cache.
 */
export function stripReadOnlyToolCacheArgs(args: readonly string[]): string[] {
    if (!Array.isArray(args)) throw new Error('stripReadOnlyToolCacheArgs args must be an array');
    for (const [index, arg] of args.entries()) {
        if (typeof arg !== 'string' || arg === '') {
            throw new Error(`stripReadOnlyToolCacheArgs args[${index}] must be a nonempty string`);
        }
    }
    const hasCache = args.includes('--cache');
    if (!hasCache) return [...args];
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--cache') continue;
        if (arg === '--cache-location') {
            if (i + 1 < args.length) i += 1;
            continue;
        }
        out.push(arg);
    }
    return out;
}
```

- [ ] Run CMD-UNIT — expect PASS. Run CMD-TYPECHECK and CMD-LINT — expect PASS.
- [ ] Commit: `test(sensors): stripReadOnlyToolCacheArgs helper for #240` then `feat(sensors): add stripReadOnlyToolCacheArgs` (or one commit if preferred locally; conventional `feat`/`test` OK).

#### Edge cases

- Multiple `--cache` tokens: all removed when any `--cache` was present.
- `--cache-location` without following operand: skip the flag only (no throw, no reading past end).
- Non-array / empty-string args: throw (robustness floor).
- Frozen input array: must not throw on read; must not mutate.

#### Evidence

CMD-UNIT proves R1 algorithm + R6. Distinct specification and code-quality reviews on S1. Plan identity from `awm plan validate` / admit for this file.

#### Fallback

If ESLint packs start using `--cache-location=path` (equals form), amend design + helper to strip that token when `--cache` present; revalidate plan. Do not invent equals-form support without amendment.

---

<a id="slice-s2"></a>
### Slice S2: Wire strip into readOnly execute path

#### Surfaces

Owns R2, R3, R5, R7, R8 (R1 owned by S1; this slice applies the helper at the readOnly execute boundary so R5 holds). Modify `cli/src/commands/sensors/run.ts` (`runPreparedSlot` + call site). Add `cli/tests/commands/sensors/run-read-only-tool-cache.test.ts`. Do not change `executePrepared` signature unless unavoidable — prefer cloning structured `command.value.args` in `runPreparedSlot` before `executePrepared`. Grouping: wire-up + integration tests share the readOnly execute boundary.

#### Implementation

- [ ] **RED:** Add `cli/tests/commands/sensors/run-read-only-tool-cache.test.ts` modeled on `run-cache.test.ts` (mock `runStructuredCommand` + `runCommand`, tmp project, pack-bound structured lint with `--cache` in live pack or project-declared structured sensor).

Minimum cases:

1. **R5 / R1:** `runSensors({ cwd, readOnly: true, all: true })` with structured command args including `--cache` (and optionally `--cache-location`). Mock `runStructuredCommand` to assert received `command.args` has no `--cache` / `--cache-location`. Also assert `./.eslintcache` is absent after the run if the mock does not create it. `out.reason` must not be `read-only-mutation-detected` when the mock only “passes” without writing files. Prefer asserting spawn args (definitive for strip) **and** a case where the mock writes `.eslintcache` only if `--cache` was still present — prove strip prevents that path.

   Practical RED pattern: mock implementation checks `args.includes('--cache')` and if so writes `.eslintcache` then returns ok; if stripped, does not write. Then `readOnly` run must pass observation and leave no `.eslintcache`.

2. **R2:** same project without `readOnly` — mock must receive `--cache` still present.

3. **R3:** after `readOnly` run, no `cache-*.json` under `.awm/sensors/runs/` even if `useCache: true` is also passed (RF-2.11 gate wins).

4. **R7:** `readOnly` run where mock writes `src/touched.ts` → `reason === 'read-only-mutation-detected'`.

5. **R8:** legacy `cmd: 'eslint --cache --format json .'` under `readOnly` — `runCommand` receives the **unchanged** string (no strip). Observation may still fail if the mock writes `.eslintcache`; that is accepted for legacy. Assert the string still contains `--cache`.

Use the same HOME/AWM_HOME/git isolation pattern as `run-read-only.test.ts` / `run-cache.test.ts`.

- [ ] Run CMD-RO — expect FAIL (args still include `--cache` under readOnly).
- [ ] **GREEN:** In `cli/src/commands/sensors/run.ts`:
  - Import `stripReadOnlyToolCacheArgs`.
  - Extend `runPreparedSlot(..., readOnly: boolean)`.
  - Before `executePrepared`, if `readOnly && execution.command?.kind === 'structured'`:

```typescript
const command = execution.command;
const strippedArgs = stripReadOnlyToolCacheArgs(command.value.args);
const executionForRun = strippedArgs === command.value.args
    || (strippedArgs.length === command.value.args.length && strippedArgs.every((a, i) => a === command.value.args[i]))
    ? execution
    : {
        ...execution,
        command: {
            kind: 'structured' as const,
            value: { ...command.value, args: strippedArgs },
        },
    };
const raw = await executePrepared(executionForRun, projectCwd);
```

  Prefer always cloning when `readOnly` and structured (simpler):

```typescript
let executionForRun = execution;
if (readOnly && execution.command?.kind === 'structured') {
    executionForRun = {
        ...execution,
        command: {
            kind: 'structured',
            value: {
                ...execution.command.value,
                args: stripReadOnlyToolCacheArgs(execution.command.value.args),
            },
        },
    };
}
const raw = await executePrepared(executionForRun, projectCwd);
```

  - Pass `opts.readOnly === true` into every `runPreparedSlot(...)` call from the pooled map.
  - Do **not** strip on legacy `command.kind === 'legacy'` (R8).

- [ ] Run CMD-RO, CMD-CACHE-RF211, CMD-UNIT, CMD-TYPECHECK, CMD-LINT — all PASS.
- [ ] Commit: `fix(sensors): strip tool-cache argv under readOnly admission (#240)`.

#### Edge cases

- Cache hit path (`cacheEnabled && cached`): no execute → strip irrelevant; with admission `readOnly`, `cacheEnabled` is false anyway (R3).
- Synthetic skip/disabled: `executePrepared` returns early; strip unused — OK.
- `readOnly: true` with empty args array: helper returns `[]`; spawn validation may still fail elsewhere — out of scope.
- Do not exclude `.awm/sensors/runs` from observation (DD-4).

#### Evidence

CMD-RO covers R1/R2/R3/R5/R7/R8. CMD-CACHE-RF211 anchors R3 against the existing RF-2.11 test. Spec + quality reviews on S2. Closure = all closureCommands green on this plan identity.

#### Fallback

If structured project-declared sensors are hard to fixture, amend to document the minimal pack fixture under the test HOME registry (copy pattern from `run-cache.test.ts` pack.json with lint args including `--cache`). Do not weaken R7. Registry R4 remains a separate PR/plan.

---

## Traceability matrix

| Req | Task(s) | Test(s) |
|-----|---------|---------|
| R1 | S1 | CMD-UNIT (strip algorithm + DD-7); S2 applies helper under R5 without re-owning R1 |
| R2 | S2 | CMD-RO case without readOnly keeps `--cache` |
| R3 | S2 | CMD-RO no `cache-*.json`; CMD-CACHE-RF211 |
| R5 | S2 | CMD-RO mock writes `.eslintcache` only if `--cache` present → readOnly pass |
| R6 | S1 | CMD-UNIT frozen/non-mutate + type throw |
| R7 | S2 | CMD-RO writes `src/touched.ts` → `read-only-mutation-detected` |
| R8 | S2 | CMD-RO legacy `cmd` string still contains `--cache` |

**Deferred (not this plan):** design R4 → companion plan in `awm-baseline-registry`.

## Self-review

1. Traceability: R1–R3,R5–R8 covered; R4 explicitly deferred.
2. Placeholders: none.
3. Types: `PreparedSensorExecution` / `stripReadOnlyToolCacheArgs(readonly string[]) => string[]` consistent across slices.
4. UI: none.
