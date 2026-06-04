# Harness Bundles — Sub-fase 1b (Activación por proyecto) Implementation Plan

<!-- awm-qa-complete: 2026-06-03 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir activar bundles por proyecto mediante un perfil portable (`.awm/profile.json`) que `awm add <bundle>` registra y `awm sync` re-materializa como symlinks locales, con scope por defecto derivado del bundle (`baseline`→global, `project`→local, `ambient`→global) y override manual.

**Architecture:** Tres unidades nuevas en `cli/src/core/`: (1) `profile.ts` — lee/escribe `.awm/profile.json`, encuentra la raíz del proyecto y mantiene el `.gitignore` del proyecto; (2) helpers de grafo en `bundles.ts` — `defaultScopeForBundle` y `resolveBundleClosure` (orden topológico deps-first); (3) `bundle-install.ts` — `installBundle` materializa el closure de un bundle como symlinks por tipo de artefacto, y `addBundle`/`syncProfile` orquestan registro de perfil + gitignore. `index.ts` gana un camino "add por nombre de bundle" y un comando `sync`. Toda la lógica vive en módulos testeables; `index.ts` solo cablea.

**Tech Stack:** TypeScript (CommonJS via ts-jest), Jest (`--runInBand`), commander, @clack/prompts, picocolors. Symlinks vía `fs.symlinkSync`. Sin dependencias nuevas.

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `cli/src/core/profile.ts` | Perfil de proyecto: `findProjectRoot`, `readProfile`, `writeProfile`, `addExtension`, `ensureSkillsGitignored`, helper `shouldRecordExtension` | **Crear** |
| `cli/src/core/bundles.ts` | Añadir `defaultScopeForBundle` + `resolveBundleClosure` (deps-first, deduped) | **Modificar** |
| `cli/src/core/bundle-install.ts` | `installBundle` (materializa closure), `addBundle` (install + registro perfil), `syncProfile` (re-materializa desde perfil) | **Crear** |
| `cli/src/index.ts` | Rama "add por bundle" en el comando `add`; nuevo comando `sync` | **Modificar** |
| `cli/tests/core/profile.test.ts` | Tests del perfil + gitignore + predicado | **Crear** |
| `cli/tests/core/bundles.test.ts` | Tests de `defaultScopeForBundle` + `resolveBundleClosure` | **Modificar** |
| `cli/tests/core/bundle-install.test.ts` | Tests de `installBundle`/`addBundle`/`syncProfile` sobre fixture all-local | **Crear** |

**Convención de tests:** todos los efectos de filesystem ocurren bajo `fs.mkdtempSync(os.tmpdir())`. Los fixtures usan bundles de scope `project` (que instalan **local** bajo `projectRoot`) para no escribir nunca en el `~/.claude` real. El mapeo `baseline→global` se verifica en `defaultScopeForBundle` (puro) y se valida end-to-end en el smoke manual (Task 6), no escribiendo en home desde Jest.

**Alcance 1b (de `2026-06-02-harness-bundles-activation-design.md` §8):** `.awm/profile.json` + `awm sync` + `awm add <bundle> [--global|--local]` + scope `project`. **Fuera de alcance:** `~/.awm/config.json` para ambient (1d), `awm doctor` (1c), `awm init` (1d), detección de stack (1d).

---

## Task 1: Helpers de grafo de bundles (`defaultScopeForBundle`, `resolveBundleClosure`)

**Files:**
- Modify: `cli/src/core/bundles.ts`
- Test: `cli/tests/core/bundles.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `cli/tests/core/bundles.test.ts` (después del bloque `resolveBundleSkills`). Importar los dos símbolos nuevos en la línea de import existente:

```typescript
import {
    discoverBundles,
    readCatalog,
    resolveBundleSkills,
    resolveBundleClosure,
    defaultScopeForBundle,
    BundleDefinition,
} from '../../src/core/bundles';
```

```typescript
describe('defaultScopeForBundle', () => {
    it('maps baseline and ambient to global, project to local', () => {
        expect(defaultScopeForBundle('baseline')).toBe('global');
        expect(defaultScopeForBundle('ambient')).toBe('global');
        expect(defaultScopeForBundle('project')).toBe('local');
    });
});

describe('resolveBundleClosure', () => {
    it('returns dependencies before the bundle, deduped, in deps-first order', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        const closure = resolveBundleClosure('frontend', bundles);
        expect(closure.map((b) => b.name)).toEqual(['dev', 'frontend']);
    });

    it('returns just the bundle when it has no dependencies', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        const closure = resolveBundleClosure('dev', bundles);
        expect(closure.map((b) => b.name)).toEqual(['dev']);
    });

    it('returns [] for an unknown bundle name', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        expect(resolveBundleClosure('nope', bundles)).toEqual([]);
    });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd cli && npx jest tests/core/bundles.test.ts -t "defaultScopeForBundle|resolveBundleClosure"`
Expected: FAIL — `defaultScopeForBundle is not a function` / `resolveBundleClosure is not a function`.

- [ ] **Step 3: Implementar los helpers**

En `cli/src/core/bundles.ts`, añadir el import de `Scope` arriba (junto a los imports existentes) y las dos funciones al final del archivo:

```typescript
import { Scope } from '../providers';
```

```typescript
/**
 * Default install scope for a bundle, derived from its scope class.
 * baseline/ambient install globally; project bundles install locally.
 */
export function defaultScopeForBundle(scope: BundleScope): Scope {
    return scope === 'project' ? 'local' : 'global';
}

/**
 * Resolves the dependency closure of a bundle in deps-first order, deduped.
 * Each bundle appears once, after all bundles it depends on. Unknown names
 * (missing from `bundles`) are skipped.
 */
export function resolveBundleClosure(
    bundleName: string,
    bundles: BundleDefinition[]
): BundleDefinition[] {
    const byName = new Map(bundles.map((b) => [b.name, b]));
    const ordered: BundleDefinition[] = [];
    const seen = new Set<string>();
    const visit = (name: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        const b = byName.get(name);
        if (!b) return;
        for (const dep of b.dependsOn) visit(dep);
        ordered.push(b);
    };
    visit(bundleName);
    return ordered;
}
```

> Nota: `bundles.ts` importa de `../providers`; `providers/index.ts` no importa de `bundles.ts`, por lo que no hay ciclo de imports.

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd cli && npx jest tests/core/bundles.test.ts`
Expected: PASS (todos, incluidos los preexistentes).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/bundles.ts cli/tests/core/bundles.test.ts
git commit -m "feat(bundles): add defaultScopeForBundle + resolveBundleClosure"
```

---

## Task 2: Perfil de proyecto (`profile.ts`)

**Files:**
- Create: `cli/src/core/profile.ts`
- Test: `cli/tests/core/profile.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `cli/tests/core/profile.test.ts`:

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    findProjectRoot,
    readProfile,
    writeProfile,
    addExtension,
    ensureSkillsGitignored,
    shouldRecordExtension,
} from '../../src/core/profile';

function tmpRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-profile-'));
}

describe('findProjectRoot', () => {
    it('finds the root via a .git marker walking up from a subdir', () => {
        const root = tmpRoot();
        fs.mkdirSync(path.join(root, '.git'));
        const sub = path.join(root, 'a', 'b');
        fs.mkdirSync(sub, { recursive: true });
        // realpathSync normalizes /private symlink prefixes on macOS tmp dirs.
        expect(findProjectRoot(sub)).toBe(fs.realpathSync(root));
    });

    it('finds the root via package.json', () => {
        const root = tmpRoot();
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        expect(findProjectRoot(root)).toBe(fs.realpathSync(root));
    });

    it('finds the root via .awm/profile.json', () => {
        const root = tmpRoot();
        fs.mkdirSync(path.join(root, '.awm'));
        fs.writeFileSync(path.join(root, '.awm', 'profile.json'), '{"extensions":[]}');
        expect(findProjectRoot(root)).toBe(fs.realpathSync(root));
    });

    it('returns null when no marker is found up to the filesystem root', () => {
        const root = tmpRoot(); // bare tmp dir, no markers
        expect(findProjectRoot(root)).toBeNull();
    });
});

describe('readProfile / writeProfile / addExtension', () => {
    it('returns an empty profile when none exists', () => {
        const root = tmpRoot();
        expect(readProfile(root)).toEqual({ extensions: [] });
    });

    it('round-trips a written profile', () => {
        const root = tmpRoot();
        writeProfile(root, { extensions: ['frontend'] });
        expect(readProfile(root)).toEqual({ extensions: ['frontend'] });
        expect(fs.existsSync(path.join(root, '.awm', 'profile.json'))).toBe(true);
    });

    it('addExtension appends and dedupes', () => {
        const root = tmpRoot();
        addExtension(root, 'frontend');
        addExtension(root, 'frontend');
        addExtension(root, 'docs');
        expect(readProfile(root).extensions).toEqual(['frontend', 'docs']);
    });

    it('tolerates a malformed extensions field', () => {
        const root = tmpRoot();
        fs.mkdirSync(path.join(root, '.awm'));
        fs.writeFileSync(path.join(root, '.awm', 'profile.json'), '{"extensions":"oops"}');
        expect(readProfile(root)).toEqual({ extensions: [] });
    });
});

describe('ensureSkillsGitignored', () => {
    it('appends the pattern when .gitignore is absent', () => {
        const root = tmpRoot();
        ensureSkillsGitignored(root);
        const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
        expect(gi.split(/\r?\n/)).toContain('.claude/skills/');
    });

    it('is idempotent and preserves existing entries', () => {
        const root = tmpRoot();
        fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
        ensureSkillsGitignored(root);
        ensureSkillsGitignored(root);
        const lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8').split(/\r?\n/);
        expect(lines).toContain('node_modules');
        expect(lines.filter((l) => l.trim() === '.claude/skills/').length).toBe(1);
    });

    it('does not duplicate when the unslashed variant already exists', () => {
        const root = tmpRoot();
        fs.writeFileSync(path.join(root, '.gitignore'), '.claude/skills\n');
        ensureSkillsGitignored(root);
        const lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8').split(/\r?\n/);
        expect(lines.filter((l) => l.trim().startsWith('.claude/skills')).length).toBe(1);
    });
});

describe('shouldRecordExtension', () => {
    it('records only project-scope bundles installed locally', () => {
        expect(shouldRecordExtension('project', 'local')).toBe(true);
        expect(shouldRecordExtension('project', 'global')).toBe(false);
        expect(shouldRecordExtension('baseline', 'global')).toBe(false);
        expect(shouldRecordExtension('baseline', 'local')).toBe(false);
        expect(shouldRecordExtension('ambient', 'global')).toBe(false);
    });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd cli && npx jest tests/core/profile.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/profile'`.

- [ ] **Step 3: Implementar `profile.ts`**

Crear `cli/src/core/profile.ts`:

```typescript
// src/core/profile.ts
import fs from 'fs';
import path from 'path';
import type { BundleScope } from './bundles';
import type { Scope } from '../providers';

export interface ProjectProfile {
    extensions: string[];
}

const GITIGNORE_ENTRY = '.claude/skills/';

/**
 * Walks up from `startDir` looking for a project root marker
 * (`.git/`, `package.json`, or `.awm/profile.json`). Returns the
 * absolute (realpath) directory, or null if none is found.
 */
export function findProjectRoot(startDir: string): string | null {
    let dir = fs.realpathSync(path.resolve(startDir));
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (
            fs.existsSync(path.join(dir, '.git')) ||
            fs.existsSync(path.join(dir, 'package.json')) ||
            fs.existsSync(path.join(dir, '.awm', 'profile.json'))
        ) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function profilePath(root: string): string {
    return path.join(root, '.awm', 'profile.json');
}

export function readProfile(root: string): ProjectProfile {
    const file = profilePath(root);
    if (!fs.existsSync(file)) return { extensions: [] };
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return { extensions: Array.isArray(raw.extensions) ? raw.extensions : [] };
    } catch {
        return { extensions: [] };
    }
}

export function writeProfile(root: string, profile: ProjectProfile): void {
    const dir = path.join(root, '.awm');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(profilePath(root), JSON.stringify(profile, null, 2) + '\n', 'utf-8');
}

/** Adds a bundle name to the profile's extensions (deduped) and persists it. */
export function addExtension(root: string, name: string): ProjectProfile {
    const profile = readProfile(root);
    if (!profile.extensions.includes(name)) profile.extensions.push(name);
    writeProfile(root, profile);
    return profile;
}

/**
 * Ensures the project's .gitignore ignores the local skill symlinks
 * (machine-specific; rebuilt by `awm sync`). Idempotent.
 */
export function ensureSkillsGitignored(root: string): void {
    const gi = path.join(root, '.gitignore');
    const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf-8') : '';
    const alreadyIgnored = existing
        .split(/\r?\n/)
        .some((l) => l.trim() === '.claude/skills/' || l.trim() === '.claude/skills');
    if (alreadyIgnored) return;
    const needsNewline = existing.length > 0 && !existing.endsWith('\n');
    fs.appendFileSync(gi, `${needsNewline ? '\n' : ''}${GITIGNORE_ENTRY}\n`);
}

/**
 * A bundle is recorded as a project extension only when it is a `project`-scope
 * bundle being installed locally. Baseline/ambient and global installs are not
 * project extensions and stay out of `.awm/profile.json`.
 */
export function shouldRecordExtension(bundleScope: BundleScope, effective: Scope): boolean {
    return bundleScope === 'project' && effective === 'local';
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd cli && npx jest tests/core/profile.test.ts`
Expected: PASS (todos los bloques).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/profile.ts cli/tests/core/profile.test.ts
git commit -m "feat(profile): add project profile manager + gitignore guard"
```

---

## Task 3: Materializador de bundles (`installBundle`)

**Files:**
- Create: `cli/src/core/bundle-install.ts`
- Test: `cli/tests/core/bundle-install.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `cli/tests/core/bundle-install.test.ts`. El fixture usa **solo bundles `project`** para que todo se instale local bajo `projectRoot` (sin tocar el home real):

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverBundles } from '../../src/core/bundles';
import { installBundle } from '../../src/core/bundle-install';

/**
 * Builds a fixture with:
 *  - content registry: catalog + two project bundles (base, ext dependsOn base),
 *    plus a skill dir per skill, one workflow .md and one agent .md.
 *  - a separate empty project root for local installs.
 * Both bundles are `project` scope so every artifact lands under projectRoot/.claude.
 */
function makeFixture() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-binstall-'));
    const content = path.join(tmp, 'registry');
    const projectRoot = path.join(tmp, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });

    fs.mkdirSync(path.join(content, 'bundles', 'base'), { recursive: true });
    fs.mkdirSync(path.join(content, 'bundles', 'ext'), { recursive: true });
    // skill source dirs
    for (const s of ['s-base', 's-ext']) {
        fs.mkdirSync(path.join(content, 'skills', s), { recursive: true });
        fs.writeFileSync(path.join(content, 'skills', s, 'SKILL.md'), `---\nname: ${s}\n---\n`);
    }
    // a workflow + agent source for `ext`
    fs.mkdirSync(path.join(content, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(content, 'workflows', 'wf-ext.md'), '# wf');
    fs.mkdirSync(path.join(content, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(content, 'agents', 'ag-ext.md'), '# agent');

    fs.writeFileSync(path.join(content, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [
            { name: 'base', source: './bundles/base', version: '1.0.0', scope: 'project' },
            { name: 'ext', source: './bundles/ext', version: '1.0.0', scope: 'project' },
        ],
    }));
    fs.writeFileSync(path.join(content, 'bundles', 'base', 'bundle.json'), JSON.stringify({
        name: 'base', version: '1.0.0', description: 'Base', scope: 'project', dependsOn: [],
        skills: ['s-base'], workflows: [], agents: [],
    }));
    fs.writeFileSync(path.join(content, 'bundles', 'ext', 'bundle.json'), JSON.stringify({
        name: 'ext', version: '1.0.0', description: 'Ext', scope: 'project', dependsOn: ['base'],
        skills: ['s-ext'], workflows: ['wf-ext'], agents: ['ag-ext'],
    }));

    return { content, projectRoot, bundles: discoverBundles(content) };
}

describe('installBundle', () => {
    it('materializes the bundle closure as local symlinks (deps + own skills)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const result = installBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });

        const skillsDir = path.join(projectRoot, '.claude', 'skills');
        expect(fs.existsSync(path.join(skillsDir, 's-base'))).toBe(true); // from dep `base`
        expect(fs.existsSync(path.join(skillsDir, 's-ext'))).toBe(true);  // from `ext`
        expect(fs.lstatSync(path.join(skillsDir, 's-ext')).isSymbolicLink()).toBe(true);
        expect(result.installed.some((l) => l.includes('s-base'))).toBe(true);
    });

    it('installs supported artifact types and skips unsupported ones (claude-code workflows)', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const result = installBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        // claude-code has no workflow dir → wf-ext is skipped; agents are supported.
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'agents', 'ag-ext.md'))).toBe(true);
        expect(result.skipped.some((l) => l.includes('wf-ext'))).toBe(true);
    });

    it('is idempotent: a second run leaves valid symlinks and does not throw', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const opts = {
            bundleName: 'ext', bundles, agents: ['claude-code' as const],
            method: 'symlink' as const, projectRoot, contentDir: content,
        };
        installBundle(opts);
        expect(() => installBundle(opts)).not.toThrow();
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
    });

    it('skips artifacts whose source is missing instead of throwing', () => {
        const { content, projectRoot, bundles } = makeFixture();
        fs.rmSync(path.join(content, 'skills', 's-base'), { recursive: true, force: true });
        const result = installBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        expect(result.skipped.some((l) => l.includes('s-base'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
    });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd cli && npx jest tests/core/bundle-install.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/bundle-install'`.

- [ ] **Step 3: Implementar `installBundle`**

Crear `cli/src/core/bundle-install.ts`:

```typescript
// src/core/bundle-install.ts
import fs from 'fs';
import path from 'path';
import {
    BundleDefinition,
    REGISTRY_CONTENT_DIR,
    defaultScopeForBundle,
    resolveBundleClosure,
} from './bundles';
import { installArtifact } from './executor';
import { AgentTarget, ArtifactType, Scope, getTargetPath, PROVIDERS } from '../providers';

export type InstallMethod = 'symlink' | 'copy';

export interface InstallBundleOptions {
    bundleName: string;
    bundles: BundleDefinition[];
    agents: AgentTarget[];
    method: InstallMethod;
    projectRoot: string;
    /** Applies only to the named bundle; dependencies always use their default scope. */
    scopeOverride?: Scope;
    /** Registry content root (defaults to the real cache). Overridable for tests. */
    contentDir?: string;
}

export interface InstallSummary {
    installed: string[];
    skipped: string[];
}

interface ArtifactRef {
    name: string;
    type: ArtifactType;
    installName: string;
    sourcePath: string;
}

function bundleArtifacts(b: BundleDefinition, contentDir: string): ArtifactRef[] {
    const refs: ArtifactRef[] = [];
    for (const s of b.skills) {
        refs.push({ name: s.name, type: 'skill', installName: s.name, sourcePath: path.join(contentDir, 'skills', s.name) });
    }
    for (const w of b.workflows) {
        refs.push({ name: w, type: 'workflow', installName: `${w}.md`, sourcePath: path.join(contentDir, 'workflows', `${w}.md`) });
    }
    for (const a of b.agents) {
        refs.push({ name: a, type: 'agent', installName: `${a}.md`, sourcePath: path.join(contentDir, 'agents', `${a}.md`) });
    }
    return refs;
}

/**
 * Materializes a bundle and its dependency closure into the target agents.
 * The named bundle uses `scopeOverride` if given; dependencies always use
 * their own default scope (baseline→global, project→local, ambient→global).
 * Local installs resolve under `projectRoot`; global installs use the
 * provider's absolute global path. Unsupported artifact types per agent and
 * missing sources are skipped (never thrown).
 */
export function installBundle(opts: InstallBundleOptions): InstallSummary {
    const contentDir = opts.contentDir ?? REGISTRY_CONTENT_DIR;
    const closure = resolveBundleClosure(opts.bundleName, opts.bundles);
    const installed: string[] = [];
    const skipped: string[] = [];

    for (const b of closure) {
        const scope: Scope =
            b.name === opts.bundleName
                ? opts.scopeOverride ?? defaultScopeForBundle(b.scope)
                : defaultScopeForBundle(b.scope);

        for (const art of bundleArtifacts(b, contentDir)) {
            if (!fs.existsSync(art.sourcePath)) {
                skipped.push(`${art.name} (source missing: ${art.sourcePath})`);
                continue;
            }
            for (const agent of opts.agents) {
                if (PROVIDERS[agent][art.type] === null) {
                    skipped.push(`${art.name} (${agent}: ${art.type} unsupported)`);
                    continue;
                }
                const rel = getTargetPath(art.type, agent, scope);
                const baseDir = scope === 'local' ? path.join(opts.projectRoot, rel) : rel;
                const dest = path.join(baseDir, art.installName);
                installArtifact(art.sourcePath, dest, opts.method);
                installed.push(`${art.name} → ${agent} (${scope}) [${b.name}]`);
            }
        }
    }

    return { installed, skipped };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd cli && npx jest tests/core/bundle-install.test.ts`
Expected: PASS (los 4 casos).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/bundle-install.ts cli/tests/core/bundle-install.test.ts
git commit -m "feat(bundle-install): materialize bundle closure as symlinks"
```

---

## Task 4: Orquestación `addBundle` (install + registro de perfil)

**Files:**
- Modify: `cli/src/core/bundle-install.ts`
- Test: `cli/tests/core/bundle-install.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `cli/tests/core/bundle-install.test.ts`. Actualizar el import superior:

```typescript
import { installBundle, addBundle } from '../../src/core/bundle-install';
import { readProfile } from '../../src/core/profile';
```

```typescript
describe('addBundle', () => {
    it('records a project bundle installed locally as an extension + gitignores symlinks', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const result = addBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        expect(result.recordedExtension).toBe('ext');
        expect(readProfile(projectRoot).extensions).toEqual(['ext']);
        const gi = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf-8');
        expect(gi).toContain('.claude/skills/');
    });

    it('does not record the dependency bundle, only the named one', () => {
        const { content, projectRoot, bundles } = makeFixture();
        addBundle({
            bundleName: 'ext', bundles, agents: ['claude-code'],
            method: 'symlink', projectRoot, contentDir: content,
        });
        expect(readProfile(projectRoot).extensions).toEqual(['ext']); // not ['base','ext']
    });

    it('is idempotent: adding the same bundle twice keeps one extension entry', () => {
        const { content, projectRoot, bundles } = makeFixture();
        const opts = {
            bundleName: 'ext', bundles, agents: ['claude-code' as const],
            method: 'symlink' as const, projectRoot, contentDir: content,
        };
        addBundle(opts);
        addBundle(opts);
        expect(readProfile(projectRoot).extensions).toEqual(['ext']);
    });
});
```

> El caso "project bundle instalado `--global` no se registra" queda cubierto por el unit test puro `shouldRecordExtension` (Task 2), evitando escrituras en el home real desde Jest.

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd cli && npx jest tests/core/bundle-install.test.ts -t addBundle`
Expected: FAIL — `addBundle is not a function`.

- [ ] **Step 3: Implementar `addBundle`**

Añadir a `cli/src/core/bundle-install.ts`. Actualizar imports y añadir la función:

```typescript
import { addExtension, ensureSkillsGitignored, shouldRecordExtension } from './profile';
```

```typescript
export interface AddBundleResult extends InstallSummary {
    /** The bundle name recorded as a project extension, or null if not recorded. */
    recordedExtension: string | null;
}

/**
 * Installs a bundle (closure) and, when it is a project-scope bundle installed
 * locally, records it as an extension in `.awm/profile.json` and ensures the
 * local symlinks are gitignored. Dependencies are never recorded.
 */
export function addBundle(opts: InstallBundleOptions): AddBundleResult {
    const summary = installBundle(opts);
    const target = opts.bundles.find((b) => b.name === opts.bundleName);

    let recordedExtension: string | null = null;
    if (target) {
        const effective: Scope = opts.scopeOverride ?? defaultScopeForBundle(target.scope);
        if (shouldRecordExtension(target.scope, effective)) {
            addExtension(opts.projectRoot, opts.bundleName);
            ensureSkillsGitignored(opts.projectRoot);
            recordedExtension = opts.bundleName;
        }
    }

    return { ...summary, recordedExtension };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd cli && npx jest tests/core/bundle-install.test.ts`
Expected: PASS (installBundle + addBundle).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/bundle-install.ts cli/tests/core/bundle-install.test.ts
git commit -m "feat(bundle-install): addBundle records project extensions"
```

---

## Task 5: `syncProfile` + wiring de comandos (`awm add <bundle>`, `awm sync`)

**Files:**
- Modify: `cli/src/core/bundle-install.ts`
- Modify: `cli/src/index.ts`
- Test: `cli/tests/core/bundle-install.test.ts`

- [ ] **Step 1: Escribir el test que falla para `syncProfile`**

Añadir al final de `cli/tests/core/bundle-install.test.ts`. Actualizar el import:

```typescript
import { installBundle, addBundle, syncProfile } from '../../src/core/bundle-install';
import { readProfile, writeProfile } from '../../src/core/profile';
```

```typescript
describe('syncProfile', () => {
    it('rematerializes symlinks for every extension listed in the profile', () => {
        const { content, projectRoot, bundles } = makeFixture();
        writeProfile(projectRoot, { extensions: ['ext'] });
        const result = syncProfile({
            projectRoot, bundles, agents: ['claude-code'],
            method: 'symlink', contentDir: content,
        });
        expect(result.extensions).toEqual(['ext']);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-ext'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 's-base'))).toBe(true);
    });

    it('is a no-op when the profile has no extensions', () => {
        const { content, projectRoot, bundles } = makeFixture();
        writeProfile(projectRoot, { extensions: [] });
        const result = syncProfile({
            projectRoot, bundles, agents: ['claude-code'],
            method: 'symlink', contentDir: content,
        });
        expect(result.extensions).toEqual([]);
        expect(result.installed).toEqual([]);
        expect(fs.existsSync(path.join(projectRoot, '.claude', 'skills'))).toBe(false);
    });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd cli && npx jest tests/core/bundle-install.test.ts -t syncProfile`
Expected: FAIL — `syncProfile is not a function`.

- [ ] **Step 3: Implementar `syncProfile`**

Añadir a `cli/src/core/bundle-install.ts`. Actualizar el import de `./profile` para incluir `readProfile`:

```typescript
import { addExtension, ensureSkillsGitignored, readProfile, shouldRecordExtension } from './profile';
```

```typescript
export interface SyncProfileOptions {
    projectRoot: string;
    bundles: BundleDefinition[];
    agents: AgentTarget[];
    method: InstallMethod;
    contentDir?: string;
}

export interface SyncResult extends InstallSummary {
    extensions: string[];
}

/**
 * Rebuilds local symlinks from `.awm/profile.json` — each listed extension is
 * installed locally (with its dependency closure). Does not modify the profile.
 */
export function syncProfile(opts: SyncProfileOptions): SyncResult {
    const profile = readProfile(opts.projectRoot);
    const installed: string[] = [];
    const skipped: string[] = [];

    for (const ext of profile.extensions) {
        const summary = installBundle({
            bundleName: ext,
            bundles: opts.bundles,
            agents: opts.agents,
            method: opts.method,
            projectRoot: opts.projectRoot,
            contentDir: opts.contentDir,
        });
        installed.push(...summary.installed);
        skipped.push(...summary.skipped);
    }

    if (profile.extensions.length > 0) ensureSkillsGitignored(opts.projectRoot);

    return { installed, skipped, extensions: profile.extensions };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd cli && npx jest tests/core/bundle-install.test.ts`
Expected: PASS (installBundle + addBundle + syncProfile).

- [ ] **Step 5: Cablear la rama "add por bundle" en `index.ts`**

En `cli/src/index.ts`, ampliar los imports existentes:

```typescript
import { discoverBundles, defaultScopeForBundle } from './core/bundles';
import { addBundle, syncProfile } from './core/bundle-install';
import { findProjectRoot, readProfile } from './core/profile';
```

En el `action` del comando `add`, justo **después** del bloque que sincroniza el registry (tras `s.stop('Registry synced.')`, antes de `// 2. Discover artifacts`), insertar la rama de bundle:

```typescript
      // 1b. If `name` matches a bundle, run the bundle-activation flow and exit.
      if (name) {
          const allBundles = discoverBundles();
          const matchedBundle = allBundles.find((b) => b.name === name);
          if (matchedBundle) {
              const prefs = getPreferences();

              let bundleAgents: AgentTarget[];
              if (options.agent) {
                  const valid = Object.keys(PROVIDERS);
                  const parsed = options.agent.split(',').map((a) => a.trim());
                  for (const a of parsed) {
                      if (!valid.includes(a)) {
                          console.error(pc.red(`Invalid agent "${a}". Use: ${valid.join(', ')}.`));
                          process.exit(1);
                      }
                  }
                  bundleAgents = parsed as AgentTarget[];
              } else {
                  bundleAgents = [prefs.defaultAgent];
              }

              let scopeOverride: Scope | undefined;
              if (options.scope) {
                  if (!['local', 'global'].includes(options.scope)) {
                      console.error(pc.red(`Invalid scope "${options.scope}". Use: local or global.`));
                      process.exit(1);
                  }
                  scopeOverride = options.scope as Scope;
              }

              const effective = scopeOverride ?? defaultScopeForBundle(matchedBundle.scope);
              const projectRoot = findProjectRoot(process.cwd());
              if (effective === 'local' && !projectRoot) {
                  console.error(pc.red('No project root found (need a .git/, package.json, or .awm/profile.json here). Run inside a project, or pass --global.'));
                  process.exit(1);
              }

              const result = addBundle({
                  bundleName: matchedBundle.name,
                  bundles: allBundles,
                  agents: bundleAgents,
                  method: 'symlink',
                  projectRoot: projectRoot ?? process.cwd(),
                  scopeOverride,
              });

              if (result.installed.length === 0) {
                  outro(pc.yellow(`Nothing installed for bundle "${matchedBundle.name}".`));
                  return;
              }
              const lines = result.installed.map((n) => pc.green(n)).join('\n  ');
              const recordNote = result.recordedExtension
                  ? `\n\n${pc.dim('Recorded as a project extension in .awm/profile.json (commit it; symlinks are gitignored).')}`
                  : '';
              outro(`✅ Installed bundle ${pc.cyan(matchedBundle.name)}:\n  ${lines}${recordNote}`);
              return;
          }
      }
```

> La rama solo dispara cuando `name` coincide con un bundle del catálogo; cualquier otro `name` (o ausencia de `name`) cae al flujo interactivo existente sin cambios.

- [ ] **Step 6: Cablear el comando `awm sync` en `index.ts`**

En `cli/src/index.ts`, añadir un nuevo comando **después** del bloque del comando `update` (antes de `program.command('list ...')`):

```typescript
program.command('sync')
  .description('Rebuild local skill symlinks from .awm/profile.json (e.g. after cloning on a new machine)')
  .option('-a, --agent <agent>', `Target agent: ${Object.keys(PROVIDERS).join(', ')}`)
  .option('-m, --method <method>', 'Install method: symlink or copy', 'symlink')
  .action(async (options: { agent?: string; method?: string }) => {
      intro(pc.bgCyan(pc.black(' AWM - Sync Project Profile ')));

      const projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
          console.error(pc.red('No project root found (need a .git/, package.json, or .awm/profile.json here).'));
          process.exit(1);
      }

      const profile = readProfile(projectRoot);
      if (profile.extensions.length === 0) {
          outro(pc.yellow('No extensions in .awm/profile.json — nothing to sync. Use `awm add <bundle>` first.'));
          return;
      }

      const s = spinner();
      s.start('Syncing registry...');
      try {
          await syncRegistry();
          s.stop('Registry synced.');
      } catch (e: any) {
          s.stop('Failed to sync registry.');
          console.error(pc.red(e.message));
          process.exit(1);
      }

      const prefs = getPreferences();
      let agents: AgentTarget[];
      if (options.agent) {
          const valid = Object.keys(PROVIDERS);
          const parsed = options.agent.split(',').map((a) => a.trim());
          for (const a of parsed) {
              if (!valid.includes(a)) {
                  console.error(pc.red(`Invalid agent "${a}". Use: ${valid.join(', ')}.`));
                  process.exit(1);
              }
          }
          agents = parsed as AgentTarget[];
      } else {
          agents = [prefs.defaultAgent];
      }
      const method = options.method === 'copy' ? 'copy' : 'symlink';

      const result = syncProfile({ projectRoot, bundles: discoverBundles(), agents, method });
      const lines = result.installed.map((n) => pc.green(n)).join('\n  ');
      outro(`✅ Synced extensions [${result.extensions.join(', ')}]:\n  ${lines}`);
  });
```

- [ ] **Step 7: Compilar y correr toda la suite**

Run: `cd cli && npm run build && npm test`
Expected: `tsc` compila limpio; todos los tests pasan (incluidos los preexistentes de hooks/sensors/registry).

- [ ] **Step 8: Commit**

```bash
git add cli/src/core/bundle-install.ts cli/src/index.ts cli/tests/core/bundle-install.test.ts
git commit -m "feat(cli): wire 'awm add <bundle>' + 'awm sync' to project profile"
```

---

## Task 6: Verificación end-to-end (smoke manual) + cierre

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Smoke en un proyecto sintético (scope local + perfil)**

Run:
```bash
cd cli && npm run build
TMP=$(mktemp -d) && mkdir -p "$TMP/.git" && cd "$TMP"
node "$OLDPWD/dist/src/index.js" add frontend --agent claude-code --scope local --yes 2>&1 | tail -20
echo "--- profile ---" && cat .awm/profile.json
echo "--- gitignore ---" && cat .gitignore
echo "--- symlinks ---" && ls -la .claude/skills | head
```
Expected: `.awm/profile.json` contiene `{"extensions":["frontend"]}`; `.gitignore` incluye `.claude/skills/`; `.claude/skills/` tiene symlinks de las skills de `frontend` (impeccable, ui-design, …) y de `dev` (espina) materializados local.

> Requiere cache de registry en `~/.awm/registry`. Si no existe, el primer `add` lo clona (red). En entorno sin red, validar con la suite Jest (Task 5 Step 7) que no toca red.

- [ ] **Step 2: Smoke de idempotencia + `awm sync`**

Run (continuando en `$TMP`):
```bash
rm -rf .claude/skills          # simula otra máquina: perfil presente, symlinks ausentes
node "$OLDPWD/dist/src/index.js" sync --agent claude-code 2>&1 | tail -15
echo "--- rebuilt ---" && ls .claude/skills | head
node "$OLDPWD/dist/src/index.js" sync --agent claude-code 2>&1 | tail -3   # segunda corrida: sin errores
```
Expected: `awm sync` reconstruye los symlinks desde `.awm/profile.json`; la segunda corrida es idempotente (sin throw, mismo estado).

- [ ] **Step 3: Grep de cohesión (sin referencias rotas ni TODOs)**

Run: `cd cli && grep -rn "TODO\|FIXME\|implement later" src/core/profile.ts src/core/bundle-install.ts`
Expected: sin resultados.

- [ ] **Step 4: Limpieza del tmp de smoke**

Run: `rm -rf "$TMP"`
Expected: sin salida.

- [ ] **Step 5: Commit (si hubo ajustes durante la verificación)**

```bash
git add -A
git commit -m "chore(cli): finalize phase 1b project activation"
```

---

## Self-Review (cobertura del spec)

- **§5.3 `.awm/profile.json` portable (`{ extensions: [...] }`)** → Task 2 (`profile.ts`: read/write/addExtension) + Task 4 (registro en `addBundle`).
- **§5.3 symlinks gitignored, perfil committeado** → Task 2 (`ensureSkillsGitignored`) + Task 4/5 (invocado en `addBundle`/`syncProfile`) + output que instruye commitear el perfil.
- **§7.1 `awm add <bundle> [--global|--local]` resolviendo `dependsOn` + override de scope** → Task 1 (`resolveBundleClosure`) + Task 3 (`installBundle` con `scopeOverride` aplicado solo al bundle nombrado) + Task 5 Step 5 (wiring `add`).
- **§7.1 `awm sync` reconstruye symlinks desde el perfil** → Task 5 (`syncProfile` + comando `sync`).
- **§5.2 scope por bundle (baseline→global, project→local, ambient→global)** → Task 1 (`defaultScopeForBundle`) + Task 3 (deps en su scope por defecto).
- **§5.1 activar = symlink desde el cache** → Task 3 (`installArtifact(method='symlink')`); el flujo de bundle usa siempre symlink.
- **§3 dev-core implícito (baseline), extensiones explícitas** → Task 4 (`shouldRecordExtension`: solo `project`+`local` se registra; deps nunca).
- **§8 sub-fase 1b shippable** → Tasks 1-5 entregan add/sync/profile funcionando; Task 6 lo valida end-to-end.

**Type consistency:** `InstallBundleOptions`/`InstallSummary` definidos en Task 3 y reusados por `addBundle` (Task 4) y `syncProfile` (Task 5, vía `SyncProfileOptions`). `Scope`/`AgentTarget`/`ArtifactType` provienen de `providers`. `BundleScope`/`defaultScopeForBundle`/`resolveBundleClosure` de `bundles.ts` (Task 1). `ProjectProfile`/`shouldRecordExtension` de `profile.ts` (Task 2). Nombres estables en todas las firmas.

**Fuera de alcance confirmado (no son gaps):** `~/.awm/config.json` para ambient + `awm init` orquestador (1d), `awm doctor` (1c), detección de stack del repo (1d), resolver de rangos/tags (Fase 2), sources externos (Fase 4).
