# Probe timeout honesty (#242) Implementation Plan

<!-- awm-qa-complete: 2026-11-11 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound compatibility probes at 30 s and surface `probe-timeout` (and sibling spawn/overflow/exception reasons) instead of collapsing them to `probe-inconclusive`, so load-induced probe delays do not falsely look like bad probes (#242).

**Architecture:** Keep the closed probe runner and pure resolver. Raise the fixed child timeout from 5_000 to 30_000 ms in `probe.ts` and `live.ts` via one exported constant on the existing `timeout.ts` helper module. Teach `resolve.ts` to propagate the RF-3 unverifiable reasons when present; keep `probe-inconclusive` only as the fallback (RF-4). No pack schema, no retry, no execution-timeout changes.

**Tech Stack:** TypeScript CLI (`cli/`), Jest unit tests under `cli/tests/commands/sensors/compatibility/`.

**Change Record:** `probe-timeout-honesty`

**Criterios de aceptación:**
- Con Semgrep instalado y máquina bajo carga moderada, `awm sensors run` no marca `security` como `unverifiable: probe-inconclusive` solo por arranque lento (<30 s) → el sensor corre o, si el plazo sí vence, el skipReason nombra `probe-timeout`
- Forzar un probe timedOut en test/fake → `resolve` reporta reason `probe-timeout` (no `probe-inconclusive`)
- Un probe `unverifiable` sin reason específico → sigue `probe-inconclusive`

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** #242. Design: `docs/plans/2026-11-11-probe-timeout-honesty-design.md` (owner-approved). Dispatch: owner did not select AWM routing → `compact-slices/v1`.

**Amendment (2026-11-11, audit #251 P1):** Replace the `live.ts` source-text pin with a behavior test: export `pathPackageManagerVersion` with optional `spawn` inject (default `spawnSync`) and assert `timeout: COMPATIBILITY_PROBE_TIMEOUT_MS` on the options passed to the mock. P2 (CLI reference docs) remains out of scope; P3 (PR title `fix(sensors):`) applies when code lands.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "probe-timeout-honesty",
  "requirements": ["RF-1", "RF-2", "RF-3", "RF-4", "RF-5"],
  "sources": [
    {
      "id": "SRC-PROBE",
      "path": "cli/src/commands/sensors/compatibility/probe.ts",
      "locator": "timeout: 5_000",
      "fact": "runCompatibilityProbe passes `{ cwd, timeout: 5_000, maxBuffer: 64 * 1024 }` to the executor. On `result.timedOut` it already returns `{ status: 'unverifiable', reason: 'probe-timeout' }`; overflow → `probe-output-limit`; spawnError → `probe-spawn-error`; catch → `probe-exception`."
    },
    {
      "id": "SRC-LIVE",
      "path": "cli/src/commands/sensors/compatibility/live.ts",
      "locator": "pathPackageManagerVersion",
      "fact": "pathPackageManagerVersion is a private helper that calls spawnSync(tool, ['--version'], { ..., timeout: 5_000, maxBuffer: 1024, ... }). For RF-2 + audit P1: export it as pathPackageManagerVersion(tool, spawn = spawnSync), pass COMPATIBILITY_PROBE_TIMEOUT_MS as timeout, and keep discoverProjectEvidence wired to the same function (default spawn). Behavior test must mock spawn and assert timeout on the options object — never regex the .ts source."
    },
    {
      "id": "SRC-RESOLVE",
      "path": "cli/src/commands/sensors/compatibility/resolve.ts",
      "locator": "probe-inconclusive",
      "fact": "After selecting the unique best variant, line ~81 does: if probe status !== 'matched', return unverifiable with reason `probe-not-matched` when status === 'not-matched', else always `probe-inconclusive`. ResolveEvidence types probe as `{ status?: string }` only — reason is not read today, so probe-timeout from SRC-PROBE is discarded."
    },
    {
      "id": "SRC-TIMEOUT-HELPER",
      "path": "cli/src/commands/sensors/compatibility/timeout.ts",
      "locator": "resolveTimeout",
      "fact": "timeout.ts already exports positiveTimeout and resolveTimeout for *sensor execution* deadlines (project/pack/fallback). It does not yet export a compatibility-probe bound. Adding `export const COMPATIBILITY_PROBE_TIMEOUT_MS = 30_000` here is the single source for RF-2 without inventing pack/manifest config."
    },
    {
      "id": "SRC-PROBE-TEST",
      "path": "cli/tests/commands/sensors/compatibility/probe.test.ts",
      "locator": "never treats a timeout or overflow as a match",
      "fact": "Existing timeout test only asserts `status: 'unverifiable'`; it does not assert `reason: 'probe-timeout'` and does not assert the executor options.timeout value."
    },
    {
      "id": "SRC-RESOLVE-TEST",
      "path": "cli/tests/commands/sensors/compatibility/resolve.test.ts",
      "locator": "resolves %s without conflating states",
      "fact": "Table covers state `unverifiable` with `{ status: 'unverifiable' }` but does not assert reason strings, nor RF-3 propagation of probe-timeout / probe-output-limit / probe-spawn-error / probe-exception."
    }
  ],
  "commands": [
    {
      "id": "CMD-PROBE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/compatibility/probe.test.ts"],
      "covers": ["RF-1", "RF-2"]
    },
    {
      "id": "CMD-RESOLVE",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/sensors/compatibility/resolve.test.ts"],
      "covers": ["RF-3", "RF-4", "RF-5"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "30s probe bound + honest unresolved reasons",
      "requirements": ["RF-1", "RF-2", "RF-3", "RF-4", "RF-5"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-PROBE", "SRC-LIVE", "SRC-RESOLVE", "SRC-TIMEOUT-HELPER", "SRC-PROBE-TEST", "SRC-RESOLVE-TEST"],
      "redCommands": ["CMD-PROBE", "CMD-RESOLVE"],
      "greenCommands": ["CMD-PROBE", "CMD-RESOLVE"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-PROBE", "CMD-RESOLVE"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

## Requirements

- **RF-1.** WHEN a compatibility probe child exceeds its deadline, THE system SHALL return probe status `unverifiable` with reason `probe-timeout`.
- **RF-2.** THE system SHALL bound every compatibility probe executor call and every live package-manager `--version` probe to `30_000` milliseconds.
- **RF-3.** IF probe evidence has status `unverifiable` AND reason is one of `probe-timeout` | `probe-output-limit` | `probe-spawn-error` | `probe-exception`, THEN THE system SHALL set compatibility `reason` to that same string (not `probe-inconclusive`).
- **RF-4.** IF probe evidence has status `unverifiable` AND reason is absent or not in the RF-3 set, THEN THE system SHALL set compatibility `reason` to `probe-inconclusive`.
- **RF-5.** IF probe status is `not-matched`, THEN THE system SHALL keep compatibility `reason` `probe-not-matched` (unchanged).

## File map

| File | Role |
|------|------|
| `cli/src/commands/sensors/compatibility/timeout.ts` | Add `COMPATIBILITY_PROBE_TIMEOUT_MS = 30_000` |
| `cli/src/commands/sensors/compatibility/probe.ts` | Use the constant as executor `timeout` |
| `cli/src/commands/sensors/compatibility/live.ts` | Use the constant as spawnSync `timeout` |
| `cli/src/commands/sensors/compatibility/resolve.ts` | Propagate RF-3 reasons; widen `ResolveEvidence.probe` type |
| `cli/tests/.../probe.test.ts` | Kill-tests for RF-1 / RF-2 |
| `cli/tests/.../resolve.test.ts` | Kill-tests for RF-3 / RF-4 / RF-5 |

<a id="slice-s1"></a>
### Slice S1: 30s probe bound + honest unresolved reasons

#### Surfaces
Owns RF-1–RF-5 as one compatibility-honesty boundary: the probe deadline and the resolver reason mapping must land together or operators still see misleading `probe-inconclusive` under load. Files listed in File map. Grouping rationale: raising the bound without reason propagation leaves diagnostics opaque; propagating reasons without raising the bound leaves the false skip under load. No registry pack edits; no retry; no `resolveTimeout` / execution timeout changes.

#### Implementation
Dependencies: none. Inputs: approved design RF-1–RF-5. Outputs: GREEN CMD-PROBE and CMD-RESOLVE.

1. **RED — probe tests (RF-1, RF-2)** — Edit `cli/tests/commands/sensors/compatibility/probe.test.ts`:
   - Import `COMPATIBILITY_PROBE_TIMEOUT_MS` from the timeout helper (will fail until exported).
   - Replace the timeout half of `never treats a timeout or overflow as a match` so a timedOut executor result must equal `{ status: 'unverifiable', reason: 'probe-timeout' }` (not merely status).
   - Add a dedicated test that runs `runCompatibilityProbe({ kind: 'version' }, evidence, fakeExecutor)` and asserts `fakeExecutor` was called with options containing `timeout: COMPATIBILITY_PROBE_TIMEOUT_MS` and that `COMPATIBILITY_PROBE_TIMEOUT_MS === 30_000`.
   - Add a source pin for the live path: read `cli/src/commands/sensors/compatibility/live.ts` as UTF-8 and assert it imports/uses `COMPATIBILITY_PROBE_TIMEOUT_MS` (so RF-2 cannot silently leave `5_000` on spawnSync). Exact assertions:

```typescript
import { COMPATIBILITY_PROBE_TIMEOUT_MS } from '../../../../src/commands/sensors/compatibility/timeout';
import fs from 'fs';
import path from 'path';

// inside describe:
it('reports probe-timeout when the executor times out (RF-1)', async () => {
    fakeExecutor.mockResolvedValueOnce(execResult({ code: null, signal: 'SIGKILL', timedOut: true, stdout: '' }));
    await expect(runCompatibilityProbe({ kind: 'version' }, evidence, fakeExecutor))
        .resolves.toEqual({ status: 'unverifiable', reason: 'probe-timeout' });
});

it('bounds the probe executor at COMPATIBILITY_PROBE_TIMEOUT_MS (RF-2)', async () => {
    expect(COMPATIBILITY_PROBE_TIMEOUT_MS).toBe(30_000);
    await runCompatibilityProbe({ kind: 'version' }, evidence, fakeExecutor);
    expect(fakeExecutor).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ timeout: COMPATIBILITY_PROBE_TIMEOUT_MS }),
    );
});

it('bounds the live package-manager version probe at COMPATIBILITY_PROBE_TIMEOUT_MS (RF-2, audit P1)', () => {
    const spawn = jest.fn().mockReturnValue({
        status: 0, error: undefined, signal: null, stdout: '10.9.2\n', stderr: '',
    });
    const { pathPackageManagerVersion } = require('../../../../src/commands/sensors/compatibility/live');
    expect(pathPackageManagerVersion('npm', spawn)).toBe('10.9.2');
    expect(spawn).toHaveBeenCalledWith(
        'npm',
        ['--version'],
        expect.objectContaining({ timeout: COMPATIBILITY_PROBE_TIMEOUT_MS }),
    );
});
```

   Prefer a static import of `pathPackageManagerVersion` from `live.ts` if Jest + TS path already resolves (same as other compatibility tests); use `require` only if a circular import appears. Do **not** add `fs`/`path` source-text pins for RF-2.

   Keep the existing overflow assertion (`status: 'unverifiable'`) or tighten it to `reason: 'probe-output-limit'` in the same file if the old combined test is split — do not weaken overflow coverage.

2. **RED — resolve tests (RF-3, RF-4, RF-5)** — Append to `cli/tests/commands/sensors/compatibility/resolve.test.ts`:

```typescript
test.each([
    ['probe-timeout', 'probe-timeout'],
    ['probe-output-limit', 'probe-output-limit'],
    ['probe-spawn-error', 'probe-spawn-error'],
    ['probe-exception', 'probe-exception'],
] as const)('propagates unverifiable probe reason %s (RF-3)', (probeReason, expected) => {
    expect(resolveSensorCompatibility(
        sensor as any,
        evidence({ probe: { status: 'unverifiable', reason: probeReason } }),
        context,
    )).toMatchObject({ state: 'unverifiable', reason: expected, variantId: 'eslint-main' });
});

it('falls back to probe-inconclusive when unverifiable reason is absent or unknown (RF-4)', () => {
    expect(resolveSensorCompatibility(sensor as any, evidence({ probe: { status: 'unverifiable' } }), context))
        .toMatchObject({ state: 'unverifiable', reason: 'probe-inconclusive' });
    expect(resolveSensorCompatibility(
        sensor as any,
        evidence({ probe: { status: 'unverifiable', reason: 'something-else' } }),
        context,
    )).toMatchObject({ state: 'unverifiable', reason: 'probe-inconclusive' });
});

it('keeps probe-not-matched for not-matched probes (RF-5)', () => {
    expect(resolveSensorCompatibility(
        sensor as any,
        evidence({ probe: { status: 'not-matched', reason: 'probe-exit-nonzero' } }),
        context,
    )).toMatchObject({ state: 'unverifiable', reason: 'probe-not-matched', variantId: 'eslint-main' });
});
```

3. **Run RED** — Execute CMD-PROBE and CMD-RESOLVE; expect failures (missing export and/or still-collapsed reasons / still `5_000`).

4. **GREEN — timeout constant** — In `cli/src/commands/sensors/compatibility/timeout.ts`, add after the existing exports:

```typescript
/** Bound for compatibility probes and live package-manager --version reads (not sensor execution). */
export const COMPATIBILITY_PROBE_TIMEOUT_MS = 30_000;
```

5. **GREEN — probe.ts** — Import `COMPATIBILITY_PROBE_TIMEOUT_MS` from `./timeout` and replace `timeout: 5_000` with `timeout: COMPATIBILITY_PROBE_TIMEOUT_MS`. Do not change the timedOut / overflow / spawnError / catch reason mapping (already RF-1 compliant).

6. **GREEN — live.ts** — Import `COMPATIBILITY_PROBE_TIMEOUT_MS` from `./timeout`. Export `pathPackageManagerVersion` with signature `(tool: string, spawn: typeof spawnSync = spawnSync): string | null`, use `timeout: COMPATIBILITY_PROBE_TIMEOUT_MS` in the spawn options, and keep the existing call site `discoverProjectEvidence(..., { pathToolVersion: pathPackageManagerVersion })` (default spawn).

7. **GREEN — resolve.ts** — Widen the probe field on `ResolveEvidence`:

```typescript
probe?: { status?: string; reason?: string };
```

   Replace the probe branch (~line 81) with:

```typescript
const SPECIFIC_UNVERIFIABLE = new Set([
    'probe-timeout',
    'probe-output-limit',
    'probe-spawn-error',
    'probe-exception',
]);
if (evidence.probe?.status !== 'matched') {
    if (evidence.probe?.status === 'not-matched') {
        return result('unverifiable', 'probe-not-matched', best, evidence);
    }
    const probeReason = evidence.probe?.reason;
    const reason = typeof probeReason === 'string' && SPECIFIC_UNVERIFIABLE.has(probeReason)
        ? probeReason
        : 'probe-inconclusive';
    return result('unverifiable', reason, best, evidence);
}
```

8. **Run GREEN** — CMD-PROBE and CMD-RESOLVE must pass.

9. **Commit** — Conventional message: `fix(sensors): honor probe-timeout and raise probe deadline to 30s` (body references #242).

#### Edge cases
- Probe status omitted / `undefined` → RF-4 `probe-inconclusive` (existing table row `unverifiable` with bare status must keep passing with reason asserted).
- Unknown unverifiable reason string → RF-4, never pass-through (do not forward arbitrary probe reason text into compatibility reason).
- `not-matched` with any reason string → RF-5 always `probe-not-matched`.
- Overflow / spawn / exception reasons must not be remapped to timeout.
- Do not change execution `resolveTimeout` fallbacks (10_000 / 120_000) — those are not RF-2.
- Live RF-2 test must fail if `spawn` is called without `timeout: COMPATIBILITY_PROBE_TIMEOUT_MS` (even if the constant is imported unused).
- Non package-manager tools (`pathPackageManagerVersion('eslint', spawn)`) still return null without calling spawn.

#### Evidence
- Declared sources SRC-PROBE, SRC-LIVE, SRC-RESOLVE, SRC-TIMEOUT-HELPER, SRC-PROBE-TEST, SRC-RESOLVE-TEST.
- RED/GREEN: CMD-PROBE (RF-1, RF-2), CMD-RESOLVE (RF-3, RF-4, RF-5).
- Independent specification and code-quality reviews required; reconcile files, tests, sensors, and CLI-derived plan identity before slice completion.
- Closure: both CMD-PROBE and CMD-RESOLVE green on the final tree.

#### Fallback
Risk `full-context` / fallback `public-contract`: if reason allowlisting or the shared constant proves insufficient (e.g. prepare/skipReason path needs a separate contract), amend the design, revalidate the plan, and re-admit under the new digest — do not silently add retry or pack-level probe timeout config (explicitly Out of design).

## Traceability

| Req | Task(s) | Test(s) |
|-----|---------|---------|
| RF-1 | S1 steps 1, 4–5 | `reports probe-timeout when the executor times out` via CMD-PROBE |
| RF-2 | S1 steps 1, 4–6 | `bounds the probe executor…` + live `pathPackageManagerVersion` mock-spawn timeout assert via CMD-PROBE |
| RF-3 | S1 steps 2, 7 | `propagates unverifiable probe reason %s` via CMD-RESOLVE |
| RF-4 | S1 steps 2, 7 | `falls back to probe-inconclusive…` via CMD-RESOLVE |
| RF-5 | S1 steps 2, 7 | `keeps probe-not-matched…` via CMD-RESOLVE |

## Self-review

- Forward/backward coverage complete for RF-1–RF-5.
- No TBD/TODO; complete code in RED/GREEN steps.
- Constant name and RF-3 allowlist are consistent across steps.
- Out-of-scope (config, retry, execution timeouts) not tasked.
