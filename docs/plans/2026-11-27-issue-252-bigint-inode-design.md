# Design: BigInt high-bit inode observability (#252)

**Status:** approved 2026-11-27 (owner)  
**Issue:** https://github.com/Kodria/agentic-workflow/issues/252  
**Branch:** `cursor/issue-252-bigint-inode-6441`  
**Change Record:** `bigint-inode-observability`  
**Approach:** Enfoque 2 — helper de observabilidad compartido

## Goal

On hosts where Node exposes uint64 inodes/devices as signed BigInt (high bit set → negative), AWM must treat those identities as observable so Codex Cloud / similar sandboxes can run `awm registry add` and skill discovery without `directory identity is unobservable`, while still rejecting inode zero and leaving digests/equality on raw Node BigInts.

## Owner decisions (locked)

| Fork | Choice |
|------|--------|
| Scope | Inode/device observability only — Codex alpha version acceptance **out** |
| Blast radius | Shared helper + all BigInt identity gates that predicate `ino`/`dev` (`discovery.ts` and `ino === 0n` / `!== 0n` sisters) |
| Representation | Observability via `BigInt.asUintN(64, …)`; equality and `toString()` digests stay on raw Node BigInt |
| Device sign check | Remove value/sign rejection; any `bigint` `dev` is observable |

## Specialist verdicts (at approach selection)

- **architecture-advisor:** not applicable — local FS-identity predicates, no module-boundary redesign.
- **technology-evaluator:** not applicable — stay on Node `fs` + BigInt.
- **nfr-checklist-generator:** trivial — keep zero-inode reject; do not re-hash identities.

## Scope

**In**

- New helper module `cli/src/core/fs-identity.ts`
- Migrate `cli/src/core/discovery.ts` (`ino <= 0n`, `dev < 0n`)
- Migrate BigInt `ino === 0n` / `!== 0n` call sites: `admission/registry-contracts.ts`, `commands/job/exec-wrapper.ts`, `core/plan/validate.ts`
- Unit tests for the helper and discovery high-bit / zero cases
- Change Record + draft PR closing #252

**Out**

- Accepting `codex-cli` prerelease / alpha version strings in `awm init`
- Number-based identity helpers (`paths.ts` `ino !== 0`, etc.)
- Canonicalizing `ino`/`dev` to unsigned for equality or identity strings
- Registry content / baseline-registry changes

## Requirements (EARS)

- **RF-1.1** — WHEN AWM observes `dev`/`ino` via `fs.*Stat*(…, { bigint: true })`, THEN THE CLI SHALL decide inode observability only with `BigInt.asUintN(64, ino) !== 0n` (accept high-bit; reject zero).
- **RF-1.2** — WHEN validating device observability, THEN THE CLI SHALL require only that `dev` is a `bigint`; SHALL NOT reject by sign or numeric value (including high bit).
- **RF-1.3** — IF `BigInt.asUintN(64, ino) === 0n`, THEN THE CLI SHALL fail closed with the existing identity unavailable / unobservable error class (message contracts unchanged).
- **RF-1.4** — THE CLI SHALL expose a shared helper under `cli/src/core/` used by BigInt identity gates that predicate `ino`/`dev` (`discovery.ts` and the `ino === 0n` / `!== 0n` sisters listed in Scope); equality and `dev.toString():ino.toString()` digests SHALL use the raw Node BigInt — no unsigned canonicalization.
- **RF-1.5** — THE suite SHALL cover: high-bit (signed-negative) inode accepted; `0n` rejected; signed-negative `dev` does not block; two Node stats with the same high-bit inode still compare equal on raw BigInt.
- **RF-1.6** — THE change SHALL NOT accept Codex prereleases, SHALL NOT alter Number-based `ino` predicates, and SHALL NOT change identity-string / digest formatting for high-bit inodes.

## Architecture

**Module:** `cli/src/core/fs-identity.ts`

```ts
/** Node bigint stats encode uint64 inodes as signed; observable iff unsigned 64-bit ≠ 0. */
export function isObservableInode(ino: bigint): boolean {
    return BigInt.asUintN(64, ino) !== 0n;
}

/**
 * Device ids may appear signed-negative when the high bit is set.
 * Any bigint device id is observable; callers still require typeof === 'bigint'.
 */
export function isObservableDev(dev: bigint): boolean {
    void dev;
    return true;
}
```

**Call-site migration**

| Site | Today | After |
|------|-------|-------|
| `discovery.ts` (dir + file) | `dev < 0n`, `ino <= 0n` | `!isObservableDev(dev)` / `!isObservableInode(ino)` after typeof bigint checks |
| `admission/registry-contracts.ts` | `ino === 0n` | `!isObservableInode(ino)` |
| `job/exec-wrapper.ts` | `ino === 0n` | `!isObservableInode(ino)` |
| `plan/validate.ts` | `ino !== 0n` | `isObservableInode(ino)` |

**Invariants**

- Raw BigInt equality between two Node stats unchanged.
- Identity digests keep `dev.toString()` / `ino.toString()` on raw values (signed string for high-bit stays).
- Existing error message text/classes unchanged.
- Number-based paths untouched.

### Flow (Codex Cloud after)

1. `lstat('/workspace', { bigint: true }).ino` → signed-negative high-bit value.
2. `isObservableInode` → `asUintN(64, ino) !== 0n` → accept.
3. Parent/leaf identity continues; discovery / registry add no longer abort as unobservable.

## Error / edge paths

| Case | Outcome |
|------|---------|
| `ino === 0n` | Reject (unobservable / unavailable) — RF-1.3 |
| High-bit inode (e.g. `-9223372036854775716n`) | Accept — RF-1.1 |
| High-bit / negative `dev` | Accept — RF-1.2 |
| `typeof ino/dev !== 'bigint'` | Reject as today |
| Two stats same high-bit `ino`/`dev` | Equality holds on raw BigInt — RF-1.5 |
| Identity string for high-bit inode | Remains signed `toString()` — RF-1.4 / RF-1.6 |

## Testing

- New `cli/tests/core/fs-identity.test.ts`: table for `0n` false; positive true; issue exemplar negative true; `asUintN` round-trip vs unsigned `stat` value; assert raw `.toString()` ≠ `asUintN(...).toString()` for high-bit (documents digest invariant).
- Extend `cli/tests/core/discovery-safe-read.test.ts`: parent/leaf with high-bit `ino` and negative `dev` discover successfully; `ino: 0n` on parent still throws `/directory identity/`.
- Sister call sites: migration is behavior-preserving for `=== 0n`; no new product behavior required beyond compile + existing suites green. Optional one-liner assert in registry-contracts tests only if a cheap existing fixture already mocks bigint ino — do not invent heavy new harnesses.

## UI Screens

None — no direct interaction / layout surface.

## Self-review

- No TBD/TODO placeholders.
- Scope matches locked owner decisions (Codex alpha out; no digest canonicalization).
- Each RF is 1:1 testable (helper unit + discovery mocks + digest string invariant).
- `ino === 0n` sites already accept high-bit; migrating them to the helper closes the door without changing behavior and prevents future `<=` regressions.
- No contradiction with identity hashing in `registry-contracts.ts`.
