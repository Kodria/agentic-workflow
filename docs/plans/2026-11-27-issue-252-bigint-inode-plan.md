# BigInt high-bit inode observability (#252) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept Node bigint stats whose uint64 inode/device high bit makes the signed BigInt look negative, and stop comparing POSIX `ino`/`dev` as JS `Number` (precision loss near 2^63), so Codex Cloud and similar hosts stop failing with `directory identity is unobservable` and stop false path/identity matches, while still rejecting inode zero and leaving digests on raw BigInts (#252).

**Architecture:** Add `cli/src/core/fs-identity.ts` with `isObservableInode` (`BigInt.asUintN(64, ino) !== 0n`) only — no `isObservableDev`. Replace signed inequality checks in `discovery.ts`, migrate BigInt `ino === 0n` / `!== 0n` gates, and migrate Number-based FS identity compares (`sameExistingPath` obligatory; `record-io`, `native-runtime`, `request-recovery` recommended same PR). Do not canonicalize equality or `toString()` digests.

**Tech Stack:** TypeScript CLI (`cli/`), Jest unit tests under `cli/tests/`.

**Change Record:** `bigint-inode-observability`

**Criterios de aceptación:**
- En un host donde `fs.lstatSync(path, { bigint: true }).ino` es negativo por bit alto (p. ej. Codex Cloud `/workspace`), `awm registry add … --no-install` y discovery de skills no fallan con `directory identity is unobservable` → el registry se clona / los skills se descubren
- Un inodo `0n` sigue rechazándose → error de identidad no observable / unavailable
- Digests `dev.toString():ino.toString()` para inodos bit-alto siguen usando el BigInt signed crudo (no `asUintN(...).toString()`)
- Dos paths distintos con el mismo `dev` e inodos `2^63+92` / `2^63+900` → `sameExistingPath` / `isRootManifest` reportan distinto (antes colisionaban como `Number`)

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** #252. Design: `docs/plans/2026-11-27-issue-252-bigint-inode-design.md` (owner-approved; amended 2026-11-27 for audit B1/B2). Dispatch: owner did not select AWM routing → `compact-slices/v1`.

**Amendment (2026-11-27, PR #253 audit):** Include RF-1.7 Number→BigInt identity compares; drop `isObservableDev`; B3 Codex alpha remains a follow-up issue.

**Amendment (2026-11-27, post-S1):** Refresh `SRC-EXEC-WRAPPER` / `SRC-PLAN-VALIDATE` locators to post-migration `isObservableInode(...)` strings so `awm plan validate` remains valid against the implemented sources.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "bigint-inode-observability",
  "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7"],
  "sources": [
    {
      "id": "SRC-DISCOVERY",
      "path": "cli/src/core/discovery.ts",
      "locator": "inspectSkillDirectory",
      "fact": "inspectSkillDirectory throws `directory identity is unobservable` when `typeof stat.dev !== 'bigint' || typeof stat.ino !== 'bigint' || stat.dev < 0n || stat.ino <= 0n`. readSkillDescription applies the same signed checks to the leaf (`inspected.dev < 0n || inspected.ino <= 0n`). High-bit uint64 values from Node appear as negative BigInts and are falsely rejected. Equality uses raw `stat.dev`/`stat.ino` comparison — must stay raw. After fix: typeof bigint for both + isObservableInode(ino); no isObservableDev."
    },
    {
      "id": "SRC-REGISTRY-CONTRACTS",
      "path": "cli/src/core/admission/registry-contracts.ts",
      "locator": "filesystemIdentity",
      "fact": "filesystemIdentity and contractFileIdentity reject with `ino === 0n` then build digests via `` `${dev.toString()}:${ino.toString()}` ``. `=== 0n` already accepts high-bit negatives; migration to isObservableInode is behavior-preserving. Digest formatting must keep raw toString (RF-1.4 / RF-1.6)."
    },
    {
      "id": "SRC-EXEC-WRAPPER",
      "path": "cli/src/commands/job/exec-wrapper.ts",
      "locator": "!isObservableInode(actual.ino)",
      "fact": "isCommittedController rejects custody dirs with !isObservableInode(actual.ino) before comparing expected/actual identity on raw BigInt equality (migrated from actual.ino === 0n)."
    },
    {
      "id": "SRC-PLAN-VALIDATE",
      "path": "cli/src/core/plan/validate.ts",
      "locator": "isObservableInode(inspected.ino)",
      "fact": "Leaf identity helper requires typeof inspected.dev/ino === 'bigint' && isObservableInode(inspected.ino) plus matching opened fstat (migrated from inspected.ino !== 0n)."
    },
    {
      "id": "SRC-SAME-PATH",
      "path": "cli/src/core/paths.ts",
      "locator": "export function sameExistingPath",
      "fact": "sameExistingPath uses fs.statSync(a/b) without bigint, then on POSIX `sa.ino !== 0 && sb.ino !== 0 && sa.dev === sb.dev && sa.ino === sb.ino` as Number. Near 2^63 Number spacing is 2048 so distinct high-bit inodes collide (false same path). Callers: changes/receipt isRootManifest, environments/store isPathInsideRoot, tracks/context, tracks/teardown, tracks/git. Fix: statSync(…, { bigint: true }); isObservableInode(sa.ino) && isObservableInode(sb.ino) && sa.dev === sb.dev && sa.ino === sb.ino; keep !isWindowsNative() gate."
    },
    {
      "id": "SRC-RECORD-IO",
      "path": "cli/src/core/changes/record-io.ts",
      "locator": "export function unchangedSince",
      "fact": "FileSnapshot.ino is number; readRecord uses lstatSync without bigint; unchangedSince returns `stat.ino === 0 || snapshot.ino === 0 || stat.ino === snapshot.ino`. On high-bit hosts Number inodes lose precision. Migrate snapshot+re-stat to { bigint: true }, type ino: bigint, use !isObservableInode for Windows-zero tolerance."
    },
    {
      "id": "SRC-NATIVE-RUNTIME",
      "path": "cli/src/core/model-policy/native-runtime.ts",
      "locator": "function hashFile",
      "fact": "hashFile stats before/after createReadStream with Number statSync and compares before.ino !== after.ino. Migrate both stats to { bigint: true }; compare BigInt dev/ino/size; keep mtimeMs or use mtimeNs."
    },
    {
      "id": "SRC-REQUEST-RECOVERY",
      "path": "cli/src/commands/watch/request-recovery.ts",
      "locator": "function requestEnvelope",
      "fact": "requestEnvelope lstatSync then fstatSync without bigint; rejects when opened.ino !== before.ino (Number). Migrate both to { bigint: true }; compare size against BigInt(MAX_REQUEST_BYTES)."
    },
    {
      "id": "SRC-DISCOVERY-TEST",
      "path": "cli/tests/core/discovery-safe-read.test.ts",
      "locator": "fails closed when parent %s is unobservable",
      "fact": "Mocks fs with positive bigint directory `{ dev: 7n, ino: 8n }` and leaf `{ dev: 7n, ino: 9007199254740993n }`. Covers undefined ino/dev as unobservable but does not assert high-bit negative ino acceptance, negative-dev acceptance, or ino 0n rejection on parents."
    },
    {
      "id": "SRC-SAME-PATH-TEST",
      "path": "cli/tests/core/same-existing-path.test.ts",
      "locator": "directorios distintos NO son la misma ruta",
      "fact": "Existing tests cover symlink identity, distinct dirs, Windows colliding Number metadata skip, hard links, missing paths. Missing: high-bit inodes 2^63+92 vs 2^63+900 that collide as Number must yield false under bigint; ino 0n → false; kill-RED if Number path restored."
    },
    {
      "id": "SRC-ISSUE-EVIDENCE",
      "path": "docs/plans/2026-11-27-issue-252-bigint-inode-design.md",
      "locator": "## Requirements (EARS)",
      "fact": "Issue #252 exemplar: `stat -c '%i' /workspace` → 9223372036854775900; `fs.lstatSync('/workspace', { bigint: true }).ino` → -9223372036854775716n; `BigInt.asUintN(64, ino)` recovers the unsigned value. Audit B1: Number(2^63+92)===Number(2^63+900). Design locks helper + RF-1.7; no isObservableDev; Codex alpha out as B3 follow-up issue."
    }
  ],
  "commands": [
    {
      "id": "CMD-FS-IDENTITY",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/fs-identity.test.ts"],
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6"]
    },
    {
      "id": "CMD-DISCOVERY",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/discovery-safe-read.test.ts"],
      "covers": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.5"]
    },
    {
      "id": "CMD-SAME-PATH",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/same-existing-path.test.ts", "tests/core/changes/receipt.test.ts"],
      "covers": ["RF-1.7"]
    },
    {
      "id": "CMD-NUMBER-IDENTITY",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/changes/record-io.test.ts", "tests/core/model-policy/native-runtime.test.ts", "tests/commands/watch/request-recovery.test.ts"],
      "covers": ["RF-1.7"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-1.4", "RF-1.7"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "fs-identity helper + discovery, sisters, and Number→BigInt identity",
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6", "RF-1.7"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DISCOVERY", "SRC-REGISTRY-CONTRACTS", "SRC-EXEC-WRAPPER", "SRC-PLAN-VALIDATE", "SRC-SAME-PATH", "SRC-RECORD-IO", "SRC-NATIVE-RUNTIME", "SRC-REQUEST-RECOVERY", "SRC-DISCOVERY-TEST", "SRC-SAME-PATH-TEST", "SRC-ISSUE-EVIDENCE"],
      "redCommands": ["CMD-FS-IDENTITY", "CMD-DISCOVERY", "CMD-SAME-PATH", "CMD-NUMBER-IDENTITY"],
      "greenCommands": ["CMD-FS-IDENTITY", "CMD-DISCOVERY", "CMD-SAME-PATH", "CMD-NUMBER-IDENTITY", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-FS-IDENTITY", "CMD-DISCOVERY", "CMD-SAME-PATH", "CMD-NUMBER-IDENTITY", "CMD-TYPECHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

## Requirements

- **RF-1.1** — WHEN AWM observes `dev`/`ino` via `fs.*Stat*(…, { bigint: true })`, THEN THE CLI SHALL decide inode observability only with `BigInt.asUintN(64, ino) !== 0n`.
- **RF-1.2** — WHEN validating device observability, THEN THE CLI SHALL require only that `dev` is a `bigint`; SHALL NOT reject by sign or numeric value.
- **RF-1.3** — IF `BigInt.asUintN(64, ino) === 0n`, THEN THE CLI SHALL fail closed with the existing identity unavailable / unobservable error class.
- **RF-1.4** — THE CLI SHALL expose `isObservableInode` under `cli/src/core/fs-identity.ts` used by BigInt identity gates that predicate `ino`; equality and digests SHALL use raw Node BigInt.
- **RF-1.5** — THE suite SHALL cover high-bit inode accepted, `0n` rejected, signed-negative `dev` non-blocking, and raw equality for matching high-bit stats.
- **RF-1.6** — THE change SHALL NOT accept Codex prereleases and SHALL NOT change identity-string formatting for high-bit inodes.
- **RF-1.7** — WHEN AWM compares filesystem identity (`dev`/`ino`) to decide that two paths or two observations are the same object, THEN THE CLI SHALL obtain both via `{ bigint: true }` stats and compare BigInt values; SHALL NOT compare `ino`/`dev` as JS `Number`.

## File map

| File | Role |
|------|------|
| `cli/src/core/fs-identity.ts` | `isObservableInode` only |
| `cli/src/core/discovery.ts` | Replace signed `dev`/`ino` checks |
| `cli/src/core/admission/registry-contracts.ts` | Use `isObservableInode` |
| `cli/src/commands/job/exec-wrapper.ts` | Use `isObservableInode` |
| `cli/src/core/plan/validate.ts` | Use `isObservableInode` |
| `cli/src/core/paths.ts` | `sameExistingPath` → bigint stats (RF-1.7 obligatory) |
| `cli/src/core/changes/record-io.ts` | `FileSnapshot.ino: bigint` + unchangedSince |
| `cli/src/core/model-policy/native-runtime.ts` | hashFile bigint identity |
| `cli/src/commands/watch/request-recovery.ts` | requestEnvelope bigint identity |
| `cli/tests/core/fs-identity.test.ts` | Helper + digest invariant |
| `cli/tests/core/discovery-safe-read.test.ts` | High-bit accept + zero reject |
| `cli/tests/core/same-existing-path.test.ts` | High-bit Number-collision kill |
| `cli/tests/core/changes/receipt.test.ts` | isRootManifest high-bit false |
| `cli/tests/core/changes/record-io.test.ts` | unchangedSince high-bit |
| `cli/tests/core/model-policy/native-runtime.test.ts` | hashFile identity change |
| `cli/tests/commands/watch/request-recovery.test.ts` | request identity change |

<a id="slice-s1"></a>
### Slice S1: fs-identity helper + discovery, sisters, and Number→BigInt identity

#### Surfaces
Owns RF-1.1–RF-1.7 as one observability + identity-precision boundary. Files in File map. Grouping rationale: helper without discovery leaves Codex broken; discovery without RF-1.7 leaves false same-path / false root-manifest on the same host; sister Number sites without bigint leave residual identity lies. Out of scope: Codex alpha versionPattern (B3 follow-up issue), unsigned digest canonicalization, required change to test-results-artifact Number(ino).

#### Implementation
Dependencies: none. Inputs: amended design RF-1.1–RF-1.7. Outputs: GREEN CMD-FS-IDENTITY, CMD-DISCOVERY, CMD-SAME-PATH, CMD-NUMBER-IDENTITY, CMD-TYPECHECK.

1. **RED — helper tests** — Create `cli/tests/core/fs-identity.test.ts`:

```typescript
import { isObservableInode } from '../../src/core/fs-identity';

const HIGH_BIT_INO = -9223372036854775716n;
const UNSIGNED_INO = 9223372036854775900n; // equals BigInt.asUintN(64, HIGH_BIT_INO)

describe('fs-identity', () => {
    it('rejects zero inode (RF-1.1, RF-1.3)', () => {
        expect(isObservableInode(0n)).toBe(false);
    });

    it('accepts ordinary positive inodes (RF-1.1)', () => {
        expect(isObservableInode(1n)).toBe(true);
        expect(isObservableInode(8n)).toBe(true);
    });

    it('accepts high-bit inodes that Node surfaces as negative BigInt (RF-1.1, RF-1.5)', () => {
        expect(BigInt.asUintN(64, HIGH_BIT_INO)).toBe(UNSIGNED_INO);
        expect(isObservableInode(HIGH_BIT_INO)).toBe(true);
    });

    it('keeps raw toString distinct from unsigned for high-bit inodes (RF-1.4, RF-1.6)', () => {
        expect(HIGH_BIT_INO.toString()).not.toBe(BigInt.asUintN(64, HIGH_BIT_INO).toString());
        expect(HIGH_BIT_INO.toString()).toBe('-9223372036854775716');
    });

    it('raw equality matches for identical high-bit values (RF-1.5)', () => {
        expect(HIGH_BIT_INO === -9223372036854775716n).toBe(true);
        expect(isObservableInode(HIGH_BIT_INO)).toBe(true);
    });
});
```

2. **RED — discovery tests** — Append to `cli/tests/core/discovery-safe-read.test.ts` inside the existing `describe.each`. Prefer making every directory lstat return the high-bit directory mock (only `skillFile` returns the leaf), matching the existing `directory` mock pattern:

```typescript
    it('accepts high-bit parent inode and signed-negative device (RF-1.1, RF-1.2, RF-1.5)', () => {
        const highBitDir = { ...directory, dev: -1n, ino: -9223372036854775716n };
        const highBitLeaf = { ...inspected, dev: -1n, ino: -9223372036854775715n };
        (fs.lstatSync as jest.Mock).mockImplementation((file) => {
            if (file === skillFile) return highBitLeaf;
            if (typeof file === 'string' && file.endsWith('awm-registry.json')) {
                throw Object.assign(new Error('missing'), { code: 'ENOENT' });
            }
            return highBitDir;
        });
        (fs.fstatSync as jest.Mock).mockReturnValue(highBitLeaf);

        expect(discoverSkills([root])).toEqual([{ name: 'safe', path: skillDir, description: 'Ordinary skill' }]);
        expect(fs.readFileSync).toHaveBeenCalledWith(descriptor, 'utf-8');
    });

    it('rejects zero parent inode (RF-1.3)', () => {
        const lstat = (fs.lstatSync as jest.Mock).getMockImplementation()!;
        (fs.lstatSync as jest.Mock).mockImplementation((file, options) => file === skillDir
            ? { ...directory, ino: 0n }
            : lstat(file, options));

        expect(() => discoverSkills([root])).toThrow(/directory identity/i);
        expect(fs.openSync).not.toHaveBeenCalled();
    });
```

3. **RED — sameExistingPath + isRootManifest (RF-1.7)** — Extend `cli/tests/core/same-existing-path.test.ts`:

```typescript
    itPosix('distinguishes high-bit inodes that collide as Number (RF-1.7)', () => {
        const a = path.join(root, 'hb-a');
        const b = path.join(root, 'hb-b');
        fs.mkdirSync(a); fs.mkdirSync(b);
        const inoA = (1n << 63n) + 92n;
        const inoB = (1n << 63n) + 900n;
        expect(Number(inoA) === Number(inoB)).toBe(true); // documents the host lie

        const stat = jest.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike, opts?: { bigint?: boolean }) => {
            const ino = String(p).includes('hb-a') ? inoA : inoB;
            if (opts && opts.bigint === true) {
                return { dev: 1n, ino, isFile: () => false, isDirectory: () => true } as unknown as fs.BigIntStats;
            }
            return { dev: 1, ino: Number(ino), isFile: () => false, isDirectory: () => true } as unknown as fs.Stats;
        }) as unknown as typeof fs.statSync);

        try {
            expect(sameExistingPath(a, b)).toBe(false);
        } finally {
            stat.mockRestore();
        }
    });

    itPosix('does not claim identity when either inode is unobservable zero (RF-1.7)', () => {
        const a = path.join(root, 'z-a');
        const b = path.join(root, 'z-b');
        fs.mkdirSync(a); fs.mkdirSync(b);
        const stat = jest.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike, opts?: { bigint?: boolean }) => {
            const ino = String(p).includes('z-a') ? 0n : 8n;
            if (opts && opts.bigint === true) {
                return { dev: 1n, ino, isFile: () => false, isDirectory: () => true } as unknown as fs.BigIntStats;
            }
            return { dev: 1, ino: Number(ino), isFile: () => false, isDirectory: () => true } as unknown as fs.Stats;
        }) as unknown as typeof fs.statSync);
        try {
            expect(sameExistingPath(a, b)).toBe(false);
        } finally {
            stat.mockRestore();
        }
    });
```

   In `cli/tests/core/changes/receipt.test.ts` (or the nearest existing harness that imports `isRootManifest`), add a case: two real distinct directories (repo root vs subpackage) with mocked `statSync` returning same `dev` and inodes `(1n<<63n)+300n` / `(1n<<63n)+900n`; assert `isRootManifest(root, subManifest) === false`. If no clean import surface exists, export-test via the public `isRootManifest` already exported from `receipt.ts`.

4. **RED — Number-identity sisters (RF-1.7 recommended)** — One kill-case each in existing suites:
   - `record-io.test.ts`: snapshot and later stat with equal size/mtimeMs but distinct high-bit inodes that collide as Number → `unchangedSince` → `false`.
   - `native-runtime.test.ts`: before/after hash stats with colliding Number inodes but distinct BigInt → reject `runtime executable changed while hashing` (or equivalent).
   - `request-recovery.test.ts`: lstat/fstat mismatch on high-bit inodes → `request de recovery cambio de identidad`.

5. **Run RED** — CMD-FS-IDENTITY, CMD-DISCOVERY, CMD-SAME-PATH, CMD-NUMBER-IDENTITY. Expect missing module and failing high-bit/Number-collision assertions under current code.

6. **GREEN — helper** — Create `cli/src/core/fs-identity.ts` with only:

```typescript
/** Node bigint stats encode uint64 inodes as signed; observable iff unsigned 64-bit ≠ 0. */
export function isObservableInode(ino: bigint): boolean {
    return BigInt.asUintN(64, ino) !== 0n;
}
```

7. **GREEN — discovery.ts** — Import `isObservableInode` from `./fs-identity`. Directory check:

```typescript
if (typeof stat.dev !== 'bigint' || typeof stat.ino !== 'bigint' || !isObservableInode(stat.ino)) {
    throw new Error(`${parent}: directory identity is unobservable`);
}
```

   Leaf check: same pattern for `inspected` (keep `inspected.size < 0n`). No `isObservableDev`.

8. **GREEN — sister BigInt gates** — Import `isObservableInode`:
   - `registry-contracts.ts`: `=== 0n` → `!isObservableInode(...)`; keep digest `toString()`.
   - `exec-wrapper.ts`: `actual.ino === 0n` → `!isObservableInode(actual.ino)`.
   - `plan/validate.ts`: `!== 0n` → `isObservableInode(inspected.ino)`.

9. **GREEN — sameExistingPath (RF-1.7)** — In `cli/src/core/paths.ts`:

```typescript
import { isObservableInode } from './fs-identity';

export function sameExistingPath(a: string, b: string): boolean {
  let sa: fs.BigIntStats;
  let sb: fs.BigIntStats;
  try {
    sa = fs.statSync(a, { bigint: true });
    sb = fs.statSync(b, { bigint: true });
  } catch {
    return false;
  }
  // … canonical realpath block unchanged …
  if (ca === null || cb === null) return false;
  if (ca === cb) return true;
  return !isWindowsNative()
    && isObservableInode(sa.ino)
    && isObservableInode(sb.ino)
    && sa.dev === sb.dev
    && sa.ino === sb.ino;
}
```

10. **GREEN — recommended Number sites** —
    - `record-io.ts`: `FileSnapshot.ino: bigint`; `lstatSync(…, { bigint: true })`; `unchangedSince` uses `!isObservableInode(stat.ino) || !isObservableInode(snapshot.ino) || stat.ino === snapshot.ino` for the Windows-zero tolerance branch (preserve: if either side unobservable, do not claim mismatch — match today's `=== 0` short-circuit semantics: treat as unchanged on that axis). Exact today: `return stat.ino === 0 || snapshot.ino === 0 || stat.ino === snapshot.ino` after size/mtime match. After: `return !isObservableInode(stat.ino) || !isObservableInode(snapshot.ino) || stat.ino === snapshot.ino`.
    - `native-runtime.ts`: both `statSync(file, { bigint: true })`; compare `dev`/`ino`/`size` as BigInt; keep `mtimeMs` (Number) compare as today unless tests require `mtimeNs`.
    - `request-recovery.ts`: `lstatSync`/`fstatSync` with `{ bigint: true }`; `before.size > BigInt(MAX_REQUEST_BYTES)` (and `< 1n`); identity compare on BigInt fields.

11. **Run GREEN** — All CMD-* pass. Also run broader `npm --prefix cli test -- --runInBand tests/core tests/commands/watch` before claiming slice done (five `sameExistingPath` callers).

12. **Commit** — `fix(cli): accept high-bit bigint inodes for FS identity (#252)`.

13. **B3 (process, not code)** — Ensure a dedicated GitHub issue exists for Codex alpha rejection before closing #252; link it from the Change Record / PR body.

#### Edge cases
- `ino === 0n` → false / throw unobservable (RF-1.3).
- High-bit negative ino → true / discovery succeeds (RF-1.1).
- Negative `dev` → allowed by typeof bigint only (RF-1.2); no vacuous helper.
- Distinct paths, inodes `2^63+92` / `2^63+900` → `sameExistingPath` false (RF-1.7).
- Digest: high-bit `.toString()` remains signed (RF-1.4 / RF-1.6).
- Windows: inode fallback still skipped via `isWindowsNative()`.
- Do not edit Codex `versionPattern` in this slice (RF-1.6 / B3).
- test-results-artifact Number(ino) may stay (fail-closed).

#### Evidence
- SRC-* facts above are authoritative.
- RED/GREEN: CMD-FS-IDENTITY, CMD-DISCOVERY, CMD-SAME-PATH, CMD-NUMBER-IDENTITY; closure also CMD-TYPECHECK.
- Independent specification and code-quality reviews required.
- Mutation: restoring Number `statSync` in `sameExistingPath` must RED CMD-SAME-PATH.
- Traceability: RF-1.1–1.6 as before; RF-1.7 → CMD-SAME-PATH + CMD-NUMBER-IDENTITY.

#### Fallback
Public-contract / identity-trust risk: expand to full relevant context under Evidence Capsule v1 without dropping gates. If a recommended sister site cannot be migrated without a larger type cascade, amend the design to keep it recommended-with-issue rather than silently skip — never leave RF-1.7 claimed without green CMD-SAME-PATH (obligatory path). Insufficient fact → durable amendment, never delegated discovery.

## Traceability matrix

| Req | Task(s) | Test(s) |
|-----|---------|---------|
| RF-1.1 | S1 steps 1,6,7 | `isObservableInode(HIGH_BIT_INO)`; discovery high-bit accept |
| RF-1.2 | S1 steps 2,7 | discovery negative `dev` accept; typeof-only (no isObservableDev) |
| RF-1.3 | S1 steps 1,7 | `isObservableInode(0n)===false`; discovery `ino: 0n` throw |
| RF-1.4 | S1 steps 6–8 | helper module + sister imports; toString ≠ asUintN string |
| RF-1.5 | S1 steps 1–2 | raw equality + discovery high-bit success |
| RF-1.6 | S1 edge + review | toString pin; no Codex versionPattern edit |
| RF-1.7 | S1 steps 3–4,9–10 | same-existing-path + receipt + record-io/native-runtime/request-recovery |

## Self-review

- Bidirectional coverage: every RF has task + test; no orphan steps.
- No TBD/TODO placeholders; code is inline.
- Types: `isObservableInode(ino: bigint)` only; no `isObservableDev`.
- No UI Skills/Design artifacts.
- Dispatch: `proveedor-nativo` → `compact-slices/v1`.
- Amendment incorporates PR #253 audit B1/B2; B3 tracked as follow-up issue.
