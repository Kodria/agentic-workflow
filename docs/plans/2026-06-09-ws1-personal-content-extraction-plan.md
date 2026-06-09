# WS-1 — Registries adicionales + extracción del contenido personal: Implementation Plan
<!-- awm-qa-complete: 2026-06-09 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introducir el mecanismo de registries adicionales (`awm registry add/list/remove` + merge multi-root en discovery) y extraer el contenido personal (`personal-notion` + 3 skills) hacia `Kodria/awm-personal-registry`.

**Architecture:** Módulo core nuevo `registries.ts` dueño de `~/.awm/registries.json` y del seam `contentRoots()`. `discovery.ts`/`bundles.ts` iteran roots y fallan ruidoso ante colisión de nombres. `skill-integrity.ts` busca skills en todos los roots. Comandos en `cli/src/commands/registry/` con lógica separada del wiring (patrón `hooks/resync.ts`). Spec: [2026-06-09-ws1-personal-content-extraction-design.md](2026-06-09-ws1-personal-content-extraction-design.md).

**Tech Stack:** TypeScript, Commander, simple-git, @clack/prompts, Jest. Tests desde `cli/` con `npm test`.

**INVARIANTE DE SEGURIDAD (no negociable):** ningún test toca el `~/.awm` ni el `~/.claude` reales. Todo test usa tmpdirs con `process.env.HOME` y `process.env.AWM_HOME` sobreescritos en `beforeEach`/`afterEach` + `jest.resetModules()` + `require()` tardío (patrón de `cli/tests/commands/hooks/resync.test.ts:34-51`). Los repos git de fixture se crean con `git init` local en tmpdir — sin red.

---

### Task 1: `cli/src/core/registries.ts` — config, paths y seam `contentRoots()`

**Files:**
- Create: `cli/src/core/registries.ts`
- Test: `cli/tests/core/registries.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/tests/core/registries.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('core/registries', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-registries-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    function load() {
        return require('../../src/core/registries');
    }

    it('readRegistriesConfig returns [] when the config file does not exist', () => {
        expect(load().readRegistriesConfig()).toEqual([]);
    });

    it('write + read round-trips entries', () => {
        const m = load();
        m.writeRegistriesConfig([{ name: 'personal', remote: 'git@github.com:x/y.git' }]);
        expect(m.readRegistriesConfig()).toEqual([{ name: 'personal', remote: 'git@github.com:x/y.git' }]);
    });

    it('readRegistriesConfig throws an explicit error naming the path on corrupt JSON', () => {
        const m = load();
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.awm', 'registries.json'), '{not json');
        expect(() => m.readRegistriesConfig()).toThrow(/registries\.json/);
    });

    it('readRegistriesConfig throws on non-array or malformed entries', () => {
        const m = load();
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.awm', 'registries.json'), JSON.stringify({ foo: 1 }));
        expect(() => m.readRegistriesConfig()).toThrow(/expected a JSON array/);
        fs.writeFileSync(path.join(tmpHome, '.awm', 'registries.json'), JSON.stringify([{ name: 'x' }]));
        expect(() => m.readRegistriesConfig()).toThrow(/malformed entry/);
    });

    it('listRegistries derives contentRoot under ~/.awm/registries/<name>', () => {
        const m = load();
        m.writeRegistriesConfig([{ name: 'personal', remote: 'r' }]);
        expect(m.listRegistries()).toEqual([
            { name: 'personal', remote: 'r', contentRoot: path.join(tmpHome, '.awm', 'registries', 'personal') },
        ]);
    });

    it('contentRoots prepends the base content dir and filters registries missing on disk', () => {
        const m = load();
        // base existe
        const base = path.join(tmpHome, '.awm', 'cli-source', 'registry');
        fs.mkdirSync(base, { recursive: true });
        // 'present' existe en disco, 'ghost' no
        const present = path.join(tmpHome, '.awm', 'registries', 'present');
        fs.mkdirSync(present, { recursive: true });
        m.writeRegistriesConfig([{ name: 'present', remote: 'r1' }, { name: 'ghost', remote: 'r2' }]);
        expect(m.contentRoots()).toEqual([base, present]);
    });

    it('contentRoots omits the base dir itself when absent (clean machine)', () => {
        const m = load();
        expect(m.contentRoots()).toEqual([]);
    });

    it('validateRegistryLayout requires at least one content dir at the root', () => {
        const m = load();
        const root = path.join(tmpHome, 'somerepo');
        fs.mkdirSync(root, { recursive: true });
        expect(m.validateRegistryLayout(root)).toBe(false);
        fs.mkdirSync(path.join(root, 'skills'));
        expect(m.validateRegistryLayout(root)).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/registries.test.ts`
Expected: FAIL with "Cannot find module '../../src/core/registries'"

- [ ] **Step 3: Write the implementation**

```typescript
// cli/src/core/registries.ts
// WS-1: registries de contenido adicionales (~/.awm/registries.json).
// Seam único: contentRoots() — WS-2 enriquecerá esta función (precedencia,
// namespacing) sin tocar a los consumidores.
import fs from 'fs';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';
import { REGISTRY_DIR } from './registry';

const AWM_HOME = process.env.AWM_HOME || path.join(process.env.HOME || os.homedir(), '.awm');

/** Content root del registry base. Mismo valor que REGISTRY_CONTENT_DIR (bundles.ts);
 *  duplicado aquí para evitar el ciclo de imports bundles → registries → bundles. */
export const BASE_CONTENT_DIR = path.join(REGISTRY_DIR, 'registry');
export const REGISTRIES_DIR = path.join(AWM_HOME, 'registries');
export const REGISTRIES_CONFIG_PATH = path.join(AWM_HOME, 'registries.json');

export const CONTENT_DIR_NAMES = ['skills', 'bundles', 'workflows', 'agents'] as const;

export interface RegistryEntry {
    name: string;
    remote: string;
}

export interface RegistrySource extends RegistryEntry {
    contentRoot: string;
}

export function registryContentRoot(name: string): string {
    return path.join(REGISTRIES_DIR, name);
}

export function readRegistriesConfig(): RegistryEntry[] {
    if (!fs.existsSync(REGISTRIES_CONFIG_PATH)) return [];
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(REGISTRIES_CONFIG_PATH, 'utf-8'));
    } catch (e) {
        throw new Error(
            `Invalid registries config at ${REGISTRIES_CONFIG_PATH}: ${e instanceof Error ? e.message : String(e)}`
        );
    }
    if (!Array.isArray(raw)) {
        throw new Error(`Invalid registries config at ${REGISTRIES_CONFIG_PATH}: expected a JSON array`);
    }
    for (const entry of raw) {
        if (typeof entry?.name !== 'string' || typeof entry?.remote !== 'string') {
            throw new Error(
                `Invalid registries config at ${REGISTRIES_CONFIG_PATH}: malformed entry ${JSON.stringify(entry)}`
            );
        }
    }
    return raw as RegistryEntry[];
}

export function writeRegistriesConfig(entries: RegistryEntry[]): void {
    fs.mkdirSync(AWM_HOME, { recursive: true });
    fs.writeFileSync(REGISTRIES_CONFIG_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
}

export function listRegistries(): RegistrySource[] {
    return readRegistriesConfig().map((e) => ({ ...e, contentRoot: registryContentRoot(e.name) }));
}

/** Roots de contenido en orden: base primero, luego adicionales presentes en disco.
 *  Un registry configurado pero ausente se omite (awm update lo re-clona). */
export function contentRoots(): string[] {
    const roots: string[] = [];
    if (fs.existsSync(BASE_CONTENT_DIR)) roots.push(BASE_CONTENT_DIR);
    for (const reg of listRegistries()) {
        if (fs.existsSync(reg.contentRoot)) roots.push(reg.contentRoot);
    }
    return roots;
}

/** Un registry válido tiene ≥1 dir de contenido en su raíz. */
export function validateRegistryLayout(root: string): boolean {
    return CONTENT_DIR_NAMES.some((d) => fs.existsSync(path.join(root, d)));
}

export type RegistrySyncResult =
    | { name: string; action: 'pulled' | 'recloned' }
    | { name: string; action: 'error'; error: string };

/** Pull (reset --hard) de cada registry adicional; re-clona si falta el dir.
 *  Errores por-registry NO fatales: se reportan en el resultado. */
export async function syncAdditionalRegistries(): Promise<RegistrySyncResult[]> {
    const results: RegistrySyncResult[] = [];
    for (const reg of listRegistries()) {
        try {
            if (!fs.existsSync(reg.contentRoot)) {
                fs.mkdirSync(REGISTRIES_DIR, { recursive: true });
                await simpleGit().clone(reg.remote, reg.contentRoot);
                results.push({ name: reg.name, action: 'recloned' });
            } else {
                const git = simpleGit(reg.contentRoot);
                await git.reset(['--hard']);
                await git.pull();
                results.push({ name: reg.name, action: 'pulled' });
            }
        } catch (e) {
            results.push({ name: reg.name, action: 'error', error: e instanceof Error ? e.message : String(e) });
        }
    }
    return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx jest tests/core/registries.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/registries.ts cli/tests/core/registries.test.ts
git commit -m "feat(registries): core module — config CRUD + contentRoots seam (WS-1)"
```

---

### Task 2: `syncAdditionalRegistries` — tests con fixtures git locales

**Files:**
- Test: `cli/tests/core/registries-sync.test.ts`

(La implementación ya quedó en Task 1; esta task la cubre con git real local. Separada porque los fixtures git son más lentos que los unit tests puros.)

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/tests/core/registries-sync.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t ${cmd}`, { cwd, stdio: 'pipe' });

/** Crea un repo git fuente con una skill, retorna su path (sirve de remote local). */
function makeSourceRepo(base: string, skillName: string): string {
    const dir = path.join(base, `src-${skillName}`);
    fs.mkdirSync(path.join(dir, 'skills', skillName), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'skills', skillName, 'SKILL.md'),
        `---\nname: ${skillName}\ndescription: test skill\n---\n# ${skillName}\n`
    );
    GIT(dir, 'init -q');
    GIT(dir, 'add -A');
    GIT(dir, 'commit -qm init');
    return dir;
}

describe('syncAdditionalRegistries (git fixtures locales)', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regsync-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regsync-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it('re-clones a configured registry missing on disk', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        m.writeRegistriesConfig([{ name: 'personal', remote: source }]);

        const results = await m.syncAdditionalRegistries();

        expect(results).toEqual([{ name: 'personal', action: 'recloned' }]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'))).toBe(true);
    });

    it('pulls an existing clone and reports non-fatal errors per registry', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        m.writeRegistriesConfig([
            { name: 'personal', remote: source },
            { name: 'broken', remote: path.join(tmpWork, 'does-not-exist') },
        ]);
        await m.syncAdditionalRegistries(); // primer pase: clona 'personal', falla 'broken'

        // el remote avanza
        fs.writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: v2\n---\n');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm v2');

        const results = await m.syncAdditionalRegistries();

        expect(results[0]).toEqual({ name: 'personal', action: 'pulled' });
        expect(results[1].name).toBe('broken');
        expect(results[1].action).toBe('error');
        const synced = fs.readFileSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'), 'utf-8');
        expect(synced).toContain('v2');
    });
});
```

- [ ] **Step 2: Run tests**

Run: `cd cli && npx jest tests/core/registries-sync.test.ts`
Expected: PASS (la implementación de Task 1 ya cubre ambos casos; si algo falla, arreglar `syncAdditionalRegistries` hasta verde)

- [ ] **Step 3: Commit**

```bash
git add cli/tests/core/registries-sync.test.ts
git commit -m "test(registries): syncAdditionalRegistries con fixtures git locales (WS-1)"
```

---

### Task 3: discovery multi-root con colisión ruidosa

**Files:**
- Modify: `cli/src/core/discovery.ts`
- Test: `cli/tests/core/discovery-multiroot.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/tests/core/discovery-multiroot.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

function writeSkill(root: string, name: string) {
    const dir = path.join(root, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d-${name}\n---\n`);
}

function writeWorkflow(root: string, name: string) {
    const dir = path.join(root, 'workflows');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.md`), `---\nname: ${name}\ndescription: w-${name}\n---\n`);
}

describe('discovery multi-root', () => {
    let tmp: string;
    let rootA: string;
    let rootB: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-disc-'));
        rootA = path.join(tmp, 'a');
        rootB = path.join(tmp, 'b');
        fs.mkdirSync(rootA, { recursive: true });
        fs.mkdirSync(rootB, { recursive: true });
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('merges skills from multiple roots, each keeping its absolute path', () => {
        writeSkill(rootA, 'alpha');
        writeSkill(rootB, 'beta');
        const { discoverSkills } = require('../../src/core/discovery');
        const skills = discoverSkills([rootA, rootB]);
        expect(skills.map((s: { name: string }) => s.name).sort()).toEqual(['alpha', 'beta']);
        expect(skills.find((s: { name: string }) => s.name === 'beta').path).toBe(path.join(rootB, 'skills', 'beta'));
    });

    it('throws an explicit error naming BOTH sources on skill name collision', () => {
        writeSkill(rootA, 'dup');
        writeSkill(rootB, 'dup');
        const { discoverSkills } = require('../../src/core/discovery');
        expect(() => discoverSkills([rootA, rootB])).toThrow(
            new RegExp(`dup.*${path.join(rootA, 'skills', 'dup').replace(/[/\\]/g, '.')}.*${path.join(rootB, 'skills', 'dup').replace(/[/\\]/g, '.')}`)
        );
    });

    it('merges workflows from multiple roots and detects collisions', () => {
        writeWorkflow(rootA, 'flow');
        const { discoverWorkflows } = require('../../src/core/discovery');
        expect(discoverWorkflows([rootA, rootB]).map((w: { name: string }) => w.name)).toEqual(['flow']);
        writeWorkflow(rootB, 'flow');
        jest.resetModules();
        const fresh = require('../../src/core/discovery');
        expect(() => fresh.discoverWorkflows([rootA, rootB])).toThrow(/collision/i);
    });

    it('skips roots without the artifact dir', () => {
        writeSkill(rootA, 'alpha');
        const { discoverSkills, discoverAgents } = require('../../src/core/discovery');
        expect(discoverSkills([rootA, rootB]).length).toBe(1);
        expect(discoverAgents([rootA, rootB])).toEqual([]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/discovery-multiroot.test.ts`
Expected: FAIL — `discoverSkills` no acepta argumento (firma actual sin parámetros lee un dir fijo)

- [ ] **Step 3: Modify `cli/src/core/discovery.ts`**

Reemplazar las tres funciones `discoverSkills`, `discoverWorkflows`, `discoverAgents` (líneas 52-105) por versiones multi-root. Agregar el import de `contentRoots` y el helper de colisión. Las constantes `SKILLS_DIR`/`WORKFLOWS_DIR`/`AGENTS_DIR` se conservan (back-compat de imports). `readArtifactDescription` no cambia.

```typescript
// agregar al bloque de imports (línea 4):
import { contentRoots } from './registries';

// helper nuevo (después de readArtifactDescription):
function collisionError(kind: string, name: string, first: string, second: string): Error {
    return new Error(
        `Artifact name collision: ${kind} "${name}" exists in both ${first} and ${second}. ` +
        `Remove or rename one of them (per-registry namespacing llega en WS-2).`
    );
}

export function discoverSkills(roots: string[] = contentRoots()): SkillArtifact[] {
    const out: SkillArtifact[] = [];
    const seen = new Map<string, string>();
    for (const root of roots) {
        const dir = path.join(root, 'skills');
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const skillPath = path.join(dir, entry.name);
            if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) continue;
            const prev = seen.get(entry.name);
            if (prev) throw collisionError('skill', entry.name, prev, skillPath);
            seen.set(entry.name, skillPath);
            out.push({
                name: entry.name,
                path: skillPath,
                description: readArtifactDescription(path.join(skillPath, 'SKILL.md')),
            });
        }
    }
    return out;
}

export function discoverWorkflows(roots: string[] = contentRoots()): WorkflowArtifact[] {
    const out: WorkflowArtifact[] = [];
    const seen = new Map<string, string>();
    for (const root of roots) {
        const dir = path.join(root, 'workflows');
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
            const name = entry.name.replace('.md', '');
            const filePath = path.join(dir, entry.name);
            const prev = seen.get(name);
            if (prev) throw collisionError('workflow', name, prev, filePath);
            seen.set(name, filePath);
            out.push({ name, path: filePath, description: readArtifactDescription(filePath) });
        }
    }
    return out;
}

export function discoverAgents(roots: string[] = contentRoots()): AgentArtifact[] {
    const out: AgentArtifact[] = [];
    const seen = new Map<string, string>();
    for (const root of roots) {
        const dir = path.join(root, 'agents');
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
            const name = entry.name.replace('.md', '');
            const filePath = path.join(dir, entry.name);
            const prev = seen.get(name);
            if (prev) throw collisionError('agent', name, prev, filePath);
            seen.set(name, filePath);
            out.push({ name, path: filePath, description: readArtifactDescription(filePath) });
        }
    }
    return out;
}
```

Nota: los call-sites existentes (`cli/src/index.ts:142-144,459`) llaman `discoverSkills()` sin argumentos → toman el default `contentRoots()` automáticamente. No requieren cambios.

- [ ] **Step 4: Run tests + suite completa**

Run: `cd cli && npx jest tests/core/discovery-multiroot.test.ts && npm test`
Expected: PASS el nuevo + 494 preexistentes verdes (si algún test viejo de discovery dependía de la firma, adaptarlo conservando su intención)

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/discovery.ts cli/tests/core/discovery-multiroot.test.ts
git commit -m "feat(discovery): merge multi-root via contentRoots() + colisión ruidosa (WS-1)"
```

---

### Task 4: bundles multi-root + install desde el root propio

**Files:**
- Modify: `cli/src/core/bundles.ts`
- Modify: `cli/src/core/bundle-install.ts:40-52,62-74`
- Test: `cli/tests/core/bundles-multiroot.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// cli/tests/core/bundles-multiroot.test.ts
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

describe('bundles multi-root', () => {
    let tmp: string;
    let rootA: string;
    let rootB: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bundles-'));
        rootA = path.join(tmp, 'a');
        rootB = path.join(tmp, 'b');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('discoverAllBundles merges bundles from all roots and stamps contentRoot', () => {
        writeBundleRoot(rootA, 'dev-x', 'sx');
        writeBundleRoot(rootB, 'personal-x', 'px');
        const { discoverAllBundles } = require('../../src/core/bundles');
        const all = discoverAllBundles([rootA, rootB]);
        expect(all.map((b: { name: string }) => b.name).sort()).toEqual(['dev-x', 'personal-x']);
        expect(all.find((b: { name: string }) => b.name === 'personal-x').contentRoot).toBe(rootB);
    });

    it('discoverAllBundles throws naming both sources on bundle name collision', () => {
        writeBundleRoot(rootA, 'dup', 's1');
        writeBundleRoot(rootB, 'dup', 's2');
        const { discoverAllBundles } = require('../../src/core/bundles');
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(/dup/);
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(new RegExp(rootA.replace(/[/\\]/g, '.')));
    });

    it('installBundle resolves artifacts from the bundle own contentRoot', () => {
        writeBundleRoot(rootB, 'personal-x', 'px');
        const { discoverAllBundles } = require('../../src/core/bundles');
        const { installBundle } = require('../../src/core/bundle-install');
        const bundles = discoverAllBundles([rootB]);
        const projectRoot = path.join(tmp, 'proj');
        fs.mkdirSync(projectRoot, { recursive: true });

        const summary = installBundle({
            bundleName: 'personal-x',
            bundles,
            agents: ['claude-code'],
            method: 'copy',
            projectRoot,
            scopeOverride: 'local',
        });

        // la skill se copió DESDE rootB (su propio root), no desde el default
        expect(summary.installed.some((l: string) => l.startsWith('px'))).toBe(true);
        expect(summary.skipped.some((l: string) => l.includes('source missing'))).toBe(false);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/bundles-multiroot.test.ts`
Expected: FAIL — `discoverAllBundles` no existe

- [ ] **Step 3: Modify `cli/src/core/bundles.ts`**

En `BundleDefinition` agregar el campo opcional (después de `agents: string[];`, línea 25):

```typescript
    /** Root de contenido donde se descubrió el bundle (multi-registry, WS-1). */
    contentRoot?: string;
```

En `discoverBundles` (línea 60), estampar el root en el objeto pusheado — agregar al final del literal:

```typescript
            agents: raw.agents ?? [],
            contentRoot: contentDir,
```

Agregar al final del archivo (con `import { contentRoots } from './registries';` arriba):

```typescript
/** Descubre bundles de TODOS los roots (base + registries adicionales).
 *  Colisión de nombre entre roots → error explícito nombrando ambas fuentes. */
export function discoverAllBundles(roots: string[] = contentRoots()): BundleDefinition[] {
    const out: BundleDefinition[] = [];
    const seen = new Map<string, string>();
    for (const root of roots) {
        for (const b of discoverBundles(root)) {
            const prev = seen.get(b.name);
            if (prev) {
                throw new Error(
                    `Artifact name collision: bundle "${b.name}" exists in both ${prev} and ${root}. ` +
                    `Remove or rename one of them (per-registry namespacing llega en WS-2).`
                );
            }
            seen.set(b.name, root);
            out.push(b);
        }
    }
    return out;
}
```

- [ ] **Step 4: Modify `cli/src/core/bundle-install.ts`**

En `installBundle` (línea 62-74), el contentDir se resuelve POR BUNDLE — el root propio del bundle gana sobre el default:

```typescript
export function installBundle(opts: InstallBundleOptions): InstallSummary {
    const fallbackContentDir = opts.contentDir ?? REGISTRY_CONTENT_DIR;
    const closure = resolveBundleClosure(opts.bundleName, opts.bundles);
    const installed: string[] = [];
    const skipped: string[] = [];

    for (const b of closure) {
        const contentDir = b.contentRoot ?? fallbackContentDir;
        const scope: Scope =
            b.name === opts.bundleName
                ? opts.scopeOverride ?? defaultScopeForBundle(b.scope)
                : defaultScopeForBundle(b.scope);

        for (const art of bundleArtifacts(b, contentDir)) {
```

(el resto del cuerpo no cambia)

- [ ] **Step 5: Run tests + suite completa**

Run: `cd cli && npx jest tests/core/bundles-multiroot.test.ts && npm test`
Expected: PASS nuevo + suite verde (los tests existentes de `bundle-install` construyen definitions sin `contentRoot` → usan el fallback, sin cambios)

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/bundles.ts cli/src/core/bundle-install.ts cli/tests/core/bundles-multiroot.test.ts
git commit -m "feat(bundles): discoverAllBundles multi-root + install desde el root propio (WS-1)"
```

---

### Task 5: skill-integrity multi-root + call-sites

**Files:**
- Modify: `cli/src/core/skill-integrity.ts`
- Modify: `cli/src/index.ts:356` (reconcile en update)
- Modify: `cli/src/core/init/steps.ts:147` (+ el tipo de `d.actions.repairGlobalSkills` — localizar con `grep -rn "repairGlobalSkills" cli/src/core/init cli/src/core/diagnostics`)
- Modify: `cli/src/core/diagnostics/context.ts:139`
- Test: extender el test existente de skill-integrity (localizar con `ls cli/tests/core/ | grep -i integrity`; si no existe, crear `cli/tests/core/skill-integrity.test.ts`)

- [ ] **Step 1: Write the failing test (caso multi-root)**

```typescript
// agregar a cli/tests/core/skill-integrity.test.ts (o crearlo con este describe)
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('skill-integrity multi-root', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-integrity-'));
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('repairGlobalSkills re-links a dangling symlink to the FIRST root that has the skill', () => {
        const skillsDir = path.join(tmp, 'installed');
        const rootA = path.join(tmp, 'base');
        const rootB = path.join(tmp, 'personal');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.mkdirSync(path.join(rootB, 'skills', 'mine'), { recursive: true });
        fs.writeFileSync(path.join(rootB, 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\n');
        // symlink colgante: apunta a un target borrado
        fs.symlinkSync(path.join(tmp, 'gone', 'mine'), path.join(skillsDir, 'mine'), 'dir');

        const { repairGlobalSkills } = require('../../src/core/skill-integrity');
        const r = repairGlobalSkills(skillsDir, [rootA, rootB]);

        expect(r.relinked).toEqual(['mine']);
        expect(fs.realpathSync(path.join(skillsDir, 'mine'))).toBe(fs.realpathSync(path.join(rootB, 'skills', 'mine')));
    });

    it('classifyGlobalSkills marks dead when NO root has the skill', () => {
        const skillsDir = path.join(tmp, 'installed');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.symlinkSync(path.join(tmp, 'gone', 'nope'), path.join(skillsDir, 'nope'), 'dir');

        const { classifyGlobalSkills } = require('../../src/core/skill-integrity');
        const c = classifyGlobalSkills(skillsDir, [path.join(tmp, 'base')]);

        expect(c.dead).toEqual(['nope']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/skill-integrity.test.ts`
Expected: FAIL — las firmas actuales reciben `registryContentDir: string`, no array

- [ ] **Step 3: Modify `cli/src/core/skill-integrity.ts`**

Cambiar el helper y las tres firmas públicas de `string` a `string[]`:

```typescript
function findRegistrySkillPath(registryContentDirs: string[], name: string): string | null {
    for (const root of registryContentDirs) {
        const p = path.join(root, 'skills', name);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

export function classifyGlobalSkills(skillsDir: string, registryContentDirs: string[]): SkillIntegrity {
    // cuerpo igual, reemplazando la línea 35:
    //   if (fs.existsSync(registrySkillPath(registryContentDir, name))) out.repairable.push(name);
    // por:
    //   if (findRegistrySkillPath(registryContentDirs, name)) out.repairable.push(name);
}

export function repairGlobalSkills(skillsDir: string, registryContentDirs: string[]): RepairResult {
    // cuerpo igual, reemplazando la línea 51:
    //   fs.symlinkSync(registrySkillPath(registryContentDir, name), p, 'dir');
    // por:
    //   const target = findRegistrySkillPath(registryContentDirs, name);
    //   if (!target) { result.failed.push(name); continue; }
    //   fs.symlinkSync(target, p, 'dir');
}

export function reconcileAllSkillLinks(
    registryContentDirs: string[],
): { agent: AgentTarget; result: RepairResult }[] {
    // cuerpo igual, pasando registryContentDirs a repairGlobalSkills
}
```

(eliminar el viejo `registrySkillPath`)

- [ ] **Step 4: Update the call-sites**

1. `cli/src/index.ts:356` — `reconcileAllSkillLinks(REGISTRY_CONTENT_DIR)` → `reconcileAllSkillLinks(contentRoots())`. Agregar `import { contentRoots } from './core/registries';` arriba.
2. `cli/src/core/diagnostics/context.ts:139` — `classifyGlobalSkills(skillsDir, REGISTRY_CONTENT_DIR)` → `classifyGlobalSkills(skillsDir, contentRoots())` + import.
3. `cli/src/core/init/steps.ts:147` — `d.actions.repairGlobalSkills(skillsDir, REGISTRY_CONTENT_DIR)` → `d.actions.repairGlobalSkills(skillsDir, contentRoots())` + import. Actualizar el TIPO de `repairGlobalSkills` en la interface de actions de init (localizar: `grep -rn "repairGlobalSkills" cli/src/core/init`).
4. Si la suite revela otros call-sites (tests de diagnostics/init que pasan `REGISTRY_CONTENT_DIR`), envolver el argumento en `[...]` conservando la intención del test.

- [ ] **Step 5: Run full suite**

Run: `cd cli && npm test`
Expected: PASS — todos los tests verdes (nuevos + adaptados)

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/skill-integrity.ts cli/src/index.ts cli/src/core/diagnostics/context.ts cli/src/core/init/steps.ts cli/tests/core/skill-integrity.test.ts
git commit -m "feat(skill-integrity): búsqueda de skills en todos los content roots (WS-1)"
```

---

### Task 6: comandos `awm registry add/list/remove` + update multi-pull

**Files:**
- Create: `cli/src/commands/registry/add.ts`
- Create: `cli/src/commands/registry/remove.ts`
- Create: `cli/src/commands/registry/index.ts`
- Modify: `cli/src/index.ts` (registro del comando, update handler, switch a `discoverAllBundles`)
- Modify: `cli/src/core/diagnostics/context.ts:176` y `cli/src/commands/init.ts:76` (switch a `discoverAllBundles`)
- Test: `cli/tests/commands/registry/add.test.ts`, `cli/tests/commands/registry/remove.test.ts`

- [ ] **Step 1: Write the failing tests for addRegistry**

```typescript
// cli/tests/commands/registry/add.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t ${cmd}`, { cwd, stdio: 'pipe' });

function makeSourceRepo(base: string, opts: { skill?: string; empty?: boolean }): string {
    const dir = path.join(base, `src-${opts.skill ?? 'empty'}`);
    fs.mkdirSync(dir, { recursive: true });
    if (!opts.empty && opts.skill) {
        fs.mkdirSync(path.join(dir, 'skills', opts.skill), { recursive: true });
        fs.writeFileSync(path.join(dir, 'skills', opts.skill, 'SKILL.md'), `---\nname: ${opts.skill}\ndescription: d\n---\n`);
    } else {
        fs.writeFileSync(path.join(dir, 'README.md'), 'no content dirs');
    }
    GIT(dir, 'init -q');
    GIT(dir, 'add -A');
    GIT(dir, 'commit -qm init');
    return dir;
}

describe('addRegistry', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regadd-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regadd-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it('clones, validates, writes config and derives name from remote', async () => {
        const source = makeSourceRepo(tmpWork, { skill: 'alpha' });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source);

        expect(result.ok).toBe(true);
        expect(result.name).toBe(path.basename(source));
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([{ name: path.basename(source), remote: source }]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries', path.basename(source), 'skills/alpha/SKILL.md'))).toBe(true);
    });

    it('is atomic: invalid layout → no config written, clone dir cleaned up', async () => {
        const source = makeSourceRepo(tmpWork, { empty: true });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'bad');

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/skills\/, bundles\/, workflows\/, agents\//);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/bad'))).toBe(false);
    });

    it('is atomic: artifact collision with existing content → no config, cleanup, error names both', async () => {
        // base content root con la skill 'alpha'
        const base = path.join(tmpHome, '.awm/cli-source/registry/skills/alpha');
        fs.mkdirSync(base, { recursive: true });
        fs.writeFileSync(path.join(base, 'SKILL.md'), '---\nname: alpha\ndescription: base\n---\n');

        const source = makeSourceRepo(tmpWork, { skill: 'alpha' });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'personal');

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/collision/i);
        expect(result.error).toMatch(/alpha/);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/personal'))).toBe(false);
    });

    it('rejects duplicate registry name and clone failure without writing config', async () => {
        const source = makeSourceRepo(tmpWork, { skill: 'alpha' });
        const { addRegistry } = require('../../../src/commands/registry/add');
        await addRegistry(source, 'personal');

        const dup = await addRegistry(source, 'personal');
        expect(dup.ok).toBe(false);
        expect(dup.error).toMatch(/already exists/);

        const broken = await addRegistry(path.join(tmpWork, 'no-such-repo'), 'ghost');
        expect(broken.ok).toBe(false);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig().map((r: { name: string }) => r.name)).toEqual(['personal']);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/commands/registry/add.test.ts`
Expected: FAIL with "Cannot find module '../../../src/commands/registry/add'"

- [ ] **Step 3: Write `cli/src/commands/registry/add.ts`**

```typescript
// cli/src/commands/registry/add.ts
// Lógica de `awm registry add`, separada del wiring de commander (testeable sin prompts).
import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import {
    REGISTRIES_DIR,
    readRegistriesConfig,
    writeRegistriesConfig,
    registryContentRoot,
    validateRegistryLayout,
    contentRoots,
    CONTENT_DIR_NAMES,
} from '../../core/registries';
import { discoverSkills, discoverWorkflows, discoverAgents } from '../../core/discovery';
import { discoverAllBundles } from '../../core/bundles';

export type AddRegistryResult =
    | { ok: true; name: string; contentRoot: string }
    | { ok: false; name?: string; error: string };

export function deriveRegistryName(remote: string): string {
    const base = remote.replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
    return base.replace(/\.git$/, '');
}

export async function addRegistry(remote: string, nameOverride?: string): Promise<AddRegistryResult> {
    const name = nameOverride ?? deriveRegistryName(remote);
    if (!name || /[/\\]/.test(name) || name === 'cli-source') {
        return { ok: false, error: `Invalid registry name "${name}" — use --name <simple-dir-name>` };
    }
    const existing = readRegistriesConfig();
    if (existing.some((r) => r.name === name)) {
        return { ok: false, name, error: `Registry "${name}" already exists — remove it first with 'awm registry remove ${name}'` };
    }
    const dest = registryContentRoot(name);
    if (fs.existsSync(dest)) {
        return { ok: false, name, error: `Destination already exists on disk: ${dest}` };
    }

    fs.mkdirSync(REGISTRIES_DIR, { recursive: true });
    try {
        await simpleGit().clone(remote, dest);
    } catch (e) {
        fs.rmSync(dest, { recursive: true, force: true });
        return { ok: false, name, error: `Clone failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    if (!validateRegistryLayout(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
        return {
            ok: false,
            name,
            error: `Invalid registry layout: expected at least one of ${CONTENT_DIR_NAMES.map((d) => `${d}/`).join(', ')} at the repo root of ${remote}`,
        };
    }

    // Colisiones contra el contenido ya conocido — ANTES de escribir config.
    try {
        const roots = [...contentRoots(), dest];
        discoverSkills(roots);
        discoverWorkflows(roots);
        discoverAgents(roots);
        discoverAllBundles(roots);
    } catch (e) {
        fs.rmSync(dest, { recursive: true, force: true });
        return { ok: false, name, error: e instanceof Error ? e.message : String(e) };
    }

    writeRegistriesConfig([...existing, { name, remote }]);
    return { ok: true, name, contentRoot: dest };
}
```

- [ ] **Step 4: Run add tests to verify they pass**

Run: `cd cli && npx jest tests/commands/registry/add.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing tests for removeRegistry**

```typescript
// cli/tests/commands/registry/remove.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('removeRegistry', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regrm-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it('removes the config entry and the clone dir', () => {
        const { writeRegistriesConfig, registryContentRoot, readRegistriesConfig } = require('../../../src/core/registries');
        writeRegistriesConfig([{ name: 'personal', remote: 'r' }]);
        fs.mkdirSync(path.join(registryContentRoot('personal'), 'skills'), { recursive: true });

        const { removeRegistry } = require('../../../src/commands/registry/remove');
        const result = removeRegistry('personal');

        expect(result.ok).toBe(true);
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(registryContentRoot('personal'))).toBe(false);
    });

    it('errors on unknown name without touching anything', () => {
        const { removeRegistry } = require('../../../src/commands/registry/remove');
        const result = removeRegistry('nope');
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/not found/);
    });
});
```

- [ ] **Step 6: Write `cli/src/commands/registry/remove.ts`** (verificar que el test de Step 5 falla antes: `npx jest tests/commands/registry/remove.test.ts` → "Cannot find module")

```typescript
// cli/src/commands/registry/remove.ts
import fs from 'fs';
import { readRegistriesConfig, writeRegistriesConfig, registryContentRoot } from '../../core/registries';

export type RemoveRegistryResult = { ok: true } | { ok: false; error: string };

export function removeRegistry(name: string): RemoveRegistryResult {
    const existing = readRegistriesConfig();
    if (!existing.some((r) => r.name === name)) {
        return { ok: false, error: `Registry "${name}" not found — see 'awm registry list'` };
    }
    writeRegistriesConfig(existing.filter((r) => r.name !== name));
    fs.rmSync(registryContentRoot(name), { recursive: true, force: true });
    return { ok: true };
}
```

Run: `cd cli && npx jest tests/commands/registry/remove.test.ts` → PASS (2 tests)

- [ ] **Step 7: Write `cli/src/commands/registry/index.ts` (wiring commander)**

```typescript
// cli/src/commands/registry/index.ts
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { intro, outro, confirm, isCancel, spinner } from '@clack/prompts';
import pc from 'picocolors';
import { listRegistries, contentRoots } from '../../core/registries';
import { discoverSkills, discoverWorkflows, discoverAgents } from '../../core/discovery';
import { discoverBundles } from '../../core/bundles';
import { reconcileAllSkillLinks } from '../../core/skill-integrity';
import { regenerateGlobalContext } from '../../core/context/regenerate';
import { addRegistry } from './add';
import { removeRegistry } from './remove';

export function registerRegistryCommand(program: Command): void {
    const reg = program.command('registry').description('manage additional content registries (team/personal)');

    reg.command('add <remote>')
        .description('clone an additional registry (git URL or local path) and register it')
        .option('--name <name>', 'registry name (default: repo basename)')
        .action(async (remote: string, options: { name?: string }) => {
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
                // la regeneración de contexto no debe abortar un add exitoso
            }
            outro(`✅ Run ${pc.cyan('awm list')} to see the new content.`);
        });

    reg.command('list')
        .description('list configured additional registries')
        .action(() => {
            const regs = listRegistries();
            if (regs.length === 0) {
                console.log(pc.dim('No additional registries. Add one with `awm registry add <git-url>`.'));
                return;
            }
            for (const r of regs) {
                if (!fs.existsSync(r.contentRoot)) {
                    console.log(`${pc.cyan(r.name)}  ${r.remote}  ${pc.yellow("missing on disk — run 'awm update'")}`);
                    continue;
                }
                const counts = [
                    `${discoverSkills([r.contentRoot]).length} skills`,
                    `${discoverBundles(r.contentRoot).length} bundles`,
                    `${discoverWorkflows([r.contentRoot]).length} workflows`,
                    `${discoverAgents([r.contentRoot]).length} agents`,
                ].join(', ');
                console.log(`${pc.cyan(r.name)}  ${r.remote}  ${pc.dim(counts)}`);
            }
        });

    reg.command('remove <name>')
        .description('remove an additional registry (config + clone)')
        .option('-y, --yes', 'skip confirmation')
        .action(async (name: string, options: { yes?: boolean }) => {
            intro(pc.bgCyan(pc.black(' AWM - Remove Registry ')));
            if (!options.yes) {
                const sure = await confirm({ message: `Remove registry "${name}" and its local clone?` });
                if (isCancel(sure) || !sure) {
                    outro('Cancelled.');
                    return;
                }
            }
            const result = removeRegistry(name);
            if (!result.ok) {
                console.error(pc.red(result.error));
                process.exit(1);
            }
            try {
                for (const { agent, result: r } of reconcileAllSkillLinks(contentRoots())) {
                    if (r.pruned.length > 0) {
                        console.log(pc.yellow(`  ⚠  Pruned ${r.pruned.length} dead skill link(s) for ${agent}`));
                    }
                }
            } catch {
                // la reconciliación no debe abortar un remove exitoso
            }
            outro(`✅ Registry ${pc.cyan(name)} removed.`);
        });
}
```

Nota: `path` queda sin uso si no se necesita — eliminar el import si el linter lo marca.

- [ ] **Step 8: Wire into `cli/src/index.ts`**

1. Imports (junto a los otros register, líneas 22-27): `import { registerRegistryCommand } from './commands/registry';`
2. Import core: agregar `contentRoots, syncAdditionalRegistries` a un import de `./core/registries` (ya agregado `contentRoots` en Task 5 — extenderlo).
3. Registro (junto a línea 701-703): `registerRegistryCommand(program);`
4. Switch a `discoverAllBundles`: en `cli/src/index.ts` líneas 80, 206, 433, 459, 578 reemplazar `discoverBundles()` por `discoverAllBundles()` y ajustar el import de `./core/bundles` (mantener `defaultScopeForBundle, REGISTRY_CONTENT_DIR`, sumar `discoverAllBundles`, quitar `discoverBundles` si queda sin uso). Igual en `cli/src/core/diagnostics/context.ts:176` y `cli/src/commands/init.ts:76`.
5. Update handler — DESPUÉS del build del CLI (línea 343) y ANTES del bloque `regenerateGlobalContext` (línea 345), para que regeneración/reconciliación vean contenido fresco:

```typescript
          try {
              for (const r of await syncAdditionalRegistries()) {
                  if (r.action === 'error') {
                      console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
                  } else {
                      console.log(pc.green(`  ✓ Registry ${r.name} ${r.action === 'pulled' ? 'updated' : 're-cloned'}`));
                  }
              }
          } catch {
              // la sync de registries adicionales no debe abortar un update exitoso
          }
```

- [ ] **Step 9: Build + full suite + sensores**

Run: `cd cli && npm run build && npm test && node dist/src/index.js registry list`
Expected: build limpio, suite verde, `registry list` imprime "No additional registries..." (la máquina real no se toca — solo LEE config inexistente o existente; no escribir nada fuera de tests)
Run: `awm sensors run` (desde la raíz del repo) — sin findings nuevos (`depcheck`/`security` tienen fallas preexistentes en main: no son regresión)

- [ ] **Step 10: Commit**

```bash
git add cli/src/commands/registry/ cli/tests/commands/registry/ cli/src/index.ts cli/src/core/diagnostics/context.ts cli/src/commands/init.ts cli/src/core/bundles.ts
git commit -m "feat(registry): awm registry add/list/remove + update multi-pull (WS-1)"
```

---

### Task 7: migración del contenido personal

**Files:**
- Create (repo EXTERNO `/Users/cencosud/Developments/personal/awm-personal-registry`): `catalog.json`
- Delete: `registry/skills/career-goal-brainstorm/`, `registry/skills/cristalizar-proceso/`, `registry/skills/agregar-nodos-proceso/`, `registry/bundles/personal-notion/`
- Modify: `registry/catalog.json`

- [ ] **Step 1: `catalog.json` en el registry personal** (los bundles se descubren VÍA catalog.json — sin él, `personal-notion` sería invisible)

```bash
cat > /Users/cencosud/Developments/personal/awm-personal-registry/catalog.json <<'EOF'
{
  "version": 1,
  "bundles": [
    { "name": "personal-notion", "source": "./bundles/personal-notion", "version": "1.0.0", "scope": "ambient", "visibility": "private" }
  ]
}
EOF
cd /Users/cencosud/Developments/personal/awm-personal-registry
git add catalog.json && git commit -m "feat: catalog.json — personal-notion descubrible como bundle" && git push
```

- [ ] **Step 2: borrar el contenido personal del repo distribuible**

```bash
cd /Users/cencosud/Developments/personal/agentic-workflow
git rm -r registry/skills/career-goal-brainstorm registry/skills/cristalizar-proceso registry/skills/agregar-nodos-proceso registry/bundles/personal-notion
```

- [ ] **Step 3: quitar `personal-notion` de `registry/catalog.json`** — eliminar la línea:

```json
    { "name": "personal-notion", "source": "./bundles/personal-notion", "version": "1.0.0", "scope": "ambient", "visibility": "private" }
```

(y la coma colgante de la entrada anterior, `authoring`)

- [ ] **Step 4: verificar**

```bash
cd cli && npm test
grep -ri "career-goal-brainstorm\|cristalizar-proceso\|agregar-nodos-proceso\|personal-notion" /Users/cencosud/Developments/personal/agentic-workflow --include="*.json" --include="*.md" --include="*.ts" -l | grep -v docs/plans | grep -v docs/harness
```

Expected: suite verde (incl. `tests/registry/catalog-consistency.test.ts`); el grep solo devuelve docs históricos (`docs/plans/`, `docs/harness-*`) — el contenido vivo no referencia nada personal. Si algún doc vivo (README, cli-reference) lo referencia, limpiar esa referencia en este mismo paso.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(registry): extraer contenido personal → Kodria/awm-personal-registry (WS-1 F-4)"
```

---

### Task 8: cierre — roadmap + verificación end-to-end manual

**Files:**
- Modify: `docs/plans/2026-06-09-distribution-roadmap.md` (sección WS-1 + tabla de estado)

- [ ] **Step 1: actualizar el roadmap (regla #3 — mismo PR)**

En la sección WS-1: marcar `[x]` los ítems "Brainstorming + design" y "Plan + ejecución" con link a este plan; dejar "Verificación" y "QA" para sus fases. En la tabla de estado: fila WS-1 → `Plan ejecutado: [2026-06-09-ws1-personal-content-extraction-plan.md](2026-06-09-ws1-personal-content-extraction-plan.md)`, QA queda ☐ (lo marca post-implementation-qa).

- [ ] **Step 2: verificación end-to-end con build local (sin tocar `~/.awm` real)**

El criterio del roadmap "clone limpio no contiene contenido personal" se verifica:

```bash
cd /tmp && rm -rf awm-clean-check && git clone --depth 1 file:///Users/cencosud/Developments/personal/agentic-workflow awm-clean-check
grep -ri "personal-notion\|career-goal" awm-clean-check/registry/ ; echo "exit=$?"
```

Expected: `exit=1` (sin matches en `registry/`).

El criterio "skills personales siguen funcionando en la máquina de Nicolás" se completa DESPUÉS del merge, vía el ciclo real del instalador (NUNCA tocar `~/.awm` a mano): `awm update` → `awm registry add git@github.com:Kodria/awm-personal-registry.git` → verificar `awm list --all` muestra `personal-notion` y el symlink de `career-goal-brainstorm` re-apuntado. Documentar este paso como checklist post-merge en el reporte final de la rama.

- [ ] **Step 3: Commit**

```bash
git add docs/plans/2026-06-09-distribution-roadmap.md
git commit -m "docs(roadmap): WS-1 ejecutado — pendiente QA gate"
```

---

## Notas para el ejecutor

- **Orden estricto de tasks** (1→8): discovery (Task 3) y bundles (Task 4) dependen de `registries.ts` (Task 1); los comandos (Task 6) dependen de todo lo anterior; la migración (Task 7) requiere el mecanismo completo para que la verificación tenga sentido.
- **Ningún paso escribe en `~/.awm` ni `~/.claude` reales.** El smoke de Task 6 Step 9 solo LEE. La activación real en la máquina ocurre post-merge vía `awm update` (ver CLAUDE.md, regla del instalador).
- Sensor gate por task: `awm sensors run` sin flag; fallas preexistentes de `depcheck`/`security` en main no son regresión.
- Reviewers: emitir `awm ledger add` por hallazgo y win (Ledger Gate del SKILL.md de subagent-driven-development).
