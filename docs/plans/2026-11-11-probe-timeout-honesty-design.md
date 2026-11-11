# Design: Compatibility probe timeout honesty (#242)

**Status:** approved 2026-11-11 (owner)  
**Issue:** https://github.com/Kodria/agentic-workflow/issues/242  
**Branch:** `cursor/issue-242-probe-timeout-aac5`  
**Change Record:** `probe-timeout-honesty`

## Goal

Compatibility probes must tolerate normal host load without false `probe-inconclusive`, and when a probe deadline still fires the compatibility reason must name the timeout (not a generic inconclusive).

## Owner decisions (locked)

| Fork | Choice |
|------|--------|
| Scope | Raise fixed probe deadline + preserve specific unverifiable reasons |
| Default deadline | **30_000** ms (was 5_000) |
| Per-sensor / pack config | **Out** (YAGNI) |
| Retry on timeout | **Out** (YAGNI) |
| Execution `timeoutMs` / `resolveTimeout` | Unchanged |

## Scope

**In**

- `cli/src/commands/sensors/compatibility/probe.ts` — pass `timeout: 30_000` to the probe executor
- `cli/src/commands/sensors/compatibility/live.ts` — pass `timeout: 30_000` to package-manager `--version` `spawnSync`
- `cli/src/commands/sensors/compatibility/resolve.ts` — propagate specific probe unverifiable reasons instead of collapsing all of them to `probe-inconclusive`
- Unit tests for timeout option, `probe-timeout` reason, and resolve propagation / fallback
- Change Record + draft PR closing #242

**Out**

- Configurable probe timeout on pack variants or project manifests
- Automatic retry of a timed-out probe
- Changing sensor execution timeouts (`resolveTimeout`, pack/project `timeout`)
- Registry pack content changes
- CPU-load e2e in CI

## Requirements (EARS)

- **RF-1.** WHEN a compatibility probe child exceeds its deadline, THE system SHALL return probe status `unverifiable` with reason `probe-timeout`.
- **RF-2.** THE system SHALL bound every compatibility probe executor call and every live package-manager `--version` probe to `30_000` milliseconds.
- **RF-3.** IF probe evidence has status `unverifiable` AND reason is one of `probe-timeout` | `probe-output-limit` | `probe-spawn-error` | `probe-exception`, THEN THE system SHALL set compatibility `reason` to that same string (not `probe-inconclusive`).
- **RF-4.** IF probe evidence has status `unverifiable` AND reason is absent or not in the RF-3 set, THEN THE system SHALL set compatibility `reason` to `probe-inconclusive`.
- **RF-5.** IF probe status is `not-matched`, THEN THE system SHALL keep compatibility `reason` `probe-not-matched` (unchanged).

## Architecture

Three call sites only:

1. **Probe runner** (`probe.ts`) — already maps `timedOut` → `{ status: 'unverifiable', reason: 'probe-timeout' }`. Change the executor options from `5_000` to `30_000`.
2. **Live package-manager version** (`live.ts` `pathPackageManagerVersion`) — same numeric bound for `spawnSync` so discovery under load matches probe policy. Export the helper with an optional `spawn` inject (default `spawnSync`) so RF-2 is proven by a behavior test that asserts the options object, not by regex over source text (audit P1 on #251).
3. **Resolver** (`resolve.ts`) — today:

   ```ts
   if (evidence.probe?.status !== 'matched')
     return result('unverifiable',
       evidence.probe?.status === 'not-matched' ? 'probe-not-matched' : 'probe-inconclusive',
       best, evidence);
   ```

   Replace the unverifiable branch so RF-3 reasons pass through; otherwise keep `probe-inconclusive` (RF-4). `not-matched` stays RF-5.

Downstream behavior is unchanged structurally: `prepareV2Sensor` still synthesizes `unverifiable: <reason>` when live state is not certified / compatible-unverified. Operators then see `unverifiable: probe-timeout` instead of a misleading inconclusive when the deadline fired.

### Flow under load (after)

1. `semgrep-validate` completes within 30 s → probe `matched` → sensor may run.
2. Probe exceeds 30 s → `probe-timeout` → prepare skipReason `unverifiable: probe-timeout` (honest; still may yield `not_certified`).
3. Probe returns non-zero without timeout → `not-matched` / `probe-not-matched` (unchanged).

## Error / edge paths

| Case | Outcome |
|------|---------|
| Probe `matched` | certified / compatible-unverified as today |
| Probe `not-matched` | `probe-not-matched` |
| Probe timed out / overflow / spawn / exception | RF-3 reason propagated |
| Probe status `unverifiable` without RF-3 reason, or probe omitted | `probe-inconclusive` |
| Tool truly hung | Wait 30 s once, then timeout reason (no retry) |

## Testing

- `probe.test.ts`: assert `reason: 'probe-timeout'` on timedOut executor results; assert executor received `timeout: 30_000`; behavior-test live `pathPackageManagerVersion` via injected mock `spawn` (assert options.timeout), not source regex.
- `resolve.test.ts`: table for each RF-3 reason → same compatibility reason; missing/other → `probe-inconclusive`; `not-matched` unchanged.
- No CI e2e that synthesizes host CPU load.

## Self-review

- No TBD/TODO placeholders.
- Scope matches locked owner decisions (no config, no retry).
- Each RF is 1:1 testable via unit tests above.
- No contradiction with execution-timeout helpers (`resolveTimeout` remains separate).
