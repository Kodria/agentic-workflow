# Issue #238 simple-git 4.x bump Implementation Plan
<!-- awm-qa-complete: 2026-10-29 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin `simple-git@4.0.2` and route all registry git through one non-interactive factory so Inspector CVEs clear and awm never hangs on credential prompts or silently ignores ambient `GIT_*` / sync failures.

**Architecture:** Two serial slices. S1 introduces `cli/src/core/registry-git.ts` (pin + named import + guarded env + timeout) and rewires the three call sites. S2 adds ignored-env notice (SG-5), classified errors (SG-6), and honest `add`/`list` cache messaging plus non-zero exits on sync failure for `init`/`update`/`sync`/`registry add` (SG-7).

**Tech Stack:** TypeScript CLI (`cli/`), npm, Jest, `simple-git@4.0.2`.

**Change Record:** `issue-238-simple-git-4`

**Criterios de aceptación:**
- Tras publicar la CLI, una imagen que instale `agentic-workflow-manager` ya no reporta CVE-2026-102826/102827/102828/102829 sobre `simple-git` / `@simple-git/argv-parser`
- Con `GIT_SSL_CAINFO` (u otra `GIT_*` guarded) en el entorno, el primer sync de red imprime un aviso con el **nombre** de la variable y el remedio en git config — no el valor
- Un remote inexistente/privado falla rápido (`terminal prompts disabled` / clase SG-6), sin colgar detrás del spinner
- Si `awm add` o `awm list` continúan con caché tras error de sync, muestran versión en caché + causa/remedio; `update`/`sync`/`init`/`registry add` salen ≠ 0

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

**Origen:** design amended after #239 audit (P1–P4 → adopt P3). `docs/plans/2026-10-29-issue-238-simple-git-4-design.md`. Issue #238. Dispatch: owner did not select AWM routing → `compact-slices/v1`.

<!-- AWM:COMPACT-SLICES:START v1 -->
{
  "schema": "compact-slices/v1",
  "planId": "issue-238-simple-git-4",
  "requirements": ["SG-1", "SG-2", "SG-3", "SG-4", "SG-5", "SG-6", "SG-7"],
  "sources": [
    {
      "id": "SRC-PKG",
      "path": "cli/package.json",
      "locator": "\"simple-git\":",
      "fact": "At amendment time production pin is still \"3.36.0\" until S1. Target exact \"4.0.2\". Locator is the dependency key so it survives the bump."
    },
    {
      "id": "SRC-REGISTRIES",
      "path": "cli/src/core/registries.ts",
      "locator": "export async function syncRegistries",
      "fact": "syncRegistries calls simpleGit().clone / simpleGit(dir).reset(['--hard']) / checkout / pull. Today imports default simpleGit from 'simple-git'. Per-registry errors become action:'error' results (non-throwing)."
    },
    {
      "id": "SRC-ADD",
      "path": "cli/src/commands/registry/add.ts",
      "locator": "export async function addRegistry",
      "fact": "addRegistry awaits simpleGit().clone(remote, dest); on failure returns { ok:false, error }. Default import of simple-git."
    },
    {
      "id": "SRC-VERSIONING",
      "path": "cli/src/core/versioning.ts",
      "locator": "export async function resolveTargetRef",
      "fact": "resolveTargetRef/currentVersion use simpleGit(repoDir).raw and .tags. Import is default + SimpleGit type."
    },
    {
      "id": "SRC-ADD-CMD",
      "path": "cli/src/index.ts",
      "locator": "s.start('Syncing registries...');",
      "fact": "awm add (~L136) and awm list (~L503) both syncRegistries(), warn on action==='error', then assertSyncedRegistriesUsable — so a failed sync with still-usable disk continues after a yellow warn only (SG-7 gap). Audit labeled add as install."
    },
    {
      "id": "SRC-SYNC-CMD",
      "path": "cli/src/commands/sync.ts",
      "locator": "const syncResults = await d.syncRegistries();",
      "fact": "awm sync warns on per-registry errors then assertSyncedRegistriesUsable; exit 1 only when content is unusable — soft sync errors can still exit 0 today."
    },
    {
      "id": "SRC-UPDATE-CMD",
      "path": "cli/src/commands/update.ts",
      "locator": "const registryResults = await d.syncRegistries();",
      "fact": "awm update same pattern: warn on error results; later gates may still succeed if disk usable."
    },
    {
      "id": "SRC-DESIGN",
      "path": "docs/plans/2026-10-29-issue-238-simple-git-4-design.md",
      "locator": "## Architecture",
      "fact": "Factory must copy process.env without /^git_/i keys then set GIT_TERMINAL_PROMPT=0; allowEnvironment exactly ['GIT_TERMINAL_PROMPT']; timeout block 60000; never spread process.env into .env(); never .env(key,value) alone."
    },
    {
      "id": "SRC-SYNC-TEST",
      "path": "cli/tests/core/registries-sync.test.ts",
      "locator": "describe('syncRegistries (git fixtures locales)'",
      "fact": "Real local git fixtures for syncRegistries; timeout 30000."
    },
    {
      "id": "SRC-ADD-TEST",
      "path": "cli/tests/commands/registry/add.test.ts",
      "locator": "describe('addRegistry'",
      "fact": "Exercises addRegistry clone against local fixtures."
    },
    {
      "id": "SRC-VER-TEST",
      "path": "cli/tests/core/versioning.test.ts",
      "locator": "describe('versioning core'",
      "fact": "Real git fixtures for resolveTargetRef/currentVersion."
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
      "id": "CMD-FACTORY",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/registry-git.test.ts"],
      "covers": ["SG-3", "SG-5", "SG-6"]
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
      "covers": ["SG-4", "SG-6"]
    },
    {
      "id": "CMD-VER",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/core/versioning.test.ts"],
      "covers": ["SG-4"]
    },
    {
      "id": "CMD-SOFT",
      "program": "npm",
      "args": ["--prefix", "cli", "test", "--", "--runInBand", "--silent", "tests/commands/registry-sync-honesty.test.ts"],
      "covers": ["SG-7"]
    },
    {
      "id": "CMD-TYPECHECK",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "typecheck"],
      "covers": ["SG-2", "SG-3", "SG-4"]
    },
    {
      "id": "CMD-LINT",
      "program": "npm",
      "args": ["--prefix", "cli", "run", "lint"],
      "covers": ["SG-1", "SG-2", "SG-3", "SG-4", "SG-5", "SG-6", "SG-7"]
    }
  ],
  "slices": [
    {
      "id": "S1",
      "title": "Factory + pin simple-git 4.0.2",
      "requirements": ["SG-1", "SG-2", "SG-3", "SG-4"],
      "dependsOn": [],
      "sectionAnchor": "slice-s1",
      "sources": ["SRC-PKG", "SRC-REGISTRIES", "SRC-ADD", "SRC-VERSIONING", "SRC-DESIGN", "SRC-SYNC-TEST", "SRC-ADD-TEST", "SRC-VER-TEST"],
      "redCommands": ["CMD-STRUCT"],
      "greenCommands": ["CMD-STRUCT", "CMD-FACTORY", "CMD-SYNC", "CMD-ADD", "CMD-VER", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    },
    {
      "id": "S2",
      "title": "Honest ignored-env notice and sync failure UX",
      "requirements": ["SG-5", "SG-6", "SG-7"],
      "dependsOn": ["S1"],
      "sectionAnchor": "slice-s2",
      "sources": ["SRC-ADD-CMD", "SRC-SYNC-CMD", "SRC-UPDATE-CMD", "SRC-DESIGN", "SRC-REGISTRIES", "SRC-ADD"],
      "redCommands": ["CMD-FACTORY", "CMD-SOFT"],
      "greenCommands": ["CMD-FACTORY", "CMD-SOFT", "CMD-ADD", "CMD-TYPECHECK", "CMD-LINT"],
      "reviewEvidence": ["specification", "code-quality"],
      "risk": "full-context",
      "fallback": ["public-contract"]
    }
  ],
  "closureCommands": ["CMD-STRUCT", "CMD-FACTORY", "CMD-SYNC", "CMD-ADD", "CMD-VER", "CMD-SOFT", "CMD-TYPECHECK", "CMD-LINT"]
}
<!-- AWM:COMPACT-SLICES:END v1 -->

<a id="slice-s1"></a>
### Slice S1: Factory + pin simple-git 4.0.2

#### Surfaces

Owns SG-1…SG-4. Create `cli/src/core/registry-git.ts` as the sole `simple-git` importer; rewire `registries.ts`, `registry/add.ts`, `versioning.ts` to `createRegistryGit`. Structural test locks pin, single import site, and exact allow-list. Grouping: pin + factory + call-site rewire must land together or typecheck/runtime break.

#### Implementation

1. **RED — structural test** `cli/tests/structural/simple-git-v4-pin.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const FACTORY = 'src/core/registry-git.ts';

describe('simple-git v4 pin (#238)', () => {
    it('pins simple-git exactly to 4.0.2', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8')) as {
            dependencies: Record<string, string>;
        };
        expect(pkg.dependencies['simple-git']).toBe('4.0.2');
    });

    it('imports simple-git only from registry-git.ts via named simpleGit', () => {
        const factory = fs.readFileSync(path.join(CLI_ROOT, FACTORY), 'utf8');
        expect(factory).toMatch(/import\s*\{[^}]*\bsimpleGit\b[^}]*\}\s*from\s*['"]simple-git['"]/);
        expect(factory).not.toMatch(/import\s+simpleGit\s+from\s*['"]simple-git['"]/);

        const walk = (dir: string): string[] => {
            const out: string[] = [];
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, ent.name);
                if (ent.isDirectory()) out.push(...walk(p));
                else if (ent.name.endsWith('.ts')) out.push(p);
            }
            return out;
        };
        for (const file of walk(path.join(CLI_ROOT, 'src'))) {
            const rel = path.relative(CLI_ROOT, file).replace(/\\/g, '/');
            if (rel === FACTORY) continue;
            const text = fs.readFileSync(file, 'utf8');
            expect(text).not.toMatch(/from\s*['"]simple-git['"]/);
            expect(text).not.toMatch(/\bsimpleGit\s*\(/);
        }
    });

    it('factory allowEnvironment is only GIT_TERMINAL_PROMPT and enables no allowUnsafe*', () => {
        const factory = fs.readFileSync(path.join(CLI_ROOT, FACTORY), 'utf8');
        expect(factory).toMatch(/allowEnvironment:\s*\[\s*['"]GIT_TERMINAL_PROMPT['"]\s*\]/);
        expect(factory).not.toMatch(/allowUnsafe/);
        expect(factory).toMatch(/timeout:\s*\{\s*block:\s*60_?000\s*\}/);
    });
});
```

2. Run CMD-STRUCT → RED (no factory file / pin still 3.36.0).

3. **GREEN — pin:** set `"simple-git": "4.0.2"` in `cli/package.json`; from `cli/` run `npm install`.

4. **GREEN — factory** `cli/src/core/registry-git.ts` (exact env pattern from audit P4 / design):

```ts
import { simpleGit, type SimpleGit } from 'simple-git';

export const REGISTRY_GIT_TIMEOUT_MS = 60_000;

/** Copy parent env without guarded GIT_* keys, then force non-interactive prompts. */
export function buildRegistryGitEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(parent)) {
        if (value === undefined) continue;
        if (key.toLowerCase().startsWith('git_')) continue;
        env[key] = value;
    }
    env.GIT_TERMINAL_PROMPT = '0';
    return env;
}

export function listIgnoredGuardedGitEnvNames(parent: NodeJS.ProcessEnv = process.env): string[] {
    return Object.keys(parent)
        .filter((key) => {
            const lower = key.toLowerCase();
            return lower.startsWith('git_') && lower !== 'git_terminal_prompt';
        })
        .sort((a, b) => a.localeCompare(b));
}

export function createRegistryGit(baseDir?: string): SimpleGit {
    const git = simpleGit({
        ...(baseDir !== undefined ? { baseDir } : {}),
        allowEnvironment: ['GIT_TERMINAL_PROMPT'],
        timeout: { block: REGISTRY_GIT_TIMEOUT_MS },
    });
    return git.env(buildRegistryGitEnv());
}
```

Also add a minimal `cli/tests/core/registry-git.test.ts` for S1 that asserts `buildRegistryGitEnv` drops `GIT_ASKPASS`/`GIT_SSL_CAINFO`, keeps `PATH`, sets `GIT_TERMINAL_PROMPT=0`, and that `createRegistryGit` against a missing remote fails without hanging (short timeout fixture or bogus `https://127.0.0.1:1/...` with expect message matching `/terminal prompts disabled|Failed to connect|Could not resolve|timed out|Authentication/i` within a few seconds). Expand classification assertions in S2.

5. **GREEN — rewire:**
   - `registries.ts`: `import { createRegistryGit } from './registry-git';` then `createRegistryGit()` / `createRegistryGit(reg.contentRoot)` replacing every `simpleGit(...)`.
   - `add.ts`: same with `createRegistryGit().clone(...)`.
   - `versioning.ts`: `import { createRegistryGit } from './registry-git';` and `import type { SimpleGit } from 'simple-git'` **is forbidden** — either export a type alias from the factory (`export type RegistryGit = SimpleGit`) or drop the annotation and infer. Prefer `export type { SimpleGit as RegistryGit }` re-export from factory so `versioning.ts` never imports `simple-git`.

6. Run CMD-STRUCT, CMD-FACTORY, CMD-SYNC, CMD-ADD, CMD-VER, CMD-TYPECHECK, CMD-LINT → GREEN.

7. Commit: `fix(deps): upgrade simple-git to 4.0.2 via registry-git factory`.

#### Edge cases

- Exact pin `"4.0.2"`, not `^4.0.2`.
- Spreading `process.env` into `.env()` is forbidden (ambient `GIT_ASKPASS` throws).
- Single-arg `.env('GIT_TERMINAL_PROMPT','0')` is forbidden (drops `PATH`).
- No `simpleGit(` outside the factory (structural test).

#### Evidence

SRC-PKG, SRC-REGISTRIES, SRC-ADD, SRC-VERSIONING, SRC-DESIGN, existing suite sources. RED: CMD-STRUCT. GREEN: listed greenCommands. Spec + quality reviews before S2.

#### Fallback

If `SimpleGit` type cannot be re-exported cleanly, keep the type import only inside `registry-git.ts` and type public helpers with inferred return of `createRegistryGit`. Amend + revalidate; do not reopen `allowUnsafe*`. Full-context retains gates.

<a id="slice-s2"></a>
### Slice S2: Honest ignored-env notice and sync failure UX

#### Surfaces

Owns SG-5…SG-7. Extend `registry-git.ts` (or a sibling `registry-git-errors.ts` under `cli/src/core/`) with ignored-name listing already started in S1, error classification, and wire:

- notice once before first network op inside `syncRegistries` / `addRegistry`
- classified messages on per-registry `action: 'error'` and clone failures
- `awm add` / `awm list`: when sync has errors but `assertSyncedRegistriesUsable` would pass, print cached version (`currentVersion` / result.version) + SG-6 text before continuing
- `awm update` / `awm sync` / `awm init` / `awm registry add`: any sync/clone failure → exit non-zero with SG-6 message (tighten today’s warn-and-continue-when-usable for these commands)

Grouping: all honesty UX depends on the S1 factory; one review boundary for operator-facing text.

#### Implementation

1. **RED — extend** `cli/tests/core/registry-git.test.ts`:
   - With `GIT_SSL_CAINFO=/secret/ca.pem` in a temp `parent` env, `listIgnoredGuardedGitEnvNames` returns `['GIT_SSL_CAINFO']` only (not the value).
   - Classifier maps a sample error string containing `terminal prompts disabled` → class `authentication` with remedy mentioning `credential.helper` or the design table; TLS wording → `tls`; `Could not resolve host` → `network`; timeout plugin message → `timeout`.
2. **RED — new** `cli/tests/commands/registry-sync-honesty.test.ts`:
   - Inject/deps or isolate HOME: force `syncRegistries` to return one `{ action:'error', name, error }` while leaving a usable registry layout on disk.
   - Assert the helper used by `add`/`list` (extract a small `formatRegistrySyncSoftFailure(...)` or similar from `index.ts` into `cli/src/core/` or `cli/src/ui/` for testability) includes cached version text + classified cause.
   - Assert `runSyncCore` / update path returns `code !== 0` when any registry result is `action:'error'` (amend `sync.ts` / `update.ts` / init step accordingly). Prefer testing the pure decision helper if commander wiring is heavy.
3. Run CMD-FACTORY and CMD-SOFT → RED.
4. **GREEN — implement:**
   - `warnIgnoredGitEnvOnce(log)`: module-level flag; log names joined + one-line pointer to file-based config (Spanish or existing CLI locale style — match surrounding `console.warn` copy in `index.ts`).
   - `classifyRegistryGitError(err: unknown): { class, fatalLine, remedy }` using substring heuristics on `err.message` / stderr; never include secret-bearing env values.
   - `syncRegistries` / `addRegistry`: call warn once; on catch, store/return classified message string.
   - `index.ts` add/list: after sync, if any `action==='error'` and usable, print soft-failure formatter then continue; if unusable, keep hard fail.
   - `sync.ts` / `update.ts` / init registry step / registry add: if any error result (or addRegistry not ok), return/exit non-zero after printing SG-6 text (do not rely only on `assertSyncedRegistriesUsable`).
5. Run CMD-FACTORY, CMD-SOFT, CMD-ADD, CMD-TYPECHECK, CMD-LINT → GREEN.
6. Commit: `fix(registries): honest GIT_* notices and classified sync failures`.

#### Edge cases

- Never print env **values** (only names).
- `GIT_TERMINAL_PROMPT` present in parent still ignored-list excluded (factory forces `0`).
- Multiple registries: classify per failed registry; soft path on add/list lists each failed name + cache version when known.
- Windows: case-insensitive `git_` prefix strip already handled via `toLowerCase()`.

#### Evidence

SRC-ADD-CMD, SRC-SYNC-CMD, SRC-UPDATE-CMD, SRC-DESIGN, SRC-REGISTRIES, SRC-ADD. RED/GREEN: CMD-FACTORY, CMD-SOFT (+ CMD-ADD). Spec + quality reviews. Change Record at finishing documents remedy table + ambient strip policy.

#### Fallback

If extracting add/list messaging without a large `index.ts` refactor is risky, add a tiny pure module `cli/src/core/registry-sync-report.ts` and keep `index.ts` as a one-line caller — amend plan only if new files beyond that are required. Do not re-enable ambient `GIT_ASKPASS`/`GIT_SSL_*`. Full-context retains gates.

## Traceability

| Req | Slice | Tests |
|-----|-------|-------|
| SG-1 | S1 | structural pin `4.0.2` |
| SG-2 | S1 | structural: only factory imports `simple-git` |
| SG-3 | S1 | structural allow-list + `registry-git` env unit tests |
| SG-4 | S1 | registries-sync, add, versioning suites |
| SG-5 | S2 | `listIgnoredGuardedGitEnvNames` / notice unit |
| SG-6 | S2 | classifier unit + add failure message |
| SG-7 | S2 | `registry-sync-honesty.test.ts` soft vs hard exits |

## Execution handoff

After `awm plan validate` → `valid` and `awm plan admit`, use `subagent-driven-development` (interactive). Re-admit required: plan digest changed by this amendment.
