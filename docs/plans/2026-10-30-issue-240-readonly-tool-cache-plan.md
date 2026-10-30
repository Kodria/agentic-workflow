# Issue #240 read-only tool-cache strip Implementation Plan
<!-- awm-qa-complete: 2026-10-30 -->
<!-- awm-docs-complete: 2026-10-30 -->
<!-- awm-retro-complete: 2026-10-30 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under `runSensors({ readOnly: true })`, strip allowlisted ESLint tool-cache argv before spawn so admission is not blocked by `./.eslintcache`, without changing operator cache behavior or RF-2.11 / B-R5.

**Architecture:** Two serial CLI slices. S1 adds `stripReadOnlyToolCacheArgs(executable, args)` (eslint-only) with unit tests. S2 wires it in `runPreparedSlot` when `readOnly` + structured, with mock integration + one real-eslint evidence test. Registry pack `--cache-location` (design R4) is a **companion plan** in `awm-baseline-registry`, not owned here.

**Tech Stack:** TypeScript CLI (`cli/`), Jest, existing `runSensors` / `executePrepared` / `runStructuredCommand` path; real `eslint` binary from `cli/node_modules` for CMD-REAL.

**Change Record:** `issue-240-readonly-tool-cache`

**Criterios de aceptación:**
- En un proyecto js-ts con lint `--cache` (sin location o con location bajo `node_modules`), `awm plan admit … --verify-sensors` en frío no reporta `read-only-mutation-detected` solo por `.eslintcache`
- `awm sensors run` (sin readOnly) sigue pasando `--cache` al tool
- Admit sigue sin escribir/leer `.awm/sensors/runs/cache-*.json` (RF-2.11)
- Un comando estructurado no-eslint con `--cache` bajo `readOnly` conserva esos args (DD-8 / R9)

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

**Modo de despacho:** proveedor-nativo

**Origen:** `docs/plans/2026-10-30-issue-240-readonly-tool-cache-design.md` (amended after PR #241 audit H1–H3). Issue #240. Owner did not select AWM routing → `compact-slices/v1`. This plan owns design R1–R3 and R5–R9; R4 is deferred to the registry companion.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-240-readonly-tool-cache",
  "requirements": ["R1", "R2", "R3", "R5", "R6", "R7", "R8", "R9"],
  "sources": [
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-30-issue-240-readonly-tool-cache-design.md",
      "locator": "## Requirements",
      "fact": "R1 strip eslint --cache / --cache=<value> and paired --cache-location(+operand| =path) under readOnly only when executable==='eslint' (DD-8; Track B equals-form); R2 no strip without readOnly; R3 RF-2.11 unchanged; R5 no false mutation from eslintcache and requires real-eslint evidence; R6 pure non-mutating helper; R7 real mutations still detected; R8 legacy cmd not stripped; R9 non-eslint structured argv unchanged. DD-7: lone --cache-location without --cache in the same argv is not stripped."
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
      "covers": ["R1", "R6", "R9"]
    },
    {
      "id": "CMD-RO",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/run-read-only-tool-cache.test.ts"],
      "covers": ["R2", "R3", "R5", "R7", "R8", "R9"]
    },
    {
      "id": "CMD-REAL",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/run-read-only-tool-cache.test.ts", "-t", "real eslint binary under readOnly does not leave .eslintcache"],
      "covers": ["R5"]
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
      "covers": ["R1", "R2", "R6", "R9"]
    },
    {
      "id": "CMD-LINT",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "lint"],
      "covers": ["R1", "R2", "R3", "R5", "R6", "R7", "R8", "R9"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Pure stripReadOnlyToolCacheArgs helper",
      "requirements": ["R1", "R6", "R9"],
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
      "redCommands": ["CMD-RO", "CMD-REAL"],
      "greenCommands": ["CMD-RO", "CMD-REAL", "CMD-CACHE-RF211", "CMD-UNIT", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-UNIT", "CMD-RO", "CMD-REAL", "CMD-CACHE-RF211", "CMD-TYPECHECK", "CMD-LINT"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Pure stripReadOnlyToolCacheArgs helper

#### Surfaces

Owns R1 (eslint strip algorithm), R6 (purity), R9 (non-eslint no-op). Create `cli/src/commands/sensors/read-only-tool-cache.ts` and `cli/tests/commands/sensors/read-only-tool-cache.test.ts`. No wire into `run.ts` yet. Grouping: helper + unit tests are one closed TDD unit before execute-path coupling.

#### Implementation

- [ ] **RED:** Add `cli/tests/commands/sensors/read-only-tool-cache.test.ts`:

```typescript
import { stripReadOnlyToolCacheArgs } from '../../../src/commands/sensors/read-only-tool-cache';

describe('stripReadOnlyToolCacheArgs', () => {
    it('removes --cache for eslint', () => {
        expect(stripReadOnlyToolCacheArgs('eslint', ['.', '--cache', '--format', 'json']))
            .toEqual(['.', '--format', 'json']);
    });

    it('removes --cache and --cache-location plus operand for eslint when --cache present (DD-7)', () => {
        expect(stripReadOnlyToolCacheArgs('eslint', [
            '.', '--config', 'eslint.config.awm.mjs', '--cache', '--cache-location', 'node_modules/.cache/eslint/', '--format', 'json',
        ])).toEqual(['.', '--config', 'eslint.config.awm.mjs', '--format', 'json']);
    });

    it('does not strip lone --cache-location without --cache for eslint (DD-7)', () => {
        const args = ['.', '--cache-location', '/tmp/x', '--format', 'json'];
        expect(stripReadOnlyToolCacheArgs('eslint', args)).toEqual(args);
    });

    it('does not strip for non-eslint executables even with --cache (R9 / H1)', () => {
        const args = ['--cache', 'false', 'lib/'];
        expect(stripReadOnlyToolCacheArgs('rubocop', args)).toEqual(args);
    });

    it('does not mutate the input array (R6)', () => {
        const args = Object.freeze(['.', '--cache', '--format', 'json']) as string[];
        const copy = [...args];
        const out = stripReadOnlyToolCacheArgs('eslint', args);
        expect(out).toEqual(['.', '--format', 'json']);
        expect([...args]).toEqual(copy);
        expect(out).not.toBe(args);
    });

    it('rejects non-string executable or non-array args', () => {
        expect(() => stripReadOnlyToolCacheArgs('', ['.'])).toThrow(/executable/);
        expect(() => stripReadOnlyToolCacheArgs('eslint', null as unknown as string[])).toThrow(/args/);
    });

    it('skips --cache-location operand when --cache present even if location is last', () => {
        expect(stripReadOnlyToolCacheArgs('eslint', ['--cache', '--cache-location'])).toEqual([]);
    });
});
```

- [ ] Run CMD-UNIT — expect FAIL (module missing).
- [ ] **GREEN:** Add `cli/src/commands/sensors/read-only-tool-cache.ts`:

```typescript
/**
 * Admission readOnly spawn filter (issue #240 / DD-8). For executable === 'eslint'
 * only, removes ESLint tool-cache argv so sensors do not create ./.eslintcache.
 * Operator runs keep --cache; non-eslint tools keep their argv (e.g. rubocop --cache false).
 */
export function stripReadOnlyToolCacheArgs(executable: string, args: readonly string[]): string[] {
    if (typeof executable !== 'string' || executable.trim() === '') {
        throw new Error('stripReadOnlyToolCacheArgs executable must be a nonempty string');
    }
    if (!Array.isArray(args)) throw new Error('stripReadOnlyToolCacheArgs args must be an array');
    for (const [index, arg] of args.entries()) {
        if (typeof arg !== 'string' || arg === '') {
            throw new Error(`stripReadOnlyToolCacheArgs args[${index}] must be a nonempty string`);
        }
    }
    if (executable !== 'eslint') return [...args];
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
- [ ] Commit: `feat(sensors): add eslint-only stripReadOnlyToolCacheArgs (#240)`.

#### Edge cases

- Multiple `--cache` tokens (eslint): all removed when any `--cache` was present.
- `--cache-location` without following operand: skip the flag only.
- `executable` other than exact `'eslint'` (including `ESLint`, path basenames): no strip (R9 is exact match on prepared `executable` field, which packs set to `eslint`).
- Non-array / empty-string args / empty executable: throw.
- Frozen input array: must not mutate.

#### Evidence

CMD-UNIT proves R1, R6, R9. Spec + quality reviews on S1.

#### Fallback

If packs set `executable` to a path basename other than `eslint`, amend DD-8 (e.g. compare path.basename). Do not silently strip all executables. Equals-form `--cache-location=` requires a separate amendment.

---

<a id="slice-s2"></a>
### Slice S2: Wire strip into readOnly execute path

#### Surfaces

Owns R2, R3, R5, R7, R8 (R1/R6/R9 owned by S1; this slice applies the helper so R5 holds end-to-end). Modify `cli/src/commands/sensors/run.ts`. Add `cli/tests/commands/sensors/run-read-only-tool-cache.test.ts` (mock cases + one real-eslint case titled exactly `real eslint binary under readOnly does not leave .eslintcache` for CMD-REAL). Grouping: wire-up + integration share the readOnly execute boundary.

#### Implementation

- [ ] **RED:** Add `cli/tests/commands/sensors/run-read-only-tool-cache.test.ts` modeled on `run-cache.test.ts` (mock `runStructuredCommand` + `runCommand`, tmp project / pack fixture).

Minimum mock cases:

1. **R5 (mock):** structured `executable: 'eslint'` with `--cache`; mock writes `.eslintcache` only if `args.includes('--cache')`. Under `readOnly`, expect no `.eslintcache` and `reason !== 'read-only-mutation-detected'`; assert spawn args lack `--cache`.
2. **R2:** without `readOnly`, mock receives `--cache`.
3. **R3:** `readOnly` (+ optional `useCache: true`) creates no `cache-*.json` under `.awm/sensors/runs/`.
4. **R7:** mock writes `src/touched.ts` → `reason === 'read-only-mutation-detected'`.
5. **R8:** legacy `cmd` string still contains `--cache` when passed to `runCommand`.
6. **R9 (wire):** structured `executable: 'rubocop'` (or other non-eslint) with args `['--cache', 'false']` under `readOnly` — mock receives `--cache` and `false` intact.

- [ ] **RED (H2 / R5 real):** same file, test name exactly `real eslint binary under readOnly does not leave .eslintcache`:
  - Do **not** mock `runStructuredCommand` for this test (or use `jest.requireActual` for exec).
  - Tmp project with `eslint.config.awm.mjs`, a lintable source file, and a structured lint sensor whose command is `executable: 'eslint'`, `resolution: 'node-modules-bin'`, args including `--cache` (no `--cache-location` or with a root location that would create `.eslintcache`).
  - Ensure `eslint` resolves from the fixture’s `node_modules` (install or symlink the repo’s eslint) so the real binary runs.
  - `rm -f .eslintcache`; `runSensors({ cwd, readOnly: true, all: true })`; assert `fs.existsSync('.eslintcache') === false` and `out.reason !== 'read-only-mutation-detected'` (overall may still be non-pass for unrelated sensors — disable other sensors).

- [ ] Run CMD-RO and CMD-REAL — expect FAIL before wire-up.
- [ ] **GREEN:** In `run.ts`, import helper; extend `runPreparedSlot(..., readOnly: boolean)`; before `executePrepared`:

```typescript
let executionForRun = execution;
if (readOnly && execution.command?.kind === 'structured') {
    const { value } = execution.command;
    executionForRun = {
        ...execution,
        command: {
            kind: 'structured',
            value: {
                ...value,
                args: stripReadOnlyToolCacheArgs(value.executable, value.args),
            },
        },
    };
}
const raw = await executePrepared(executionForRun, projectCwd);
```

  Pass `opts.readOnly === true` into pooled `runPreparedSlot`. Do not strip legacy (R8).

- [ ] Run CMD-RO, CMD-REAL, CMD-CACHE-RF211, CMD-UNIT, CMD-TYPECHECK, CMD-LINT — all PASS.
- [ ] Commit: `fix(sensors): strip eslint tool-cache argv under readOnly admission (#240)`.

#### Edge cases

- Cache hit path unused under admission `readOnly` (R3).
- Synthetic skip: strip unused — OK.
- Do not exclude `.awm/sensors/runs` (DD-4).
- Real-eslint test must not depend on network; use local `node_modules`.

#### Evidence

CMD-RO: R2/R3/R5(mock)/R7/R8/R9(wire). CMD-REAL: R5 real binary (H2). CMD-CACHE-RF211: R3. Closure = all closureCommands green.

#### Fallback

If real-eslint fixture is too heavy for CI windows, amend to pin a documented `cli` script that runs the same assertion and keep CMD-REAL as that npm script — do not drop H2. Registry R4 remains separate.

---

## Traceability matrix

| Req | Task(s) | Test(s) |
|-----|---------|---------|
| R1 | S1 | CMD-UNIT (eslint strip + DD-7) |
| R2 | S2 | CMD-RO without readOnly keeps `--cache` |
| R3 | S2 | CMD-RO no `cache-*.json`; CMD-CACHE-RF211 |
| R5 | S2 | CMD-RO mock; CMD-REAL real eslint binary (H2) |
| R6 | S1 | CMD-UNIT frozen/non-mutate + validation throws |
| R7 | S2 | CMD-RO writes `src/touched.ts` → mutation detected |
| R8 | S2 | CMD-RO legacy `cmd` keeps `--cache` |
| R9 | S1 | CMD-UNIT rubocop; CMD-RO wire keeps non-eslint `--cache` |

**Deferred (not this plan):** design R4 → companion plan in `awm-baseline-registry`.

## Self-review

1. Traceability: R1–R3, R5–R9 covered; R4 deferred; audit H1→R9/DD-8, H2→CMD-REAL.
2. Placeholders: none.
3. Types: `stripReadOnlyToolCacheArgs(executable: string, args: readonly string[]) => string[]` consistent.
4. UI: none.
5. Ownership: R9 only on S1; CMD-RO may cover R9 without owning it.
