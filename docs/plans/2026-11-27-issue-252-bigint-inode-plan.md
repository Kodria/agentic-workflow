# BigInt high-bit inode observability (#252) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept Node bigint stats whose uint64 inode/device high bit makes the signed BigInt look negative, so Codex Cloud and similar hosts stop failing with `directory identity is unobservable`, while still rejecting inode zero and leaving digests on raw BigInts (#252).

**Architecture:** Add `cli/src/core/fs-identity.ts` with `isObservableInode` (`BigInt.asUintN(64, ino) !== 0n`) and `isObservableDev` (any bigint is observable). Replace signed inequality checks in `discovery.ts` and migrate BigInt `ino === 0n` / `!== 0n` identity gates to the helper. Do not canonicalize equality or `toString()` digests.

**Tech Stack:** TypeScript CLI (`cli/`), Jest unit tests under `cli/tests/core/`.

**Change Record:** `bigint-inode-observability`

**Criterios de aceptación:**
- En un host donde `fs.lstatSync(path, { bigint: true }).ino` es negativo por bit alto (p. ej. Codex Cloud `/workspace`), `awm registry add … --no-install` y discovery de skills no fallan con `directory identity is unobservable` → el registry se clona / los skills se descubren
- Un inodo `0n` sigue rechazándose → error de identidad no observable / unavailable
- Digests `dev.toString():ino.toString()` para inodos bit-alto siguen usando el BigInt signed crudo (no `asUintN(...).toString()`)

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** #252. Design: `docs/plans/2026-11-27-issue-252-bigint-inode-design.md` (owner-approved). Dispatch: owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "bigint-inode-observability",
  "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6"],
  "sources": [
    {
      "id": "SRC-DISCOVERY",
      "path": "cli/src/core/discovery.ts",
      "locator": "inspectSkillDirectory",
      "fact": "inspectSkillDirectory throws `directory identity is unobservable` when `typeof stat.dev !== 'bigint' || typeof stat.ino !== 'bigint' || stat.dev < 0n || stat.ino <= 0n`. readSkillDescription applies the same signed checks to the leaf (`inspected.dev < 0n || inspected.ino <= 0n`). High-bit uint64 values from Node appear as negative BigInts and are falsely rejected. Equality uses raw `stat.dev`/`stat.ino` comparison — must stay raw."
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
      "locator": "actual.ino === 0n",
      "fact": "isCommittedController rejects custody dirs with `actual.ino === 0n` before comparing expected/actual identity. Migrate to !isObservableInode(actual.ino); leave raw equality."
    },
    {
      "id": "SRC-PLAN-VALIDATE",
      "path": "cli/src/core/plan/validate.ts",
      "locator": "inspected.ino !== 0n",
      "fact": "Leaf identity helper requires `typeof inspected.dev === 'bigint' && typeof inspected.ino === 'bigint' && inspected.ino !== 0n` plus matching opened fstat. Replace `!== 0n` with isObservableInode(inspected.ino)."
    },
    {
      "id": "SRC-DISCOVERY-TEST",
      "path": "cli/tests/core/discovery-safe-read.test.ts",
      "locator": "fails closed when parent %s is unobservable",
      "fact": "Mocks fs with positive bigint directory `{ dev: 7n, ino: 8n }` and leaf `{ dev: 7n, ino: 9007199254740993n }`. Covers undefined ino/dev as unobservable but does not assert high-bit negative ino acceptance, negative-dev acceptance, or ino 0n rejection on parents."
    },
    {
      "id": "SRC-ISSUE-EVIDENCE",
      "path": "docs/plans/2026-11-27-issue-252-bigint-inode-design.md",
      "locator": "## Requirements (EARS)",
      "fact": "Issue #252 exemplar: `stat -c '%i' /workspace` → 9223372036854775900; `fs.lstatSync('/workspace', { bigint: true }).ino` → -9223372036854775716n; `BigInt.asUintN(64, ino)` recovers the unsigned value. Design locks Enfoque 2 helper + call-site migration; Codex alpha out of scope."
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
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["RF-1.4"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "fs-identity helper + discovery and sister gates",
      "requirements": ["RF-1.1", "RF-1.2", "RF-1.3", "RF-1.4", "RF-1.5", "RF-1.6"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-DISCOVERY", "SRC-REGISTRY-CONTRACTS", "SRC-EXEC-WRAPPER", "SRC-PLAN-VALIDATE", "SRC-DISCOVERY-TEST", "SRC-ISSUE-EVIDENCE"],
      "redCommands": ["CMD-FS-IDENTITY", "CMD-DISCOVERY"],
      "greenCommands": ["CMD-FS-IDENTITY", "CMD-DISCOVERY", "CMD-TYPECHECK"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-FS-IDENTITY", "CMD-DISCOVERY", "CMD-TYPECHECK"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

## Requirements

- **RF-1.1** — WHEN AWM observes `dev`/`ino` via `fs.*Stat*(…, { bigint: true })`, THEN THE CLI SHALL decide inode observability only with `BigInt.asUintN(64, ino) !== 0n`.
- **RF-1.2** — WHEN validating device observability, THEN THE CLI SHALL require only that `dev` is a `bigint`; SHALL NOT reject by sign or numeric value.
- **RF-1.3** — IF `BigInt.asUintN(64, ino) === 0n`, THEN THE CLI SHALL fail closed with the existing identity unavailable / unobservable error class.
- **RF-1.4** — THE CLI SHALL expose a shared helper under `cli/src/core/` used by BigInt identity gates that predicate `ino`/`dev`; equality and digests SHALL use raw Node BigInt.
- **RF-1.5** — THE suite SHALL cover high-bit inode accepted, `0n` rejected, signed-negative `dev` non-blocking, and raw equality for matching high-bit stats.
- **RF-1.6** — THE change SHALL NOT accept Codex prereleases, SHALL NOT alter Number-based `ino` predicates, and SHALL NOT change identity-string formatting for high-bit inodes.

## File map

| File | Role |
|------|------|
| `cli/src/core/fs-identity.ts` | `isObservableInode` / `isObservableDev` |
| `cli/src/core/discovery.ts` | Replace signed `dev`/`ino` checks |
| `cli/src/core/admission/registry-contracts.ts` | Use `isObservableInode` |
| `cli/src/commands/job/exec-wrapper.ts` | Use `isObservableInode` |
| `cli/src/core/plan/validate.ts` | Use `isObservableInode` |
| `cli/tests/core/fs-identity.test.ts` | Helper + digest invariant kill-tests |
| `cli/tests/core/discovery-safe-read.test.ts` | High-bit accept + zero reject |

<a id="slice-s1"></a>
### Slice S1: fs-identity helper + discovery and sister gates

#### Surfaces
Owns RF-1.1–RF-1.6 as one observability boundary: the helper without discovery leaves Codex broken; discovery without the helper reintroduces signed inequality; sister `=== 0n` gates without the helper leave a second door for future `<=` regressions. Files in File map. Grouping rationale: one trust door for BigInt identity observability. Out of scope: Codex alpha versionPattern, Number-based paths, unsigned digest canonicalization.

#### Implementation
Dependencies: none. Inputs: approved design RF-1.1–RF-1.6 and SRC-ISSUE-EVIDENCE exemplar. Outputs: GREEN CMD-FS-IDENTITY, CMD-DISCOVERY, CMD-TYPECHECK.

1. **RED — helper tests** — Create `cli/tests/core/fs-identity.test.ts`:

```typescript
import { isObservableDev, isObservableInode } from '../../src/core/fs-identity';

const HIGH_BIT_INO = -9223372036854775716n;
const UNSIGNED_INO = 9223372036854775900n; // BigInt.asUintN(64, HIGH_BIT_INO) per issue #252 math; assert exact equality in test

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

    it('treats any bigint device as observable including signed-negative (RF-1.2)', () => {
        expect(isObservableDev(0n)).toBe(true);
        expect(isObservableDev(7n)).toBe(true);
        expect(isObservableDev(-1n)).toBe(true);
    });

    it('keeps raw toString distinct from unsigned for high-bit inodes (RF-1.4, RF-1.6)', () => {
        expect(HIGH_BIT_INO.toString()).not.toBe(BigInt.asUintN(64, HIGH_BIT_INO).toString());
        expect(HIGH_BIT_INO.toString()).toBe('-9223372036854775716');
    });

    it('raw equality matches for identical high-bit values (RF-1.5)', () => {
        const a = HIGH_BIT_INO;
        const b = -9223372036854775716n;
        expect(a === b).toBe(true);
        expect(isObservableInode(a) && isObservableInode(b)).toBe(true);
    });
});
```

   Before locking `UNSIGNED_INO`, run once in the RED authoring step: `node -e "console.log(BigInt.asUintN(64, -9223372036854775716n).toString())"` and put that exact decimal in the constant (issue text cited 9223372036854775900 for `stat -c`; if asUintN differs, use the asUintN result as the oracle and keep the signed exemplar from the issue for the Node surface).

2. **RED — discovery tests** — Append to `cli/tests/core/discovery-safe-read.test.ts` inside the existing `describe.each`:

```typescript
    it('accepts high-bit parent inode and signed-negative device (RF-1.1, RF-1.2, RF-1.5)', () => {
        const highBitDir = {
            ...directory,
            dev: -1n,
            ino: -9223372036854775716n,
        };
        const highBitLeaf = {
            ...inspected,
            dev: -1n,
            ino: -9223372036854775715n,
        };
        const lstat = (fs.lstatSync as jest.Mock).getMockImplementation()!;
        (fs.lstatSync as jest.Mock).mockImplementation((file, options) => {
            if (file === skillFile) return highBitLeaf;
            if (file.endsWith('awm-registry.json')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
            if (typeof file === 'string' && (file === skillDir || file === path.join(root, 'skills') || file === root || file.startsWith(root))) {
                // parents under root use highBitDir; other ancestors keep ordinary directory
                if (file === skillDir || file === path.join(root, 'skills') || file === root) return highBitDir;
            }
            return lstat(file, options);
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
        expect(fs.readFileSync).not.toHaveBeenCalled();
    });
```

   If the parent-path filter in the high-bit test is brittle against absolute ancestors outside `root`, simplify: make **every** directory lstat return `highBitDir` (only `skillFile` returns the leaf) — that matches how the existing `directory` mock works today and is preferred if the filtered version flakes.

3. **Run RED** — Execute CMD-FS-IDENTITY and CMD-DISCOVERY. Expect: missing module / import failures on fs-identity tests; discovery high-bit case throws `directory identity is unobservable` under current `ino <= 0n` / `dev < 0n`.

4. **GREEN — helper** — Create `cli/src/core/fs-identity.ts`:

```typescript
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

5. **GREEN — discovery.ts** — Import `{ isObservableDev, isObservableInode }` from `./fs-identity`. Replace the directory check:

```typescript
if (typeof stat.dev !== 'bigint' || typeof stat.ino !== 'bigint'
    || !isObservableDev(stat.dev) || !isObservableInode(stat.ino)) {
    throw new Error(`${parent}: directory identity is unobservable`);
}
```

   Replace the leaf check:

```typescript
if (typeof inspected.dev !== 'bigint' || typeof inspected.ino !== 'bigint'
    || typeof inspected.size !== 'bigint'
    || !isObservableDev(inspected.dev)
    || !isObservableInode(inspected.ino)
    || inspected.size < 0n) {
    throw new Error('file identity or size is unobservable');
}
```

   Leave equality and open/fstat identity compares on raw BigInts.

6. **GREEN — sister gates** — Import `isObservableInode` and replace:
   - `registry-contracts.ts`: `stat.ino === 0n` → `!isObservableInode(stat.ino)`; `before.ino === 0n` → `!isObservableInode(before.ino)`. Do **not** change digest `toString()` lines.
   - `exec-wrapper.ts`: `actual.ino === 0n` → `!isObservableInode(actual.ino)`.
   - `plan/validate.ts`: `inspected.ino !== 0n` → `isObservableInode(inspected.ino)`.

7. **Run GREEN** — CMD-FS-IDENTITY, CMD-DISCOVERY, CMD-TYPECHECK all pass.

8. **Commit** — Conventional message: `fix(cli): accept high-bit bigint inodes for FS identity (#252)`.

#### Edge cases
- `ino === 0n` → false / throw unobservable (RF-1.3); kill-test in both suites.
- High-bit negative ino → true / discovery succeeds (RF-1.1).
- Negative `dev` → `isObservableDev` true; discovery succeeds (RF-1.2).
- `typeof !== 'bigint'` (undefined) → still rejected by existing typeof gates (covered by existing discovery tests).
- Digest: high-bit `.toString()` remains signed decimal; never substitute `asUintN` into identity strings (RF-1.4 / RF-1.6).
- Do not edit `cli/src/providers/index.ts` `versionPattern` for Codex alpha (RF-1.6).
- Do not edit Number-based `paths.ts` `ino !== 0` helpers (RF-1.6).

#### Evidence
- SRC-* facts above are authoritative; do not rediscover call sites beyond the File map.
- RED/GREEN: CMD-FS-IDENTITY, CMD-DISCOVERY; closure also CMD-TYPECHECK.
- Independent specification and code-quality reviews required; reconcile files, tests, sensors, and CLI-derived plan identity before completion.
- Traceability: RF-1.1→CMD-FS-IDENTITY+CMD-DISCOVERY; RF-1.2→both; RF-1.3→both; RF-1.4→CMD-FS-IDENTITY (toString invariant) + CMD-TYPECHECK (imports); RF-1.5→both; RF-1.6→CMD-FS-IDENTITY toString pin + review confirms no Codex/Number edits.

#### Fallback
Public-contract / identity-trust risk: expand to full relevant context under Evidence Capsule v1 without dropping gates. If asUintN oracle for the issue exemplar disagrees with the issue's `stat -c` decimal, amend the design+plan with the measured asUintN value, revalidate, and re-admit — never invent a second observability rule. Insufficient fact → durable amendment, never delegated discovery.

## Traceability matrix

| Req | Task(s) | Test(s) |
|-----|---------|---------|
| RF-1.1 | S1 steps 1,4,5 | `isObservableInode(HIGH_BIT_INO)`; discovery high-bit accept |
| RF-1.2 | S1 steps 1,4,5 | `isObservableDev(-1n)`; discovery negative `dev` accept |
| RF-1.3 | S1 steps 1,5 | `isObservableInode(0n)===false`; discovery `ino: 0n` throw |
| RF-1.4 | S1 steps 4–6 | helper module + sister imports; toString ≠ asUintN string |
| RF-1.5 | S1 steps 1–2 | raw equality + discovery high-bit success |
| RF-1.6 | S1 edge + review | toString pin; no Codex/Number file edits |

## Self-review

- Bidirectional coverage: every RF has task + test; no orphan steps.
- No TBD/TODO / "similar to" placeholders; code is inline.
- Types: `isObservableInode(ino: bigint)`, `isObservableDev(dev: bigint)` consistent across steps.
- No UI Skills/Design artifacts (no screens).
- Dispatch: `proveedor-nativo` → `compact-slices/v1` (owner did not opt into awm-routed).
