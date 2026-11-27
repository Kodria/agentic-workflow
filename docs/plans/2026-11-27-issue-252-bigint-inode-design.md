# Design: BigInt high-bit inode observability (#252)

**Status:** approved 2026-11-27 (owner); **amended 2026-11-27** per PR #253 audit (B1 in-scope, B2 drop `isObservableDev`, B3 follow-up issue)  
**Issue:** https://github.com/Kodria/agentic-workflow/issues/252  
**Branch:** `cursor/issue-252-bigint-inode-6441`  
**Change Record:** `bigint-inode-observability`  
**Approach:** Enfoque 2 — helper de observabilidad compartido + migración Number→BigInt (RF-1.7)

## Goal

On hosts where Node exposes uint64 inodes/devices as signed BigInt (high bit set → negative), AWM must treat those identities as observable so Codex Cloud / similar sandboxes can run `awm registry add` and skill discovery without `directory identity is unobservable`. POSIX identity comparisons that today use JS `Number` for `ino`/`dev` must also use BigInt, because near 2^63 the float spacing is 2048 and distinct inodes collide. Still reject inode zero; leave digests/equality on raw Node BigInts.

## Owner decisions (locked)

| Fork | Choice |
|------|--------|
| Scope | Inode/device observability + POSIX Number→BigInt identity compares (B1) — Codex alpha version acceptance **out** (B3 follow-up issue) |
| Blast radius | Shared helper + all BigInt identity gates that predicate `ino`/`dev` + Number-based FS identity compares listed below |
| Representation | Observability via `BigInt.asUintN(64, …)`; equality and `toString()` digests stay on raw Node BigInt |
| Device sign check | Remove value/sign rejection; any `bigint` `dev` is observable via `typeof === 'bigint'` only (no `isObservableDev` helper — B2) |
| B1 | **In this PR** (owner audit decision) |

## Specialist verdicts (at approach selection)

- **architecture-advisor:** not applicable — local FS-identity predicates, no module-boundary redesign.
- **technology-evaluator:** not applicable — stay on Node `fs` + BigInt.
- **nfr-checklist-generator:** trivial — keep zero-inode reject; do not re-hash identities; fail-closed when Number precision would lie.

## Scope

**In**

- New helper module `cli/src/core/fs-identity.ts` (`isObservableInode` only)
- Migrate `cli/src/core/discovery.ts` (`ino <= 0n`, `dev < 0n`)
- Migrate BigInt `ino === 0n` / `!== 0n` call sites: `admission/registry-contracts.ts`, `commands/job/exec-wrapper.ts`, `core/plan/validate.ts`
- POSIX FS identity comparisons that today use `ino`/`dev` as `Number` (RF-1.7):
  - **Obligatory:** `cli/src/core/paths.ts` `sameExistingPath`
  - **Recommended (same PR):** `cli/src/core/changes/record-io.ts` (`FileSnapshot` / `unchangedSince`), `cli/src/core/model-policy/native-runtime.ts` `hashFile`, `cli/src/commands/watch/request-recovery.ts` `requestEnvelope`
- Unit/kill tests for helper, discovery high-bit/zero, sameExistingPath high-bit collision, and recommended sites
- Change Record + draft PR closing #252

**Out**

- Accepting `codex-cli` prerelease / alpha version strings in `awm init` — **B3:** open a dedicated follow-up issue with the evidence from #252 before closing #252, so the finding is not lost
- Canonicalizing `ino`/`dev` to unsigned for equality or identity strings
- Registry content / baseline-registry changes
- Required change to `sensors/test-results-artifact.ts` (`Number(st.ino)` is fail-closed on collision — optional coherence only)

## Requirements (EARS)

- **RF-1.1** — WHEN AWM observes `dev`/`ino` via `fs.*Stat*(…, { bigint: true })`, THEN THE CLI SHALL decide inode observability only with `BigInt.asUintN(64, ino) !== 0n` (accept high-bit; reject zero).
- **RF-1.2** — WHEN validating device observability, THEN THE CLI SHALL require only that `dev` is a `bigint`; SHALL NOT reject by sign or numeric value (including high bit). Call sites use `typeof dev === 'bigint'` — no separate always-true helper.
- **RF-1.3** — IF `BigInt.asUintN(64, ino) === 0n`, THEN THE CLI SHALL fail closed with the existing identity unavailable / unobservable error class (message contracts unchanged).
- **RF-1.4** — THE CLI SHALL expose `isObservableInode` under `cli/src/core/fs-identity.ts` used by BigInt identity gates that predicate `ino` (`discovery.ts` and the `ino === 0n` / `!== 0n` sisters listed in Scope); equality and `dev.toString():ino.toString()` digests SHALL use the raw Node BigInt — no unsigned canonicalization.
- **RF-1.5** — THE suite SHALL cover: high-bit (signed-negative) inode accepted; `0n` rejected; signed-negative `dev` does not block; two Node stats with the same high-bit inode still compare equal on raw BigInt.
- **RF-1.6** — THE change SHALL NOT accept Codex prereleases and SHALL NOT change identity-string / digest formatting for high-bit inodes.
- **RF-1.7** — WHEN AWM compares filesystem identity (`dev`/`ino`) to decide that two paths or two observations are the same object, THEN THE CLI SHALL obtain both via `{ bigint: true }` stats and compare BigInt values; SHALL NOT compare `ino`/`dev` as JS `Number` (values ≥ 2^53 lose precision; near 2^63 the spacing is 2048).

## Architecture

**Module:** `cli/src/core/fs-identity.ts`

```ts
/** Node bigint stats encode uint64 inodes as signed; observable iff unsigned 64-bit ≠ 0. */
export function isObservableInode(ino: bigint): boolean {
    return BigInt.asUintN(64, ino) !== 0n;
}
```

No `isObservableDev` — callers keep `typeof … === 'bigint'` only (B2).

**Call-site migration**

| Site | Today | After | Priority |
|------|-------|-------|----------|
| `discovery.ts` (dir + file) | `dev < 0n`, `ino <= 0n` | `typeof === 'bigint'` + `isObservableInode(ino)` | obligatory |
| `admission/registry-contracts.ts` | `ino === 0n` | `!isObservableInode(ino)` | obligatory |
| `job/exec-wrapper.ts` | `ino === 0n` | `!isObservableInode(ino)` | obligatory |
| `plan/validate.ts` | `ino !== 0n` | `isObservableInode(ino)` | obligatory |
| `paths.ts` `sameExistingPath` | `statSync` Number; `sa.ino !== 0 && …` | `statSync(…, { bigint: true })`; `isObservableInode(sa.ino) && isObservableInode(sb.ino) && sa.dev === sb.dev && sa.ino === sb.ino` (still gated by `!isWindowsNative()`) | **obligatory** |
| `changes/record-io.ts` | `FileSnapshot.ino: number`; Number compare with Windows `0` tolerance | snapshot + re-stat `{ bigint: true }`; `ino: bigint`; `!isObservableInode` for Windows-zero tolerance | recommended |
| `model-policy/native-runtime.ts` | Number `statSync` before/after hash | both `{ bigint: true }`; compare `dev`/`ino`/`size` as BigInt; keep `mtimeMs` (or switch to `mtimeNs`) | recommended |
| `watch/request-recovery.ts` | Number `lstat`/`fstat` | both `{ bigint: true }`; `size` vs `BigInt(MAX_REQUEST_BYTES)` | recommended |
| `sensors/test-results-artifact.ts` | `Number(st.ino)` | unchanged (fail-closed) | — |

**Invariants**

- Raw BigInt equality between two Node stats unchanged.
- Identity digests keep `dev.toString()` / `ino.toString()` on raw values.
- Existing error message text/classes unchanged.
- Windows: `sameExistingPath` still skips inode fallback under `isWindowsNative()`.

### Flow (Codex Cloud after)

1. `lstat('/workspace', { bigint: true }).ino` → signed-negative high-bit value.
2. `isObservableInode` → `asUintN(64, ino) !== 0n` → accept.
3. Parent/leaf identity continues; discovery / registry add no longer abort as unobservable.
4. Two distinct paths with inodes `2^63+92` and `2^63+900` no longer collide via `Number` in `sameExistingPath` / sister compares.

## Error / edge paths

| Case | Outcome |
|------|---------|
| `ino === 0n` | Reject (unobservable / unavailable) — RF-1.3 |
| High-bit inode (e.g. `-9223372036854775716n`) | Accept — RF-1.1 |
| High-bit / negative `dev` | Accept via typeof bigint — RF-1.2 |
| `typeof ino/dev !== 'bigint'` | Reject as today |
| Two stats same high-bit `ino`/`dev` | Equality holds on raw BigInt — RF-1.5 |
| Identity string for high-bit inode | Remains signed `toString()` — RF-1.4 / RF-1.6 |
| Distinct paths, same `dev`, inodes `2^63+92` / `2^63+900` | Not the same object (`sameExistingPath` → false) — RF-1.7 |
| Windows native | Inode fallback in `sameExistingPath` still skipped |

## Testing

- New `cli/tests/core/fs-identity.test.ts`: table for `0n` false; positive true; issue exemplar negative true; `asUintN` round-trip; raw `.toString()` ≠ `asUintN(...).toString()` for high-bit.
- Extend `cli/tests/core/discovery-safe-read.test.ts`: parent/leaf with high-bit `ino` and negative `dev` discover successfully; `ino: 0n` on parent still throws `/directory identity/`.
- Extend `cli/tests/core/same-existing-path.test.ts`: mock `statSync` respecting `{ bigint: true }` — same `dev`, inodes `2n**63n+92n` / `2n**63n+900n` on two real distinct dirs → `false`; same dir via symlink → `true`; `ino 0n` on one side → `false`. Mutation: reverting to Number `statSync` must RED this test.
- `isRootManifest` / receipt path: root vs subpackage manifests with mocked high-bit colliding Number inodes → `false`.
- Recommended sites (`record-io`, `native-runtime`, `request-recovery`): one kill-case each with distinct high-bit inodes that collide as Number and equal size/mtime → identity change detected.

## UI Screens

None — no direct interaction / layout surface.

## Follow-up (B3)

Open a dedicated GitHub issue for `awm init` rejecting `codex-cli 0.172.0-alpha.2` (stable `0.172.0` accepted), citing #252 evidence, before or when #252 is closed by this PR.

## Self-review

- No TBD/TODO placeholders.
- Scope matches locked owner decisions including B1 in this PR and B2 (no vacuous `isObservableDev`).
- Each RF is 1:1 testable.
- RF-1.6 no longer forbids Number-predicate migration (that work is RF-1.7).
- No contradiction with identity hashing in `registry-contracts.ts`.
