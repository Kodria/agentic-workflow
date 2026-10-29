# Issue #238 simple-git 4.x bump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin `simple-git@4.0.2` in the CLI so published installs clear Inspector CVEs CVE-2026-102826/102827/102828/102829, adapting only the named-export import break.

**Architecture:** One cohesive dependency slice: a structural regression locks the pin and forbids default imports / env opt-ins; then bump lockfile + rewrite the three call-site imports to `{ simpleGit }`. No registry behavior change and no `allowEnvironment` factory (design decision A / solo bump).

**Tech Stack:** TypeScript CLI (`cli/`), npm, Jest, `simple-git@4.0.2`.

**Change Record:** `issue-238-simple-git-4`

**Criterios de aceptación:**
- Tras publicar la CLI con el bump, una imagen que instale `agentic-workflow-manager` ya no reporta CVE-2026-102826/102827/102828/102829 sobre `simple-git` / `@simple-git/argv-parser` en el escaneo de Inspector/ECR
- `awm update` / sync del registry baseline por HTTPS sigue funcionando en el entorno Cloud Agent (sin `GIT_SSH_COMMAND`)

**Modo de ejecución:** interactivo

**Modo de despacho:** proveedor-nativo

**Origen:** owner approved design `docs/plans/2026-10-29-issue-238-simple-git-4-design.md` (opción A solo bump; env strip documentado, sin factory). Issue #238. Dispatch: owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-238-simple-git-4",
  "requirements": ["SG-1", "SG-2", "SG-3", "SG-4"],
  "sources": [
    {
      "id": "SRC-PKG",
      "path": "cli/package.json",
      "locator": "\"simple-git\":",
      "fact": "At plan authoring time production dependency is exactly \"simple-git\": \"3.36.0\". Lockfile resolves simple-git@3.36.0 and @simple-git/argv-parser@1.1.1 (vulnerable). Target pin is exact \"4.0.2\" (same exact-pin style). Locator stays the key after the bump."
    },
    {
      "id": "SRC-REGISTRIES",
      "path": "cli/src/core/registries.ts",
      "locator": "import simpleGit from 'simple-git'",
      "fact": "Default import. Uses simpleGit().clone, simpleGit(dir).reset(['--hard']), checkout, pull inside syncRegistries. No .env(), no allowEnvironment, no abbreviated long options."
    },
    {
      "id": "SRC-ADD",
      "path": "cli/src/commands/registry/add.ts",
      "locator": "import simpleGit from 'simple-git'",
      "fact": "Default import. Uses await simpleGit().clone(remote, dest) only."
    },
    {
      "id": "SRC-VERSIONING",
      "path": "cli/src/core/versioning.ts",
      "locator": "import simpleGit, { SimpleGit } from 'simple-git'",
      "fact": "Default + named SimpleGit type. Uses simpleGit(repoDir).raw([...]), .tags(). Full options only (--tags, --prune, --exact-match, --short, --verify)."
    },
    {
      "id": "SRC-V4-EXPORT",
      "path": "docs/plans/2026-10-29-issue-238-simple-git-4-design.md",
      "locator": "## Current surface",
      "fact": "simple-git 4.0.2 removes default export; only named simpleGit works. Ambient GIT_* stripped unless allowEnvironment; design forbids adding that opt-in."
    },
    {
      "id": "SRC-SYNC-TEST",
      "path": "cli/tests/core/registries-sync.test.ts",
      "locator": "describe('syncRegistries (git fixtures locales)'",
      "fact": "Real local git clone/reset/checkout/pull via syncRegistries against file fixtures; jest timeout 30000. Exercises the simple-git call path in registries.ts."
    },
    {
      "id": "SRC-ADD-TEST",
      "path": "cli/tests/commands/registry/add.test.ts",
      "locator": "describe('addRegistry'",
      "fact": "Exercises addRegistry clone path against local fixtures."
    },
    {
      "id": "SRC-VER-TEST",
      "path": "cli/tests/core/versioning.test.ts",
      "locator": "describe('versioning core'",
      "fact": "Real git fixtures for resolveTargetRef/currentVersion (raw describe --tags --exact-match, fetch --tags, tags())."
    }
  ],
  "commands": [
    {
      "id": "CMD-STRUCT",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/structural/simple-git-v4-pin.test.ts"],
      "covers": ["SG-1", "SG-2", "SG-3"]
    },
    {
      "id": "CMD-SYNC",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/registries-sync.test.ts"],
      "covers": ["SG-4"]
    },
    {
      "id": "CMD-ADD",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/registry/add.test.ts"],
      "covers": ["SG-4"]
    },
    {
      "id": "CMD-VER",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/versioning.test.ts"],
      "covers": ["SG-4"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["SG-2", "SG-4"]
    },
    {
      "id": "CMD-LINT",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "lint"],
      "covers": ["SG-1", "SG-2", "SG-3", "SG-4"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Pin simple-git 4.0.2 and named imports",
      "requirements": ["SG-1", "SG-2", "SG-3", "SG-4"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-PKG", "SRC-REGISTRIES", "SRC-ADD", "SRC-VERSIONING", "SRC-V4-EXPORT", "SRC-SYNC-TEST", "SRC-ADD-TEST", "SRC-VER-TEST"],
      "redCommands": ["CMD-STRUCT"],
      "greenCommands": ["CMD-STRUCT", "CMD-SYNC", "CMD-ADD", "CMD-VER", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-STRUCT", "CMD-SYNC", "CMD-ADD", "CMD-VER", "CMD-TYPECHECK", "CMD-LINT"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Pin simple-git 4.0.2 and named imports

#### Surfaces

Owns SG-1…SG-4 in one slice: pin + lockfile, three import sites, and a new structural test that fails if the pin regresses, a default import returns, or an `allowEnvironment` / `allowUnsafeSshCommand` opt-in appears at those call sites. Grouping: pin and imports must land together or `typecheck`/runtime break; SG-3 is enforced as “no opt-in code” (Change Record narrative at finishing documents the ambient-strip limitation for operators).

Exact files:

- create `cli/tests/structural/simple-git-v4-pin.test.ts`
- edit `cli/package.json` (`dependencies.simple-git` → `"4.0.2"`)
- refresh `cli/package-lock.json` via `npm install` inside `cli/`
- edit `cli/src/core/registries.ts`, `cli/src/commands/registry/add.ts`, `cli/src/core/versioning.ts` imports only

#### Implementation

1. **RED — add structural test** `cli/tests/structural/simple-git-v4-pin.test.ts` (mirror `native-release-artifacts` / `support-matrix-is-current` style of reading `cli/package.json` from disk):

```ts
import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const SRC_FILES = [
    'src/core/registries.ts',
    'src/commands/registry/add.ts',
    'src/core/versioning.ts',
] as const;

describe('simple-git v4 pin (#238)', () => {
    it('pins simple-git exactly to 4.0.2', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8')) as {
            dependencies: Record<string, string>;
        };
        expect(pkg.dependencies['simple-git']).toBe('4.0.2');
    });

    it('uses named simpleGit import (no default import) at registry call sites', () => {
        for (const rel of SRC_FILES) {
            const text = fs.readFileSync(path.join(CLI_ROOT, rel), 'utf8');
            expect(text).toMatch(/import\s*\{[^}]*\bsimpleGit\b[^}]*\}\s*from\s*['"]simple-git['"]/);
            expect(text).not.toMatch(/import\s+simpleGit\s+from\s*['"]simple-git['"]/);
            expect(text).not.toMatch(/import\s+simpleGit\s*,/);
        }
    });

    it('does not opt into allowEnvironment / allowUnsafeSshCommand at call sites (SG-3)', () => {
        for (const rel of SRC_FILES) {
            const text = fs.readFileSync(path.join(CLI_ROOT, rel), 'utf8');
            expect(text).not.toMatch(/allowEnvironment/);
            expect(text).not.toMatch(/allowUnsafeSshCommand/);
            expect(text).not.toMatch(/allowEnvoronment/);
        }
    });
});
```

2. Run CMD-STRUCT → RED (`dependencies['simple-git']` is still `3.36.0`; default imports still present).

3. **GREEN — dependency:** in `cli/package.json` set `"simple-git": "4.0.2"`. From `cli/`: `npm install` so lockfile resolves `simple-git@4.0.2` and `@simple-git/argv-parser@2.0.1` (or newer patch in the 2.0.x line bundled by 4.0.2).

4. **GREEN — imports:**

```ts
// registries.ts and add.ts
import { simpleGit } from 'simple-git';

// versioning.ts
import { simpleGit, type SimpleGit } from 'simple-git';
```

Leave all `simpleGit(...)` call expressions unchanged.

5. Run CMD-STRUCT, CMD-SYNC, CMD-ADD, CMD-VER, CMD-TYPECHECK, CMD-LINT → GREEN.

6. Commit (conventional, patch-level): `fix(deps): upgrade simple-git to 4.0.2 for CVE remediation`.

Include design + plan docs in the branch (separate commit ok): design already drafted; commit plan with the same branch before execution handoff if not yet committed.

#### Edge cases

- Exact pin `"4.0.2"`, not `^4.0.2` (matches current exact-pin style for this dep).
- `import simpleGit, { SimpleGit }` must become named+type-only; a lingering default import fails CMD-STRUCT and breaks ESM interop under 4.x (`default` is undefined).
- Do not add `allowEnvironment` even if a future corporate `GIT_SSH_COMMAND` report appears — that needs a design amendment, not a silent widen in this slice.
- Do not touch unrelated audit findings (handlebars/jest, undici, deepmerge).

#### Evidence

SRC-PKG, SRC-REGISTRIES, SRC-ADD, SRC-VERSIONING, SRC-V4-EXPORT, SRC-SYNC-TEST, SRC-ADD-TEST, SRC-VER-TEST. RED: CMD-STRUCT. GREEN: all greenCommands. Independent specification and code-quality reviews after the slice. Finishing writes Change Record `issue-238-simple-git-4` noting ambient `GIT_*` strip (SG-3 operator note) and links #238.

#### Fallback

If `npm install` pulls a transitive argv-parser newer than 2.0.1 but still satisfies ≥2.0.1, keep the parent pin at `4.0.2` and do not broaden the parent range. If typecheck fails on `SimpleGit` type export shape, amend to `import { simpleGit }` plus `import type { SimpleGit } from 'simple-git'` (or infer without the type import) and revalidate the plan. Full-context retains gates; do not migrate to `execGit` inside this plan.

## Traceability

| Req | Slice | Tests |
|-----|-------|-------|
| SG-1 | S1 | `simple-git-v4-pin.test.ts` exact pin `4.0.2` |
| SG-2 | S1 | same file: named import regex; typecheck |
| SG-3 | S1 | same file: no allowEnvironment/allowUnsafe*; Change Record narrative at finish |
| SG-4 | S1 | registries-sync, registry/add, versioning Jest suites |

## Execution handoff

After `awm plan validate` → `valid` and `awm plan admit`, use `subagent-driven-development` (interactive check-ins).
