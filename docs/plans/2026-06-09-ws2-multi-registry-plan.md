# WS-2 — Multi-registry de equipo Implementation Plan
<!-- awm-qa-complete: 2026-06-10 -->
<!-- awm-retro-complete: 2026-06-10 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capas upstream + registry del equipo con overrides explícitos por manifest `awm-registry.json`, remote base configurable (env > prefs > default), e instalación de bundles al hacer `awm registry add`.

**Architecture:** Delta mínimo sobre el seam de WS-1 (spec: `docs/plans/2026-06-09-ws2-multi-registry-design.md`, enfoque A). `contentRoots(): string[]` no cambia. Nuevo `readRegistryManifest(root)` en `registries.ts`; los puntos de colisión existentes en `discovery.ts`/`bundles.ts` consultan el manifest del root posterior: declarado → reemplaza (con campo de procedencia `overrode`), no declarado → error actual intacto.

**Tech Stack:** TypeScript (Node), Commander, simple-git, @clack/prompts, Jest. Tests corren desde `cli/` con `npm test`.

**CRÍTICO (CONSTITUTION):** ningún test toca el `~/.awm` real. Todos usan tmpdirs con `process.env.HOME` + `process.env.AWM_HOME` sobreescritos en `beforeEach`/`afterEach` + `jest.resetModules()` + `require()` tardío (patrón de `cli/tests/core/registries.test.ts`). Repos git de fixture con `git init` local, sin red. Guard de nombre/path-component: rechazar el conjunto completo — vacío, `.`, `..`, `/`, `\`.

Durante la implementación usar @test-driven-development; antes de reportar DONE cada task corre `awm sensors run` (sin flag).

---

### Task 1: `readRegistryManifest` + `registryNameForPath` en `registries.ts`

**Files:**
- Modify: `cli/src/core/registries.ts` (agregar al final del archivo)
- Test: `cli/tests/core/registry-manifest.test.ts` (nuevo)

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/tests/core/registry-manifest.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('registry manifest (awm-registry.json)', () => {
    let tmpHome: string;
    let tmpWork: string;
    const origHome = process.env.HOME;
    const origAwmHome = process.env.AWM_HOME;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-work-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        process.env.HOME = origHome;
        if (origAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = origAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
    });

    function load() {
        return require('../../src/core/registries');
    }

    it('returns empty overrides when manifest file is absent', () => {
        const { readRegistryManifest } = load();
        const m = readRegistryManifest(tmpWork);
        expect(m.overrides.size).toBe(0);
    });

    it('parses a valid manifest into a Set of names', () => {
        fs.writeFileSync(
            path.join(tmpWork, 'awm-registry.json'),
            JSON.stringify({ overrides: ['brainstorming', 'writing-plans'] })
        );
        const { readRegistryManifest } = load();
        const m = readRegistryManifest(tmpWork);
        expect(m.overrides.has('brainstorming')).toBe(true);
        expect(m.overrides.has('writing-plans')).toBe(true);
        expect(m.overrides.size).toBe(2);
    });

    it('treats a manifest without "overrides" key as empty', () => {
        fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), JSON.stringify({}));
        const { readRegistryManifest } = load();
        expect(readRegistryManifest(tmpWork).overrides.size).toBe(0);
    });

    it('throws with the file path on corrupt JSON — never silently empty', () => {
        fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), '{nope');
        const { readRegistryManifest } = load();
        expect(() => readRegistryManifest(tmpWork)).toThrow(/awm-registry\.json/);
    });

    it('throws when overrides is not an array of strings', () => {
        fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), JSON.stringify({ overrides: 'brainstorming' }));
        const { readRegistryManifest } = load();
        expect(() => readRegistryManifest(tmpWork)).toThrow(/array of strings/);
        fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), JSON.stringify({ overrides: [42] }));
        jest.resetModules();
        expect(() => load().readRegistryManifest(tmpWork)).toThrow(/array of strings/);
    });

    it.each(['', '.', '..', 'a/b', 'a\\b', '../up'])(
        'rejects override name %j (path traversal guard)',
        (bad) => {
            fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), JSON.stringify({ overrides: [bad] }));
            const { readRegistryManifest } = load();
            expect(() => readRegistryManifest(tmpWork)).toThrow(/path traversal/);
        }
    );

    it('registryNameForPath maps base content, additional registries, and unknown paths', () => {
        const m = load();
        const basePath = path.join(m.BASE_CONTENT_DIR, 'skills', 'x');
        const regPath = path.join(m.REGISTRIES_DIR, 'team-acme', 'skills', 'x');
        expect(m.registryNameForPath(basePath)).toBe('base');
        expect(m.registryNameForPath(regPath)).toBe('team-acme');
        expect(m.registryNameForPath('/somewhere/else')).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/registry-manifest.test.ts`
Expected: FAIL — `readRegistryManifest is not a function` (y `registryNameForPath`).

- [ ] **Step 3: Implement in `cli/src/core/registries.ts`**

Agregar al final del archivo:

```typescript
export const REGISTRY_MANIFEST_NAME = 'awm-registry.json';

export interface RegistryManifest {
    /** Nombres de artifacts que este registry puede sobreescribir de roots anteriores. */
    overrides: Set<string>;
}

export function readRegistryManifest(root: string): RegistryManifest {
    const file = path.join(root, REGISTRY_MANIFEST_NAME);
    if (!fs.existsSync(file)) return { overrides: new Set() };
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
        throw new Error(
            `Invalid registry manifest at ${file}: ${e instanceof Error ? e.message : String(e)}`
        );
    }
    const overrides = (raw as Record<string, unknown>)?.overrides ?? [];
    if (!Array.isArray(overrides) || overrides.some((n) => typeof n !== 'string')) {
        throw new Error(`Invalid registry manifest at ${file}: "overrides" must be an array of strings`);
    }
    for (const name of overrides as string[]) {
        if (!name || name === '.' || name.includes('..') || /[/\\]/.test(name)) {
            throw new Error(`Invalid registry manifest at ${file}: override name "${name}" (path traversal)`);
        }
    }
    return { overrides: new Set(overrides as string[]) };
}

/** Nombre del registry dueño de un path: 'base' para el content root base,
 *  el nombre del clone bajo REGISTRIES_DIR, o null si no pertenece a ninguno. */
export function registryNameForPath(p: string): string | null {
    const resolved = path.resolve(p);
    const base = path.resolve(BASE_CONTENT_DIR);
    if (resolved === base || resolved.startsWith(base + path.sep)) return 'base';
    const regsRoot = path.resolve(REGISTRIES_DIR) + path.sep;
    if (resolved.startsWith(regsRoot)) {
        const first = resolved.slice(regsRoot.length).split(path.sep)[0];
        return first || null;
    }
    return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx jest tests/core/registry-manifest.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/registries.ts cli/tests/core/registry-manifest.test.ts
git commit -m "feat(ws2): awm-registry.json manifest reader + registryNameForPath"
```

---

### Task 2: Resolución de overrides en `discovery.ts` (skills/workflows/agents)

**Files:**
- Modify: `cli/src/core/discovery.ts`
- Test: `cli/tests/core/discovery-overrides.test.ts` (nuevo)

Comportamiento: en cada punto de colisión, si el **root posterior** declara el nombre en su `awm-registry.json` → reemplaza la entrada y registra procedencia en `overrode` (path del artifact tapado); si no → `collisionError` actual. Manifest leído **una vez por root**, no por artifact. El mensaje de colisión se actualiza (la promesa "llega en WS-2" ya se cumplió).

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/tests/core/discovery-overrides.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

function writeSkill(root: string, name: string) {
    const dir = path.join(root, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n`);
}

function writeWorkflow(root: string, name: string) {
    fs.mkdirSync(path.join(root, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workflows', `${name}.md`), `---\ndescription: d\n---\n`);
}

function writeAgent(root: string, name: string) {
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, 'agents', `${name}.md`), `---\ndescription: d\n---\n`);
}

function writeManifest(root: string, overrides: string[]) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify({ overrides }));
}

describe('discovery override resolution', () => {
    let tmp: string;
    let rootA: string;
    let rootB: string;
    let rootC: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-disc-ovr-'));
        rootA = path.join(tmp, 'a');
        rootB = path.join(tmp, 'b');
        rootC = path.join(tmp, 'c');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function load() {
        return require('../../src/core/discovery');
    }

    it('declared override: later root wins and records provenance', () => {
        writeSkill(rootA, 'brainstorming');
        writeSkill(rootB, 'brainstorming');
        writeManifest(rootB, ['brainstorming']);
        const { discoverSkills } = load();
        const out = discoverSkills([rootA, rootB]);
        expect(out).toHaveLength(1);
        expect(out[0].path).toBe(path.join(rootB, 'skills', 'brainstorming'));
        expect(out[0].overrode).toBe(path.join(rootA, 'skills', 'brainstorming'));
    });

    it('undeclared collision still throws naming both sources', () => {
        writeSkill(rootA, 'dup');
        writeSkill(rootB, 'dup');
        const { discoverSkills } = load();
        expect(() => discoverSkills([rootA, rootB])).toThrow(/dup/);
        expect(() => discoverSkills([rootA, rootB])).toThrow(new RegExp(rootA.replace(/[/\\]/g, '.')));
    });

    it('orphan override (no collision) is not an error', () => {
        writeSkill(rootB, 'only-here');
        writeManifest(rootB, ['renamed-upstream-skill']);
        const { discoverSkills } = load();
        const out = discoverSkills([rootB]);
        expect(out).toHaveLength(1);
        expect(out[0].overrode).toBeUndefined();
    });

    it('chain: two registries both declaring the same name — last in order wins', () => {
        writeSkill(rootA, 'x');
        writeSkill(rootB, 'x');
        writeSkill(rootC, 'x');
        writeManifest(rootB, ['x']);
        writeManifest(rootC, ['x']);
        const { discoverSkills } = load();
        const out = discoverSkills([rootA, rootB, rootC]);
        expect(out).toHaveLength(1);
        expect(out[0].path).toBe(path.join(rootC, 'skills', 'x'));
        expect(out[0].overrode).toBe(path.join(rootB, 'skills', 'x'));
    });

    it('workflows: declared override wins, undeclared throws', () => {
        writeWorkflow(rootA, 'flow');
        writeWorkflow(rootB, 'flow');
        const { discoverWorkflows } = load();
        expect(() => discoverWorkflows([rootA, rootB])).toThrow(/flow/);
        writeManifest(rootB, ['flow']);
        jest.resetModules();
        const out = load().discoverWorkflows([rootA, rootB]);
        expect(out).toHaveLength(1);
        expect(out[0].path).toBe(path.join(rootB, 'workflows', 'flow.md'));
        expect(out[0].overrode).toBe(path.join(rootA, 'workflows', 'flow.md'));
    });

    it('agents: declared override wins, undeclared throws', () => {
        writeAgent(rootA, 'bot');
        writeAgent(rootB, 'bot');
        const { discoverAgents } = load();
        expect(() => discoverAgents([rootA, rootB])).toThrow(/bot/);
        writeManifest(rootB, ['bot']);
        jest.resetModules();
        const out = load().discoverAgents([rootA, rootB]);
        expect(out).toHaveLength(1);
        expect(out[0].path).toBe(path.join(rootB, 'agents', 'bot.md'));
        expect(out[0].overrode).toBe(path.join(rootA, 'agents', 'bot.md'));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/discovery-overrides.test.ts`
Expected: FAIL — los casos "declared override" tiran el collisionError actual; `overrode` undefined.

- [ ] **Step 3: Implement in `cli/src/core/discovery.ts`**

(a) Import del manifest (línea 5):

```typescript
import { contentRoots, readRegistryManifest } from './registries';
```

(b) Agregar `overrode?: string` a las 3 interfaces (mismo comentario en cada una):

```typescript
export interface SkillArtifact {
    name: string;
    path: string;
    description: string;
    /** Path del artifact de un root anterior que este tapó (override declarado en awm-registry.json). */
    overrode?: string;
}
```

(igual en `WorkflowArtifact` y `AgentArtifact`).

(c) Reemplazar `collisionError` y agregar el helper de merge:

```typescript
function collisionError(kind: string, name: string, first: string, second: string): Error {
    return new Error(
        `Artifact name collision: ${kind} "${name}" exists in both ${first} and ${second}. ` +
        `Remove or rename one of them, or declare "${name}" in "overrides" of the later registry's awm-registry.json.`
    );
}

interface DiscoveredEntry {
    name: string;
    path: string;
    description: string;
    overrode?: string;
}

/** Inserta o resuelve colisión: override declarado en el root posterior → reemplaza
 *  (conserva posición de inserción del Map); no declarado → error. */
function mergeEntry(
    kind: string,
    byName: Map<string, DiscoveredEntry>,
    entry: DiscoveredEntry,
    rootOverrides: Set<string>
): void {
    const prev = byName.get(entry.name);
    if (!prev) {
        byName.set(entry.name, entry);
        return;
    }
    if (rootOverrides.has(entry.name)) {
        byName.set(entry.name, { ...entry, overrode: prev.path });
        return;
    }
    throw collisionError(kind, entry.name, prev.path, entry.path);
}
```

(d) Reescribir los 3 discover* con el helper (cuerpo completo de `discoverSkills`; `discoverWorkflows` y `discoverAgents` son análogos con sus filtros de `.md` actuales):

```typescript
export function discoverSkills(roots: string[] = contentRoots()): SkillArtifact[] {
    const byName = new Map<string, DiscoveredEntry>();
    for (const root of roots) {
        const dir = path.join(root, 'skills');
        if (!fs.existsSync(dir)) continue;
        const overrides = readRegistryManifest(root).overrides;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const skillPath = path.join(dir, entry.name);
            if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) continue;
            mergeEntry('skill', byName, {
                name: entry.name,
                path: skillPath,
                description: readArtifactDescription(path.join(skillPath, 'SKILL.md')),
            }, overrides);
        }
    }
    return Array.from(byName.values());
}

export function discoverWorkflows(roots: string[] = contentRoots()): WorkflowArtifact[] {
    const byName = new Map<string, DiscoveredEntry>();
    for (const root of roots) {
        const dir = path.join(root, 'workflows');
        if (!fs.existsSync(dir)) continue;
        const overrides = readRegistryManifest(root).overrides;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
            const name = entry.name.replace('.md', '');
            const filePath = path.join(dir, entry.name);
            mergeEntry('workflow', byName, {
                name,
                path: filePath,
                description: readArtifactDescription(filePath),
            }, overrides);
        }
    }
    return Array.from(byName.values());
}

export function discoverAgents(roots: string[] = contentRoots()): AgentArtifact[] {
    const byName = new Map<string, DiscoveredEntry>();
    for (const root of roots) {
        const dir = path.join(root, 'agents');
        if (!fs.existsSync(dir)) continue;
        const overrides = readRegistryManifest(root).overrides;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
            const name = entry.name.replace('.md', '');
            const filePath = path.join(dir, entry.name);
            mergeEntry('agent', byName, {
                name,
                path: filePath,
                description: readArtifactDescription(filePath),
            }, overrides);
        }
    }
    return Array.from(byName.values());
}
```

Nota: `Map.set` sobre una key existente conserva la posición de inserción original — el orden de salida no cambia respecto de WS-1.

- [ ] **Step 4: Run tests to verify they pass (incluye regresión multiroot de WS-1)**

Run: `cd cli && npx jest tests/core/discovery-overrides.test.ts tests/core/discovery-multiroot.test.ts`
Expected: PASS ambos archivos.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/discovery.ts cli/tests/core/discovery-overrides.test.ts
git commit -m "feat(ws2): declared override resolution in skill/workflow/agent discovery"
```

---

### Task 3: Resolución de overrides en `bundles.ts` (`discoverAllBundles`)

**Files:**
- Modify: `cli/src/core/bundles.ts`
- Test: `cli/tests/core/bundles-overrides.test.ts` (nuevo)

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/tests/core/bundles-overrides.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

function writeBundleRoot(root: string, bundleName: string, skillName: string) {
    fs.mkdirSync(path.join(root, 'bundles', bundleName), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', skillName), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', skillName, 'SKILL.md'), `---\nname: ${skillName}\ndescription: d\n---\n`);
    fs.writeFileSync(
        path.join(root, 'bundles', bundleName, 'bundle.json'),
        JSON.stringify({ name: bundleName, version: '1.0.0', scope: 'ambient', skills: [skillName] })
    );
    fs.writeFileSync(
        path.join(root, 'catalog.json'),
        JSON.stringify({
            version: 1,
            bundles: [{ name: bundleName, source: `./bundles/${bundleName}`, version: '1.0.0', scope: 'ambient' }],
        })
    );
}

describe('bundle override resolution', () => {
    let tmp: string;
    let rootA: string;
    let rootB: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bnd-ovr-'));
        rootA = path.join(tmp, 'a');
        rootB = path.join(tmp, 'b');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('declared override: later root wins, contentRoot and overrode reflect it', () => {
        writeBundleRoot(rootA, 'pack', 's1');
        writeBundleRoot(rootB, 'pack', 's2');
        fs.writeFileSync(path.join(rootB, 'awm-registry.json'), JSON.stringify({ overrides: ['pack'] }));
        const { discoverAllBundles } = require('../../src/core/bundles');
        const out = discoverAllBundles([rootA, rootB]);
        expect(out).toHaveLength(1);
        expect(out[0].contentRoot).toBe(rootB);
        expect(out[0].overrode).toBe(rootA);
    });

    it('undeclared collision still throws naming both sources', () => {
        writeBundleRoot(rootA, 'dup', 's1');
        writeBundleRoot(rootB, 'dup', 's2');
        const { discoverAllBundles } = require('../../src/core/bundles');
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(/dup/);
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(new RegExp(rootA.replace(/[/\\]/g, '.')));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/bundles-overrides.test.ts`
Expected: FAIL — el caso declarado tira el error de colisión actual.

- [ ] **Step 3: Implement in `cli/src/core/bundles.ts`**

(a) Import (línea 5):

```typescript
import { contentRoots, readRegistryManifest } from './registries';
```

(b) Campo nuevo en `BundleDefinition` (debajo de `contentRoot`):

```typescript
    /** Content root del bundle de un root anterior que este tapó (override declarado, WS-2). */
    overrode?: string;
```

(c) Reescribir `discoverAllBundles`:

```typescript
/** Descubre bundles de TODOS los roots (base + registries adicionales).
 *  Colisión de nombre entre roots: override declarado en awm-registry.json
 *  del root posterior → reemplaza; no declarado → error nombrando ambas fuentes. */
export function discoverAllBundles(roots: string[] = contentRoots()): BundleDefinition[] {
    const byName = new Map<string, BundleDefinition>();
    for (const root of roots) {
        const overrides = readRegistryManifest(root).overrides;
        for (const b of discoverBundles(root)) {
            const prev = byName.get(b.name);
            if (!prev) {
                byName.set(b.name, b);
                continue;
            }
            if (overrides.has(b.name)) {
                byName.set(b.name, { ...b, overrode: prev.contentRoot });
                continue;
            }
            throw new Error(
                `Artifact name collision: bundle "${b.name}" exists in both ${prev.contentRoot} and ${root}. ` +
                `Remove or rename one of them, or declare "${b.name}" in "overrides" of the later registry's awm-registry.json.`
            );
        }
    }
    return Array.from(byName.values());
}
```

- [ ] **Step 4: Run tests to verify they pass (incluye regresión WS-1)**

Run: `cd cli && npx jest tests/core/bundles-overrides.test.ts tests/core/bundles-multiroot.test.ts`
Expected: PASS ambos archivos.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/bundles.ts cli/tests/core/bundles-overrides.test.ts
git commit -m "feat(ws2): declared override resolution in bundle discovery"
```

---

### Task 4: Marcadores de procedencia en `awm list` y estado de overrides en `awm registry list`

**Files:**
- Modify: `cli/src/utils/registry-view.ts:8-14` (ArtifactView), `:52-56` (passthrough), `:118-129` (packageDetailLines)
- Create: `cli/src/commands/registry/status.ts`
- Modify: `cli/src/commands/registry/index.ts:39-60` (list action)
- Test: `cli/tests/utils/registry-view-overrides.test.ts` (nuevo), `cli/tests/commands/registry/status.test.ts` (nuevo)

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/tests/utils/registry-view-overrides.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('registry-view override markers', () => {
    let tmpHome: string;
    const origHome = process.env.HOME;
    const origAwmHome = process.env.AWM_HOME;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-view-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        process.env.HOME = origHome;
        if (origAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = origAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('packageDetailLines marks an overridden skill with its registry name', () => {
        const { REGISTRIES_DIR } = require('../../src/core/registries');
        const { buildPackageView, packageDetailLines } = require('../../src/utils/registry-view');
        const teamSkillPath = path.join(REGISTRIES_DIR, 'team-acme', 'skills', 'brainstorming');
        const view = buildPackageView(
            [{ name: 'brainstorming', path: teamSkillPath, description: 'd', overrode: '/old/path' }],
            [], [], []
        );
        const lines = packageDetailLines(view[0]).join('\n');
        expect(lines).toContain('brainstorming');
        expect(lines).toContain('← team-acme (override)');
    });

    it('non-overridden artifacts carry no marker', () => {
        const { buildPackageView, packageDetailLines } = require('../../src/utils/registry-view');
        const view = buildPackageView(
            [{ name: 'plain', path: '/any/skills/plain', description: 'd' }],
            [], [], []
        );
        expect(packageDetailLines(view[0]).join('\n')).not.toContain('override');
    });
});
```

```typescript
// cli/tests/commands/registry/status.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

function writeSkill(root: string, name: string) {
    const dir = path.join(root, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n`);
}

describe('registry override status', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-'));
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('classifies declared overrides as active or without effect', () => {
        const base = path.join(tmp, 'base');
        const team = path.join(tmp, 'team');
        writeSkill(base, 'brainstorming');
        writeSkill(team, 'brainstorming');
        writeSkill(team, 'team-only');
        fs.writeFileSync(
            path.join(team, 'awm-registry.json'),
            JSON.stringify({ overrides: ['brainstorming', 'ghost-skill'] })
        );
        const { overrideStatus } = require('../../../src/commands/registry/status');
        const status = overrideStatus(team, [base]);
        expect(status).toEqual([
            { name: 'brainstorming', active: true },
            { name: 'ghost-skill', active: false },
        ]);
    });

    it('returns empty for a registry without manifest', () => {
        const team = path.join(tmp, 'team');
        writeSkill(team, 'x');
        const { overrideStatus } = require('../../../src/commands/registry/status');
        expect(overrideStatus(team, [])).toEqual([]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/utils/registry-view-overrides.test.ts tests/commands/registry/status.test.ts`
Expected: FAIL — sin marker en detail lines; `status.ts` no existe.

- [ ] **Step 3: Implement registry-view markers**

En `cli/src/utils/registry-view.ts`:

(a) Import nuevo (después de los imports actuales):

```typescript
import { registryNameForPath } from '../core/registries';
```

(b) `ArtifactView` gana el campo:

```typescript
export interface ArtifactView {
    name: string;
    type: ArtifactType;
    sourcePath: string;
    installName: string;
    description: string;
    /** Path del artifact tapado cuando este es un override declarado (WS-2). */
    overrode?: string;
}
```

(c) Passthrough en `buildPackageView` (las 3 líneas de mapeo, líneas 53-55):

```typescript
    const all: ArtifactView[] = [
        ...skills.map((s) => ({ name: s.name, type: 'skill' as ArtifactType, sourcePath: s.path, installName: s.name, description: s.description ?? '', overrode: s.overrode })),
        ...workflows.map((w) => ({ name: w.name, type: 'workflow' as ArtifactType, sourcePath: w.path, installName: `${w.name}.md`, description: w.description ?? '', overrode: w.overrode })),
        ...agents.map((a) => ({ name: a.name, type: 'agent' as ArtifactType, sourcePath: a.path, installName: `${a.name}.md`, description: a.description ?? '', overrode: a.overrode })),
    ];
```

(d) Marker en `packageDetailLines` (reemplaza el forEach, líneas 124-127):

```typescript
    pkg.artifacts.forEach((a) => {
        const mark = a.overrode
            ? pc.yellow(`  ← ${registryNameForPath(a.sourcePath) ?? 'unknown'} (override)`)
            : '';
        lines.push(`  ${TYPE_ICON[a.type]}${a.name}${mark}`);
        if (a.description) lines.push(`     ${a.description}`);
    });
```

- [ ] **Step 4: Implement `overrideStatus`**

```typescript
// cli/src/commands/registry/status.ts
// Estado de los overrides declarados por un registry: activo (tapa un artifact
// de un root anterior) o sin efecto (huérfano — el nombre ya no existe upstream).
import { readRegistryManifest } from '../../core/registries';
import { discoverSkills, discoverWorkflows, discoverAgents } from '../../core/discovery';
import { discoverAllBundles } from '../../core/bundles';

export interface OverrideStatus {
    name: string;
    active: boolean;
}

function artifactNamesInRoot(root: string): Set<string> {
    const names = new Set<string>();
    for (const s of discoverSkills([root])) names.add(s.name);
    for (const w of discoverWorkflows([root])) names.add(w.name);
    for (const a of discoverAgents([root])) names.add(a.name);
    for (const b of discoverAllBundles([root])) names.add(b.name);
    return names;
}

export function overrideStatus(contentRoot: string, earlierRoots: string[]): OverrideStatus[] {
    const declared = Array.from(readRegistryManifest(contentRoot).overrides);
    if (declared.length === 0) return [];
    const earlier = new Set<string>();
    for (const root of earlierRoots) {
        for (const n of artifactNamesInRoot(root)) earlier.add(n);
    }
    return declared.map((name) => ({ name, active: earlier.has(name) }));
}
```

- [ ] **Step 5: Wire `awm registry list`**

En `cli/src/commands/registry/index.ts`: ampliar los imports del tope del archivo —

```typescript
import { listRegistries, contentRoots, BASE_CONTENT_DIR } from '../../core/registries';
import { overrideStatus } from './status';
```

— y en la list action, reemplazar el bloque `for (const r of regs)` (líneas 47-59) por:

```typescript
            const earlier: string[] = fs.existsSync(BASE_CONTENT_DIR) ? [BASE_CONTENT_DIR] : [];
            for (const r of regs) {
                if (!fs.existsSync(r.contentRoot)) {
                    console.log(`${pc.cyan(r.name)}  ${r.remote}  ${pc.yellow("missing on disk — run 'awm update'")}`);
                    continue;
                }
                const counts = [
                    `${discoverSkills([r.contentRoot]).length} skills`,
                    `${discoverAllBundles([r.contentRoot]).length} bundles`,
                    `${discoverWorkflows([r.contentRoot]).length} workflows`,
                    `${discoverAgents([r.contentRoot]).length} agents`,
                ].join(', ');
                console.log(`${pc.cyan(r.name)}  ${r.remote}  ${pc.dim(counts)}`);
                for (const o of overrideStatus(r.contentRoot, earlier)) {
                    console.log(
                        o.active
                            ? pc.yellow(`    ↑ override activo: ${o.name}`)
                            : pc.dim(`    ∅ override sin efecto: ${o.name}`)
                    );
                }
                earlier.push(r.contentRoot);
            }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd cli && npx jest tests/utils/registry-view-overrides.test.ts tests/commands/registry/status.test.ts && npx tsc --noEmit -p .`
Expected: PASS + typecheck limpio.

- [ ] **Step 7: Commit**

```bash
git add cli/src/utils/registry-view.ts cli/src/commands/registry/status.ts cli/src/commands/registry/index.ts cli/tests/utils/registry-view-overrides.test.ts cli/tests/commands/registry/status.test.ts
git commit -m "feat(ws2): override provenance in awm list + override status in awm registry list"
```

---

### Task 5: Remote base configurable (`resolveBaseRemote` + cableado + `install.sh`)

**Files:**
- Modify: `cli/src/utils/config.ts:7-11` (campo opcional `baseRemote`)
- Modify: `cli/src/core/registry.ts` (nueva función)
- Modify: `cli/src/index.ts:72,333,422,465` (los 4 call-sites de `syncRegistry()`)
- Modify: `install.sh:66`
- Test: `cli/tests/core/base-remote.test.ts` (nuevo)

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/tests/core/base-remote.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('resolveBaseRemote', () => {
    let tmpHome: string;
    const origHome = process.env.HOME;
    const origAwmHome = process.env.AWM_HOME;
    const origEnvRemote = process.env.AWM_BASE_REMOTE;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-remote-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        delete process.env.AWM_BASE_REMOTE;
        jest.resetModules();
    });

    afterEach(() => {
        process.env.HOME = origHome;
        if (origAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = origAwmHome;
        if (origEnvRemote === undefined) delete process.env.AWM_BASE_REMOTE;
        else process.env.AWM_BASE_REMOTE = origEnvRemote;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('falls back to DEFAULT_REMOTE when no env and no prefs', () => {
        const { resolveBaseRemote, DEFAULT_REMOTE } = require('../../src/core/registry');
        expect(resolveBaseRemote()).toBe(DEFAULT_REMOTE);
    });

    it('prefers preferences.json baseRemote over the default', () => {
        const awmDir = path.join(tmpHome, '.awm');
        fs.mkdirSync(awmDir, { recursive: true });
        fs.writeFileSync(
            path.join(awmDir, 'preferences.json'),
            JSON.stringify({ defaultAgent: 'claude-code', installMethod: 'symlink', defaultScope: 'local', baseRemote: 'git@team:content.git' })
        );
        const { resolveBaseRemote } = require('../../src/core/registry');
        expect(resolveBaseRemote()).toBe('git@team:content.git');
    });

    it('env AWM_BASE_REMOTE wins over prefs and default', () => {
        const awmDir = path.join(tmpHome, '.awm');
        fs.mkdirSync(awmDir, { recursive: true });
        fs.writeFileSync(
            path.join(awmDir, 'preferences.json'),
            JSON.stringify({ defaultAgent: 'claude-code', installMethod: 'symlink', defaultScope: 'local', baseRemote: 'git@team:content.git' })
        );
        process.env.AWM_BASE_REMOTE = 'git@env:wins.git';
        jest.resetModules();
        const { resolveBaseRemote } = require('../../src/core/registry');
        expect(resolveBaseRemote()).toBe('git@env:wins.git');
    });

    it('resolveBaseRemoteInfo reports where the remote came from', () => {
        const { resolveBaseRemoteInfo, DEFAULT_REMOTE } = require('../../src/core/registry');
        expect(resolveBaseRemoteInfo()).toEqual({ remote: DEFAULT_REMOTE, source: 'default' });
        process.env.AWM_BASE_REMOTE = 'git@env:x.git';
        jest.resetModules();
        const m = require('../../src/core/registry');
        expect(m.resolveBaseRemoteInfo()).toEqual({ remote: 'git@env:x.git', source: 'env' });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/base-remote.test.ts`
Expected: FAIL — `resolveBaseRemote is not a function`.

- [ ] **Step 3: Implement**

(a) `cli/src/utils/config.ts` — campo opcional en la interfaz (DEFAULT_PREFS no cambia):

```typescript
export interface AwmPreferences {
    defaultAgent: AgentTarget;
    installMethod: 'symlink' | 'copy';
    defaultScope: 'global' | 'local';
    /** Remote del registry base (override de DEFAULT_REMOTE). Opcional — WS-2. */
    baseRemote?: string;
}
```

(b) `cli/src/core/registry.ts` — debajo de `DEFAULT_REMOTE`:

```typescript
import { getPreferences } from '../utils/config';

export type BaseRemoteSource = 'env' | 'prefs' | 'default';

/** Remote efectivo del registry base y su origen: env AWM_BASE_REMOTE > preferences.baseRemote > DEFAULT_REMOTE. */
export function resolveBaseRemoteInfo(): { remote: string; source: BaseRemoteSource } {
    if (process.env.AWM_BASE_REMOTE) return { remote: process.env.AWM_BASE_REMOTE, source: 'env' };
    try {
        const prefs = getPreferences();
        if (prefs.baseRemote) return { remote: prefs.baseRemote, source: 'prefs' };
    } catch {
        // preferencias ilegibles no deben bloquear un update — cae al default
    }
    return { remote: DEFAULT_REMOTE, source: 'default' };
}

export function resolveBaseRemote(): string {
    return resolveBaseRemoteInfo().remote;
}
```

(c) `cli/src/index.ts` — en los 4 call-sites (líneas 72, 333, 422, 465) cambiar:

```typescript
          await syncRegistry();
```

por:

```typescript
          await syncRegistry(resolveBaseRemote());
```

y ampliar el import de la línea 10:

```typescript
import { syncRegistry, buildCli, REGISTRY_DIR, resolveBaseRemote, resolveBaseRemoteInfo } from './core/registry';
```

(d) Contexto de remote en la falla de `awm update` (spec Sección 5: el mensaje incluye qué remote se usó y de dónde salió). En el catch del comando `update` (`cli/src/index.ts:393-397`), cambiar:

```typescript
      } catch (e: any) {
          s.stop('Update failed.');
          console.error(pc.red(e.message));
          process.exit(1);
      }
```

por:

```typescript
      } catch (e: any) {
          const { remote, source } = resolveBaseRemoteInfo();
          s.stop('Update failed.');
          console.error(pc.red(`${e.message}\n  (base remote: ${remote} — from ${source})`));
          process.exit(1);
      }
```

(e) `install.sh:66`:

```bash
REPO_URL="${AWM_REPO_URL:-https://github.com/Kodria/agentic-workflow.git}"
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd cli && npx jest tests/core/base-remote.test.ts && npx tsc --noEmit -p . && bash -n ../install.sh`
Expected: PASS, typecheck limpio, sintaxis de install.sh válida.

- [ ] **Step 5: Commit**

```bash
git add cli/src/utils/config.ts cli/src/core/registry.ts cli/src/index.ts install.sh cli/tests/core/base-remote.test.ts
git commit -m "feat(ws2): configurable base remote (env > prefs > default) + install.sh env override"
```

---

### Task 6: `awm registry add` ofrece instalar bundles del registry nuevo

**Files:**
- Create: `cli/src/commands/registry/install-bundles.ts`
- Modify: `cli/src/commands/registry/index.ts:17-37` (add action: flags + flujo post-add)
- Test: `cli/tests/commands/registry/install-bundles.test.ts` (nuevo)

Comportamiento (spec Sección 4): tras add exitoso, descubrir bundles del registry nuevo y ofrecer instalarlos. `--install-all` instala todos con el agente default; `--no-install` u operación sin TTY → no instala e imprime el comando sugerido. La falla del install NO revierte el add (se reporta como warning, exit 0).

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/tests/commands/registry/install-bundles.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

function writeBundleRoot(root: string, bundleName: string, skillName: string) {
    fs.mkdirSync(path.join(root, 'bundles', bundleName), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', skillName), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', skillName, 'SKILL.md'), `---\nname: ${skillName}\ndescription: d\n---\n`);
    fs.writeFileSync(
        path.join(root, 'bundles', bundleName, 'bundle.json'),
        JSON.stringify({ name: bundleName, version: '1.0.0', scope: 'ambient', skills: [skillName] })
    );
    fs.writeFileSync(
        path.join(root, 'catalog.json'),
        JSON.stringify({
            version: 1,
            bundles: [{ name: bundleName, source: `./bundles/${bundleName}`, version: '1.0.0', scope: 'ambient' }],
        })
    );
}

describe('installBundlesFromRegistry', () => {
    let tmpHome: string;
    let tmpWork: string;
    const origHome = process.env.HOME;
    const origAwmHome = process.env.AWM_HOME;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-work-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        process.env.HOME = origHome;
        if (origAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = origAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
    });

    it('installs all ambient bundles of the given registry root for the agent', () => {
        const { REGISTRIES_DIR } = require('../../../src/core/registries');
        const regRoot = path.join(REGISTRIES_DIR, 'team');
        writeBundleRoot(regRoot, 'team-pack', 'team-skill');
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm', 'registries.json'),
            JSON.stringify([{ name: 'team', remote: 'r' }])
        );

        const { installBundlesFromRegistry } = require('../../../src/commands/registry/install-bundles');
        const results = installBundlesFromRegistry(regRoot, 'all', ['claude-code'], tmpWork);

        expect(results).toHaveLength(1);
        expect(results[0].bundle).toBe('team-pack');
        expect(results[0].installed.length).toBeGreaterThan(0);
        // ambient → global → symlink bajo el HOME aislado
        expect(fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'team-skill'))).toBe(true);
    });

    it('returns empty when the registry has no bundles', () => {
        const { REGISTRIES_DIR } = require('../../../src/core/registries');
        const regRoot = path.join(REGISTRIES_DIR, 'empty');
        fs.mkdirSync(path.join(regRoot, 'skills', 's'), { recursive: true });
        fs.writeFileSync(path.join(regRoot, 'skills', 's', 'SKILL.md'), `---\nname: s\ndescription: d\n---\n`);
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm', 'registries.json'),
            JSON.stringify([{ name: 'empty', remote: 'r' }])
        );

        const { installBundlesFromRegistry } = require('../../../src/commands/registry/install-bundles');
        expect(installBundlesFromRegistry(regRoot, 'all', ['claude-code'], tmpWork)).toEqual([]);
    });

    it('installs only the named bundles when a list is given', () => {
        const { REGISTRIES_DIR } = require('../../../src/core/registries');
        const regRoot = path.join(REGISTRIES_DIR, 'team');
        writeBundleRoot(regRoot, 'wanted', 'skill-w');
        // segundo bundle en el mismo catálogo
        fs.mkdirSync(path.join(regRoot, 'bundles', 'unwanted'), { recursive: true });
        fs.mkdirSync(path.join(regRoot, 'skills', 'skill-u'), { recursive: true });
        fs.writeFileSync(path.join(regRoot, 'skills', 'skill-u', 'SKILL.md'), `---\nname: skill-u\ndescription: d\n---\n`);
        fs.writeFileSync(
            path.join(regRoot, 'bundles', 'unwanted', 'bundle.json'),
            JSON.stringify({ name: 'unwanted', version: '1.0.0', scope: 'ambient', skills: ['skill-u'] })
        );
        fs.writeFileSync(
            path.join(regRoot, 'catalog.json'),
            JSON.stringify({
                version: 1,
                bundles: [
                    { name: 'wanted', source: './bundles/wanted', version: '1.0.0', scope: 'ambient' },
                    { name: 'unwanted', source: './bundles/unwanted', version: '1.0.0', scope: 'ambient' },
                ],
            })
        );
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm', 'registries.json'),
            JSON.stringify([{ name: 'team', remote: 'r' }])
        );

        const { installBundlesFromRegistry } = require('../../../src/commands/registry/install-bundles');
        const results = installBundlesFromRegistry(regRoot, ['wanted'], ['claude-code'], tmpWork);
        expect(results.map((r: { bundle: string }) => r.bundle)).toEqual(['wanted']);
        expect(fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'skill-u'))).toBe(false);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/commands/registry/install-bundles.test.ts`
Expected: FAIL — `install-bundles` no existe.

- [ ] **Step 3: Implement `installBundlesFromRegistry`**

```typescript
// cli/src/commands/registry/install-bundles.ts
// Instalación de bundles de un registry recién agregado (flujo post-add).
// Separado del wiring de commander para ser testeable sin prompts.
import { discoverAllBundles } from '../../core/bundles';
import { addBundle } from '../../core/bundle-install';
import { AgentTarget } from '../../providers';

export interface RegistryBundleInstallResult {
    bundle: string;
    installed: string[];
    skipped: string[];
}

/** Bundles disponibles en un content root concreto (candidatos a instalar tras el add). */
export function bundlesInRegistry(contentRoot: string): string[] {
    return discoverAllBundles()
        .filter((b) => b.contentRoot === contentRoot)
        .map((b) => b.name);
}

/**
 * Instala bundles del registry `contentRoot` para los agentes dados.
 * `selection` = 'all' instala todos los del registry; una lista instala solo esos.
 * Las dependencias se resuelven contra TODOS los roots (pueden vivir en el base).
 */
export function installBundlesFromRegistry(
    contentRoot: string,
    selection: string[] | 'all',
    agents: AgentTarget[],
    projectRoot: string
): RegistryBundleInstallResult[] {
    const allBundles = discoverAllBundles();
    const candidates = allBundles.filter((b) => b.contentRoot === contentRoot);
    const wanted =
        selection === 'all' ? candidates : candidates.filter((b) => selection.includes(b.name));

    const results: RegistryBundleInstallResult[] = [];
    for (const b of wanted) {
        const summary = addBundle({
            bundleName: b.name,
            bundles: allBundles,
            agents,
            method: 'symlink',
            projectRoot,
        });
        results.push({ bundle: b.name, installed: summary.installed, skipped: summary.skipped });
    }
    return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx jest tests/commands/registry/install-bundles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the add action (flags + flujo post-add)**

En `cli/src/commands/registry/index.ts`, reemplazar el comando `add` (líneas 17-37) por:

```typescript
    reg.command('add <remote>')
        .description('clone an additional registry (git URL or local path) and register it')
        .option('--name <name>', 'registry name (default: repo basename)')
        .option('--install-all', 'install every bundle from the new registry for the default agent')
        .option('--no-install', 'skip the bundle install offer')
        .action(async (remote: string, options: { name?: string; installAll?: boolean; install?: boolean }) => {
            intro(pc.bgCyan(pc.black(' AWM - Add Registry ')));
            const s = spinner();
            s.start('Cloning and validating registry...');
            const result = await addRegistry(remote, options.name);
            if (!result.ok) {
                s.stop('Failed.');
                console.error(pc.red(result.error));
                process.exit(1);
            }
            s.stop(`Registry ${pc.cyan(result.name)} added at ${result.contentRoot}`);
            try {
                regenerateGlobalContext();
            } catch {
                // context regeneration must not abort a successful add
            }

            // Oferta de instalación de bundles — su falla NUNCA revierte el add.
            try {
                const available = bundlesInRegistry(result.contentRoot);
                if (available.length > 0) {
                    const prefs = getPreferences();
                    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
                    const interactive = process.stdout.isTTY && process.stdin.isTTY;

                    let selection: string[] | 'all' | null = null;
                    let agents: AgentTarget[] = [prefs.defaultAgent];

                    if (options.install === false) {
                        selection = null;
                    } else if (options.installAll) {
                        selection = 'all';
                    } else if (interactive) {
                        const picked = await multiselect({
                            message: `Install bundles from ${result.name}?`,
                            options: available.map((b) => ({ value: b, label: b })),
                            required: false,
                        });
                        if (!isCancel(picked) && (picked as string[]).length > 0) {
                            selection = picked as string[];
                            const agentPick = await select({
                                message: 'Target agent',
                                initialValue: prefs.defaultAgent,
                                options: Object.keys(PROVIDERS).map((a) => ({ value: a, label: a })),
                            });
                            if (!isCancel(agentPick)) agents = [agentPick as AgentTarget];
                            else selection = null;
                        }
                    }

                    if (selection) {
                        for (const r of installBundlesFromRegistry(result.contentRoot, selection, agents, projectRoot)) {
                            for (const line of r.installed) console.log(pc.green(`  ✓ ${line}`));
                            for (const sk of r.skipped) console.log(pc.yellow(`  ⚠  Skipped: ${sk}`));
                        }
                    } else if (options.install !== false && !interactive) {
                        console.log(pc.dim(`  Bundles available: ${available.join(', ')}`));
                        console.log(pc.dim(`  Install with: awm add <bundle> --agent <agent>`));
                    }
                }
            } catch (e) {
                console.warn(pc.yellow(`  ⚠  Bundle install failed (registry add is intact): ${e instanceof Error ? e.message : String(e)}`));
            }

            outro(`✅ Run ${pc.cyan('awm list')} to see the new content.`);
        });
```

Imports nuevos al tope del archivo:

```typescript
import { multiselect, select } from '@clack/prompts';
import { getPreferences } from '../../utils/config';
import { findProjectRoot } from '../../core/profile';
import { AgentTarget, PROVIDERS } from '../../providers';
import { bundlesInRegistry, installBundlesFromRegistry } from './install-bundles';
```

(consolidar con el import existente de `@clack/prompts` — queda `intro, outro, confirm, isCancel, spinner, multiselect, select`). `findProjectRoot` se exporta desde `cli/src/core/profile.ts:17` — el import de arriba es exacto.

- [ ] **Step 6: Run full registry command tests + typecheck**

Run: `cd cli && npx jest tests/commands/registry/ && npx tsc --noEmit -p .`
Expected: PASS todos (add/remove/status/install-bundles), typecheck limpio.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/registry/install-bundles.ts cli/src/commands/registry/index.ts cli/tests/commands/registry/install-bundles.test.ts
git commit -m "feat(ws2): bundle install offer after awm registry add (--install-all / --no-install)"
```

---

### Task 7: Cierre — roadmap, suite completa y sensores

**Files:**
- Modify: `docs/plans/2026-06-09-distribution-roadmap.md:65` (checkbox WS-2 "Plan + ejecución")

- [ ] **Step 1: Marcar el checkbox del roadmap**

En `docs/plans/2026-06-09-distribution-roadmap.md`, cambiar:

```markdown
- [ ] Plan + ejecución
```

por:

```markdown
- [x] Plan + ejecución → [2026-06-09-ws2-multi-registry-plan.md](2026-06-09-ws2-multi-registry-plan.md)
```

- [ ] **Step 2: Run the full suite**

Run: `cd cli && npm test`
Expected: PASS — los 518 tests previos + los nuevos de WS-2, 0 failures.

- [ ] **Step 3: Run sensors**

Run: `cd cli && npx awm sensors run` (o `awm sensors run` desde la raíz del repo si `.awm/sensors.json` está ahí)
Expected: overall pass, `newCount: 0`.

- [ ] **Step 4: Commit**

```bash
git add docs/plans/2026-06-09-distribution-roadmap.md
git commit -m "docs(ws2): roadmap status — plan + ejecución complete"
```

---

## Verificación final (criterio del roadmap)

Manual, post-merge, en la máquina real (NUNCA tocando `~/.awm` a mano — solo comandos):

1. Crear un repo de contenido de prueba con `awm-registry.json` declarando override de una skill del base.
2. `awm registry add <path-o-url>` → aceptar la oferta de install.
3. `awm list` muestra `<skill> ← <registry> (override)`; el symlink instalado apunta al clone del registry de prueba.
4. `awm registry list` muestra el override activo.
5. `AWM_BASE_REMOTE=<fork> awm update` usa el fork (verificable con un path local de fixture).
