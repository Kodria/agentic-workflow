# Harness Bundles — Fase 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reestructurar el registry de un `processes.json` plano a un modelo `catalog.json` + `bundle.json`×5 (corte limpio), con versión por skill y `using-awm` por niveles, sin romper los comandos `add`/`list`/`remove`.

**Architecture:** Se introduce un módulo `bundles.ts` que reemplaza a `discoverProcesses`. Los bundles llevan `scope`, `version`, `dependsOn`, `visibility` y skills como refs (`{name, onSignal?}`). `catalog.json` espeja metadata para listados rápidos; `bundle.json` es la fuente de verdad. Los consumidores (`registry-view`, `grouping`, `index`) se adaptan al nuevo tipo `BundleDefinition`. La activación por proyecto, `doctor` e `init` quedan para Fases 1b/1c/1d.

**Tech Stack:** TypeScript, Node, Commander, @clack/prompts, Jest + ts-jest.

**Referencia de diseño:** `docs/plans/2026-06-02-harness-bundles-activation-design.md`

**Alcance de esta sub-fase (1a):**
- ✅ `version` en frontmatter de las 44 skills.
- ✅ `catalog.json` + `bundle.json` (×5) + borrado de `processes.json`.
- ✅ Módulo `bundles.ts` (tipos, discovery, resolución de `dependsOn`).
- ✅ Adaptación de `registry-view.ts`, `grouping.ts`, `index.ts` (corte limpio).
- ✅ Filtrado de `visibility: private` en `awm list`.
- ✅ Reescritura de `using-awm` a política por niveles.
- ❌ FUERA: profile/sync/activación local (1b), `awm doctor` (1c), `awm init` (1d), anotación de menú `onSignal` en el hook SessionStart (se difiere; en 1a `onSignal` solo se persiste como dato en `bundle.json`).

---

## File Structure

**Registry content (raíz del repo):**
- Create: `registry/catalog.json` — índice de bundles.
- Create: `registry/bundles/dev/bundle.json`
- Create: `registry/bundles/frontend/bundle.json`
- Create: `registry/bundles/docs/bundle.json`
- Create: `registry/bundles/authoring/bundle.json`
- Create: `registry/bundles/personal-notion/bundle.json`
- Delete: `registry/processes.json`
- Modify: las 44 `registry/skills/*/SKILL.md` (añadir `version`).

**CLI (`cli/`):**
- Create: `cli/src/core/bundles.ts` — tipos + `discoverBundles` + `readCatalog` + `resolveBundleSkills`.
- Modify: `cli/src/core/discovery.ts` — eliminar `discoverProcesses`/`ProcessDefinition`/`PROCESSES_FILE`.
- Modify: `cli/src/utils/registry-view.ts` — consumir `BundleDefinition`; `PackageView` lleva `visibility`.
- Modify: `cli/src/utils/grouping.ts` — consumir `BundleDefinition`.
- Modify: `cli/src/index.ts` — `add`/`list`/`remove` usan `discoverBundles`; `list` filtra private.
- Create: `cli/scripts/add-skill-versions.mjs` — script idempotente para sembrar `version`.

**Tests:**
- Create: `cli/tests/core/bundles.test.ts`
- Create: `cli/tests/registry/catalog-consistency.test.ts`
- Create: `cli/tests/registry/skill-versions.test.ts`
- Modify: `cli/tests/utils/registry-view.test.ts`
- Modify: `cli/tests/utils/grouping.test.ts`
- Modify: `cli/tests/core/discovery.test.ts`
- Modify: `cli/tests/registry/using-awm.test.ts`

---

## Task 1: Versión por skill en frontmatter

**Files:**
- Create: `cli/scripts/add-skill-versions.mjs`
- Test: `cli/tests/registry/skill-versions.test.ts`
- Modify: las 44 `registry/skills/*/SKILL.md`

- [ ] **Step 1: Write the failing test**

```ts
// cli/tests/registry/skill-versions.test.ts
import fs from 'fs';
import path from 'path';

const SKILLS_DIR = path.join(__dirname, '../../../registry/skills');

function frontmatter(file: string): string {
    const raw = fs.readFileSync(file, 'utf-8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return m ? m[1] : '';
}

describe('skill frontmatter version', () => {
    const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .filter((e) => fs.existsSync(path.join(SKILLS_DIR, e.name, 'SKILL.md')))
        .map((e) => e.name);

    it('finds the 44 skills', () => {
        expect(dirs.length).toBe(44);
    });

    it.each(dirs)('skill "%s" declares a semver version', (name) => {
        const fm = frontmatter(path.join(SKILLS_DIR, name, 'SKILL.md'));
        expect(fm).toMatch(/^version:\s*["']?\d+\.\d+\.\d+["']?\s*$/m);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/registry/skill-versions.test.ts`
Expected: FAIL — skills sin campo `version`.

- [ ] **Step 3: Write the seeding script**

```js
// cli/scripts/add-skill-versions.mjs
// Idempotent: inserts `version: "1.0.0"` into each SKILL.md frontmatter
// right after the `name:` line, only if no version field exists yet.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '../../registry/skills');

const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(SKILLS_DIR, e.name, 'SKILL.md')));

let changed = 0;
for (const e of dirs) {
    const file = path.join(SKILLS_DIR, e.name, 'SKILL.md');
    const raw = fs.readFileSync(file, 'utf-8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) { console.warn(`SKIP (no frontmatter): ${e.name}`); continue; }
    if (/^version:\s*/m.test(m[1])) continue; // already has version
    const newFm = m[1].replace(/^(name:.*)$/m, `$1\nversion: "1.0.0"`);
    const updated = raw.replace(m[1], newFm);
    fs.writeFileSync(file, updated, 'utf-8');
    changed++;
}
console.log(`Updated ${changed} skill(s).`);
```

- [ ] **Step 4: Run the script**

Run: `cd cli && node scripts/add-skill-versions.mjs`
Expected: `Updated 44 skill(s).` (o menos si alguna ya tenía version).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd cli && npx jest tests/registry/skill-versions.test.ts`
Expected: PASS — las 44 skills con `version`.

- [ ] **Step 6: Commit**

```bash
git add registry/skills cli/scripts/add-skill-versions.mjs cli/tests/registry/skill-versions.test.ts
git commit -m "feat(registry): add version frontmatter to all skills"
```

---

## Task 2: Módulo bundles.ts — tipos, readCatalog, discoverBundles

**Files:**
- Create: `cli/src/core/bundles.ts`
- Test: `cli/tests/core/bundles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// cli/tests/core/bundles.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverBundles, readCatalog, resolveBundleSkills, BundleDefinition } from '../../src/core/bundles';

function makeFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bundles-'));
    const content = path.join(root, 'registry');
    fs.mkdirSync(path.join(content, 'bundles', 'dev'), { recursive: true });
    fs.mkdirSync(path.join(content, 'bundles', 'frontend'), { recursive: true });

    fs.writeFileSync(path.join(content, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [
            { name: 'dev', source: './bundles/dev', version: '1.0.0', scope: 'baseline' },
            { name: 'frontend', source: './bundles/frontend', version: '1.0.0', scope: 'project' },
        ],
    }));
    fs.writeFileSync(path.join(content, 'bundles', 'dev', 'bundle.json'), JSON.stringify({
        name: 'dev', version: '1.0.0', description: 'Dev core', scope: 'baseline', dependsOn: [],
        skills: ['brainstorming', { name: 'architecture-advisor', onSignal: true }],
        workflows: ['development-process'], agents: ['development-process'],
    }));
    fs.writeFileSync(path.join(content, 'bundles', 'frontend', 'bundle.json'), JSON.stringify({
        name: 'frontend', version: '1.0.0', description: 'Frontend', scope: 'project', dependsOn: ['dev'],
        skills: ['impeccable'], workflows: [], agents: [],
    }));
    return content;
}

describe('readCatalog', () => {
    it('reads catalog entries', () => {
        const content = makeFixture();
        const entries = readCatalog(content);
        expect(entries.map((e) => e.name).sort()).toEqual(['dev', 'frontend']);
        expect(entries.find((e) => e.name === 'dev')!.scope).toBe('baseline');
    });
});

describe('discoverBundles', () => {
    it('loads each bundle and normalizes skill refs (string | object)', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        const dev = bundles.find((b) => b.name === 'dev')!;
        expect(dev.skills).toEqual([
            { name: 'brainstorming', onSignal: false },
            { name: 'architecture-advisor', onSignal: true },
        ]);
        expect(dev.scope).toBe('baseline');
        expect(dev.dependsOn).toEqual([]);
    });

    it('returns [] when catalog is missing', () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-'));
        expect(discoverBundles(empty)).toEqual([]);
    });
});

describe('resolveBundleSkills', () => {
    it('follows dependsOn transitively and dedupes', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        const names = resolveBundleSkills('frontend', bundles);
        expect(names.sort()).toEqual(['architecture-advisor', 'brainstorming', 'impeccable']);
    });

    it('returns own skills when no deps', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        expect(resolveBundleSkills('dev', bundles).sort()).toEqual(['architecture-advisor', 'brainstorming']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/bundles.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/bundles'`.

- [ ] **Step 3: Write the implementation**

```ts
// cli/src/core/bundles.ts
import fs from 'fs';
import path from 'path';
import { REGISTRY_DIR } from './registry';

export const REGISTRY_CONTENT_DIR = path.join(REGISTRY_DIR, 'registry');

export type BundleScope = 'baseline' | 'project' | 'ambient';
export type BundleVisibility = 'public' | 'private';

export interface BundleSkillRef {
    name: string;
    onSignal: boolean;
}

export interface BundleDefinition {
    name: string;
    description: string;
    version: string;
    scope: BundleScope;
    visibility: BundleVisibility;
    dependsOn: string[];
    skills: BundleSkillRef[];
    workflows: string[];
    agents: string[];
}

export interface CatalogEntry {
    name: string;
    source: string;
    version: string;
    scope: BundleScope;
    visibility?: BundleVisibility;
}

function catalogPath(contentDir: string): string {
    return path.join(contentDir, 'catalog.json');
}

export function readCatalog(contentDir: string = REGISTRY_CONTENT_DIR): CatalogEntry[] {
    const file = catalogPath(contentDir);
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { version: number; bundles: CatalogEntry[] };
    return parsed.bundles ?? [];
}

function normalizeSkillRefs(raw: Array<string | { name: string; onSignal?: boolean }>): BundleSkillRef[] {
    return (raw ?? []).map((s) =>
        typeof s === 'string' ? { name: s, onSignal: false } : { name: s.name, onSignal: s.onSignal === true }
    );
}

export function discoverBundles(contentDir: string = REGISTRY_CONTENT_DIR): BundleDefinition[] {
    const entries = readCatalog(contentDir);
    const bundles: BundleDefinition[] = [];
    for (const entry of entries) {
        const manifestPath = path.join(contentDir, entry.source, 'bundle.json');
        if (!fs.existsSync(manifestPath)) continue;
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        bundles.push({
            name: raw.name,
            description: raw.description ?? '',
            version: raw.version ?? '0.0.0',
            scope: raw.scope ?? 'project',
            visibility: raw.visibility ?? 'public',
            dependsOn: raw.dependsOn ?? [],
            skills: normalizeSkillRefs(raw.skills),
            workflows: raw.workflows ?? [],
            agents: raw.agents ?? [],
        });
    }
    return bundles;
}

/**
 * Returns the unique set of skill names for a bundle, following dependsOn transitively.
 */
export function resolveBundleSkills(bundleName: string, bundles: BundleDefinition[]): string[] {
    const byName = new Map(bundles.map((b) => [b.name, b]));
    const seen = new Set<string>();
    const skills = new Set<string>();
    const visit = (name: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        const b = byName.get(name);
        if (!b) return;
        for (const dep of b.dependsOn) visit(dep);
        for (const s of b.skills) skills.add(s.name);
    };
    visit(bundleName);
    return Array.from(skills);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/core/bundles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/bundles.ts cli/tests/core/bundles.test.ts
git commit -m "feat(cli): add bundles module (types, discovery, dependsOn resolution)"
```

---

## Task 3: Registry content — catalog.json + 5 bundle.json + consistencia

**Files:**
- Create: `registry/catalog.json`
- Create: `registry/bundles/dev/bundle.json`
- Create: `registry/bundles/frontend/bundle.json`
- Create: `registry/bundles/docs/bundle.json`
- Create: `registry/bundles/authoring/bundle.json`
- Create: `registry/bundles/personal-notion/bundle.json`
- Test: `cli/tests/registry/catalog-consistency.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// cli/tests/registry/catalog-consistency.test.ts
import fs from 'fs';
import path from 'path';

const CONTENT = path.join(__dirname, '../../../registry');

function readJson(p: string): any { return JSON.parse(fs.readFileSync(p, 'utf-8')); }

describe('catalog/bundle consistency', () => {
    const catalog = readJson(path.join(CONTENT, 'catalog.json'));

    it('declares exactly the 5 bundles', () => {
        expect(catalog.bundles.map((b: any) => b.name).sort())
            .toEqual(['authoring', 'dev', 'docs', 'frontend', 'personal-notion']);
    });

    it('every catalog entry has a matching bundle.json whose mirrored fields agree', () => {
        for (const entry of catalog.bundles) {
            const manifest = readJson(path.join(CONTENT, entry.source, 'bundle.json'));
            expect(manifest.name).toBe(entry.name);
            expect(manifest.scope).toBe(entry.scope);
            expect(manifest.version).toBe(entry.version);
            expect(manifest.visibility ?? 'public').toBe(entry.visibility ?? 'public');
        }
    });

    it('every referenced skill exists in registry/skills', () => {
        for (const entry of catalog.bundles) {
            const manifest = readJson(path.join(CONTENT, entry.source, 'bundle.json'));
            for (const s of manifest.skills) {
                const name = typeof s === 'string' ? s : s.name;
                expect(fs.existsSync(path.join(CONTENT, 'skills', name, 'SKILL.md'))).toBe(true);
            }
        }
    });

    it('bundle skills partition the 44 skills with no overlap', () => {
        const all: string[] = [];
        for (const entry of catalog.bundles) {
            const manifest = readJson(path.join(CONTENT, entry.source, 'bundle.json'));
            for (const s of manifest.skills) all.push(typeof s === 'string' ? s : s.name);
        }
        expect(all.length).toBe(44);
        expect(new Set(all).size).toBe(44); // no duplicates
    });

    it('processes.json has been removed', () => {
        expect(fs.existsSync(path.join(CONTENT, 'processes.json'))).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/registry/catalog-consistency.test.ts`
Expected: FAIL — falta `catalog.json` y aún existe `processes.json`.

- [ ] **Step 3: Create `registry/catalog.json`**

```json
{
  "version": 1,
  "bundles": [
    { "name": "dev",             "source": "./bundles/dev",             "version": "1.0.0", "scope": "baseline" },
    { "name": "frontend",        "source": "./bundles/frontend",        "version": "1.0.0", "scope": "project" },
    { "name": "docs",            "source": "./bundles/docs",            "version": "1.0.0", "scope": "project" },
    { "name": "authoring",       "source": "./bundles/authoring",       "version": "1.0.0", "scope": "project" },
    { "name": "personal-notion", "source": "./bundles/personal-notion", "version": "1.0.0", "scope": "ambient", "visibility": "private" }
  ]
}
```

- [ ] **Step 4: Create `registry/bundles/dev/bundle.json`**

```json
{
  "name": "dev",
  "version": "1.0.0",
  "description": "Núcleo de desarrollo de software agéntico: espina SDD, gates de calidad, sensores y advisory.",
  "scope": "baseline",
  "dependsOn": [],
  "skills": [
    "using-awm", "development-process", "brainstorming", "writing-plans", "executing-plans",
    "subagent-driven-development", "test-driven-development", "requesting-code-review",
    "receiving-code-review", "post-implementation-qa", "finishing-a-development-branch",
    "verification-before-completion", "systematic-debugging",
    { "name": "dispatching-parallel-agents", "onSignal": true },
    { "name": "using-git-worktrees", "onSignal": true },
    { "name": "project-context-init", "onSignal": true },
    { "name": "project-constitution", "onSignal": true },
    { "name": "setup-sensors", "onSignal": true },
    { "name": "harness-retro", "onSignal": true },
    { "name": "architecture-advisor", "onSignal": true },
    { "name": "cicd-proposal-builder", "onSignal": true },
    { "name": "nfr-checklist-generator", "onSignal": true },
    { "name": "technology-evaluator", "onSignal": true }
  ],
  "workflows": ["development-process"],
  "agents": ["development-process"]
}
```

- [ ] **Step 5: Create `registry/bundles/frontend/bundle.json`**

```json
{
  "name": "frontend",
  "version": "1.0.0",
  "description": "Capa de craft e implementación frontend.",
  "scope": "project",
  "dependsOn": ["dev"],
  "skills": ["impeccable", "ui-design", "extract-design-md", "code-to-design", "react-components", "frontend-craft"],
  "workflows": [],
  "agents": []
}
```

- [ ] **Step 6: Create `registry/bundles/docs/bundle.json`**

```json
{
  "name": "docs",
  "version": "1.0.0",
  "description": "Documentación con estándar Docs-as-Code.",
  "scope": "project",
  "dependsOn": ["dev"],
  "skills": [
    "docs-system-orchestrator", "docs-brainstorming", "docs-assistant", "template-manager",
    "template-wizard", "documenting-modules", "business-documenting-modules", "c4-architecture",
    "init-docs-repo", "discovery-assistant", "story-mapping"
  ],
  "workflows": ["docs-system-orchestrator"],
  "agents": ["docs-system-orchestrator"]
}
```

- [ ] **Step 7: Create `registry/bundles/authoring/bundle.json`**

```json
{
  "name": "authoring",
  "version": "1.0.0",
  "description": "Autoría del propio harness y creación de skills (activar solo en el repo agentic-workflow).",
  "scope": "project",
  "dependsOn": ["dev"],
  "skills": ["writing-skills"],
  "workflows": [],
  "agents": []
}
```

- [ ] **Step 8: Create `registry/bundles/personal-notion/bundle.json`**

```json
{
  "name": "personal-notion",
  "version": "1.0.0",
  "description": "Módulos personales de NotionTracker (anclados a MCP).",
  "scope": "ambient",
  "visibility": "private",
  "dependsOn": [],
  "skills": ["career-goal-brainstorm", "cristalizar-proceso", "agregar-nodos-proceso"],
  "workflows": [],
  "agents": []
}
```

- [ ] **Step 9: Delete `registry/processes.json`**

Run: `git rm registry/processes.json`

- [ ] **Step 10: Run test to verify it passes**

Run: `cd cli && npx jest tests/registry/catalog-consistency.test.ts`
Expected: PASS — 5 bundles, 44 skills particionadas, processes.json eliminado.

> Nota: el reparto debe sumar 44 sin solape (dev 23 + frontend 6 + docs 11 + authoring 1 + personal-notion 3). Si el test de partición falla, revisar que ninguna skill quedó sin asignar o duplicada.

- [ ] **Step 11: Commit**

```bash
git add registry/catalog.json registry/bundles cli/tests/registry/catalog-consistency.test.ts
git rm registry/processes.json
git commit -m "feat(registry): introduce catalog + 5 bundles, remove processes.json"
```

---

## Task 4: Adaptar registry-view.ts a BundleDefinition + visibility

**Files:**
- Modify: `cli/src/utils/registry-view.ts`
- Test: `cli/tests/utils/registry-view.test.ts:1-11` (imports y fixtures)

- [ ] **Step 1: Update the test fixtures and add a visibility test**

Reemplaza el import y el fixture `processes` en `cli/tests/utils/registry-view.test.ts`:

```ts
// top of file
import { buildPackageView, STANDALONE_NAME, packageSummaryLines, packageDetailLines, findPackage, artifactCountLabel, ALL_SENTINEL, buildLevel1Options, buildLevel2Options, resolveLevel2Selection } from '../../src/utils/registry-view';
import { SkillArtifact, WorkflowArtifact, AgentArtifact } from '../../src/core/discovery';
import { BundleDefinition } from '../../src/core/bundles';

const skill = (name: string, description = ''): SkillArtifact => ({ name, path: `/s/${name}`, description });
const wf = (name: string, description = ''): WorkflowArtifact => ({ name, path: `/w/${name}.md`, description });
const agent = (name: string, description = ''): AgentArtifact => ({ name, path: `/a/${name}.md`, description });

const bundle = (over: Partial<BundleDefinition> & { name: string }): BundleDefinition => ({
    description: '', version: '1.0.0', scope: 'project', visibility: 'public',
    dependsOn: [], skills: [], workflows: [], agents: [], ...over,
});

const processes: BundleDefinition[] = [
    bundle({ name: 'core-dev', description: 'Dev lifecycle', scope: 'baseline',
        skills: [{ name: 'brainstorming', onSignal: false }, { name: 'shared', onSignal: false }],
        workflows: ['exec'], agents: ['plan'] }),
    bundle({ name: 'docs', description: 'Docs as code',
        skills: [{ name: 'shared', onSignal: false }] }),
];
```

Y añade al final del archivo un bloque nuevo:

```ts
describe('visibility', () => {
    it('marks a private bundle on its PackageView', () => {
        const priv: BundleDefinition[] = [
            bundle({ name: 'secret', description: 'private', visibility: 'private',
                skills: [{ name: 'a', onSignal: false }] }),
        ];
        const view = buildPackageView([skill('a')], [], [], priv);
        expect(view.find((p) => p.name === 'secret')!.visibility).toBe('private');
    });

    it('defaults visibility to public', () => {
        const view = buildPackageView([skill('brainstorming')], [], [], processes);
        expect(view.find((p) => p.name === 'core-dev')!.visibility).toBe('public');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/utils/registry-view.test.ts`
Expected: FAIL — `buildPackageView` espera `ProcessDefinition[]` y `PackageView` no tiene `visibility`.

- [ ] **Step 3: Update `registry-view.ts`**

Cambia el import (línea 3) y la firma/lógica de `buildPackageView`, y añade `visibility` a `PackageView`:

```ts
// line 3
import { BundleDefinition } from '../core/bundles';
```

```ts
// PackageView interface — add visibility
export interface PackageView {
    name: string;
    description: string;
    isStandalone: boolean;
    visibility: 'public' | 'private';
    artifacts: ArtifactView[];
    counts: { skills: number; workflows: number; agents: number };
}
```

```ts
// makePackage — add visibility param
function makePackage(name: string, description: string, isStandalone: boolean, visibility: 'public' | 'private', artifacts: ArtifactView[]): PackageView {
    return {
        name, description, isStandalone, visibility, artifacts,
        counts: {
            skills: artifacts.filter((a) => a.type === 'skill').length,
            workflows: artifacts.filter((a) => a.type === 'workflow').length,
            agents: artifacts.filter((a) => a.type === 'agent').length,
        },
    };
}
```

```ts
// buildPackageView — accept BundleDefinition[], match by skill ref name
export function buildPackageView(
    skills: SkillArtifact[],
    workflows: WorkflowArtifact[],
    agents: AgentArtifact[],
    bundles: BundleDefinition[]
): PackageView[] {
    const all: ArtifactView[] = [
        ...skills.map((s) => ({ name: s.name, type: 'skill' as ArtifactType, sourcePath: s.path, installName: s.name, description: s.description ?? '' })),
        ...workflows.map((w) => ({ name: w.name, type: 'workflow' as ArtifactType, sourcePath: w.path, installName: `${w.name}.md`, description: w.description ?? '' })),
        ...agents.map((a) => ({ name: a.name, type: 'agent' as ArtifactType, sourcePath: a.path, installName: `${a.name}.md`, description: a.description ?? '' })),
    ];

    const packages: PackageView[] = [];
    const claimed = new Set<ArtifactView>();

    for (const b of bundles) {
        const skillNames = b.skills.map((s) => s.name);
        const arts = all.filter((a) =>
            (a.type === 'skill' && skillNames.includes(a.name)) ||
            (a.type === 'workflow' && b.workflows.includes(a.name)) ||
            (a.type === 'agent' && b.agents.includes(a.name))
        );
        if (arts.length === 0) continue;
        arts.forEach((a) => claimed.add(a));
        packages.push(makePackage(b.name, b.description, false, b.visibility, arts));
    }

    const orphans = all.filter((a) => !claimed.has(a));
    if (orphans.length > 0) {
        packages.push(makePackage(STANDALONE_NAME, 'Artifacts not part of any package', true, 'public', orphans));
    }

    return packages;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/utils/registry-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/utils/registry-view.ts cli/tests/utils/registry-view.test.ts
git commit -m "refactor(cli): registry-view consumes BundleDefinition + carries visibility"
```

---

## Task 5: Adaptar grouping.ts a BundleDefinition

**Files:**
- Modify: `cli/src/utils/grouping.ts`
- Test: `cli/tests/utils/grouping.test.ts`

- [ ] **Step 1: Update the test fixtures**

En `cli/tests/utils/grouping.test.ts`, reemplaza el import de `ProcessDefinition` y el fixture de processes por bundles (mismo patrón que Task 4: `BundleDefinition` con `skills: [{name, onSignal:false}]`). Mantén los casos existentes.

```ts
import { BundleDefinition } from '../../src/core/bundles';

const bundle = (over: Partial<BundleDefinition> & { name: string }): BundleDefinition => ({
    description: '', version: '1.0.0', scope: 'project', visibility: 'public',
    dependsOn: [], skills: [], workflows: [], agents: [], ...over,
});

const processes: BundleDefinition[] = [
    bundle({ name: 'core-dev', description: 'Dev', skills: [{ name: 'brainstorming', onSignal: false }], workflows: ['exec'], agents: ['plan'] }),
];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/utils/grouping.test.ts`
Expected: FAIL — type mismatch en `buildGroupedOptions` (espera `ProcessDefinition[]`, y `p.skills.includes` ya no aplica a refs).

- [ ] **Step 3: Update `grouping.ts`**

```ts
// line 2
import { BundleDefinition } from '../core/bundles';
```

Cambia la firma y el matching de skills por ref en `buildGroupedOptions`:

```ts
export function buildGroupedOptions<T extends GroupableArtifact>(
    artifacts: T[],
    bundles: BundleDefinition[],
    formatLabel: (c: CombinedArtifact) => string
): { value: any; label: string; hint?: string }[] {
    // ...inside the loop, replace process matching:
    for (const p of bundles) {
        const skillNames = p.skills.map((s) => s.name);
        if ((a.type === 'skill' && skillNames.includes(baseName)) ||
            (a.type === 'workflow' && p.workflows.includes(baseName)) ||
            (a.type === 'agent' && p.agents.includes(baseName))) {
            // ...unchanged grouping body...
        }
    }
```

Y donde se renombre la variable local de `processes` a `bundles`, ajustar `const proc = bundles.find(p => p.name === procName)!;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/utils/grouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/utils/grouping.ts cli/tests/utils/grouping.test.ts
git commit -m "refactor(cli): grouping consumes BundleDefinition"
```

---

## Task 6: discovery.ts — eliminar processes (corte limpio)

**Files:**
- Modify: `cli/src/core/discovery.ts:9,29-35,116-124`
- Test: `cli/tests/core/discovery.test.ts`

- [ ] **Step 1: Update the discovery test**

En `cli/tests/core/discovery.test.ts`, elimina cualquier `describe`/`it` que pruebe `discoverProcesses` o importe `ProcessDefinition`/`PROCESSES_FILE`. (Mantén los tests de `discoverSkills`/`discoverWorkflows`/`discoverAgents`/`readArtifactDescription`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/core/discovery.test.ts`
Expected: FAIL (compilación) si quedan referencias; o PASS si ya no hay referencias. Si PASS, continúa igual con Step 3 para borrar el código fuente muerto.

- [ ] **Step 3: Remove dead code from `discovery.ts`**

Elimina de `cli/src/core/discovery.ts`:
- La línea 9: `export const PROCESSES_FILE = ...`
- La interfaz `ProcessDefinition` (líneas 29-35).
- La función `discoverProcesses` (líneas 116-124).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/core/discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/discovery.ts cli/tests/core/discovery.test.ts
git commit -m "refactor(cli): remove processes discovery (clean cut)"
```

---

## Task 7: Wire index.ts — add/list/remove usan bundles; list filtra private

**Files:**
- Modify: `cli/src/index.ts:11,73,287,405` (imports y usos)

- [ ] **Step 1: Update imports**

```ts
// line 11 — drop discoverProcesses
import { discoverSkills, discoverWorkflows, discoverAgents } from './core/discovery';
// add bundles import
import { discoverBundles, BundleDefinition } from './core/bundles';
```

- [ ] **Step 2: Replace `discoverProcesses()` calls**

En `add` (línea ~73): `const processes = discoverProcesses();` → `const bundles = discoverBundles();` y ajusta el uso en `buildPackageView(..., processes)` → `buildPackageView(..., bundles)` y el guard `processes.length` → `bundles.length`.

En `list` (línea ~287): `buildPackageView(discoverSkills(), discoverWorkflows(), discoverAgents(), discoverProcesses())` → `... discoverBundles())`.

En `remove` (línea ~405): `const processes = discoverProcesses();` → `const bundles = discoverBundles();` y `buildGroupedOptions(installed, processes, ...)` → `buildGroupedOptions(installed, bundles, ...)`.

- [ ] **Step 3: Add private filtering to `list`**

En el comando `list`, justo después de construir `view` (línea ~287), filtra los privados salvo `--all`:

```ts
const fullView = buildPackageView(discoverSkills(), discoverWorkflows(), discoverAgents(), discoverBundles());
const view = options.all ? fullView : fullView.filter((p) => p.visibility !== 'private');
```

(Cuando se pide un `packageName` explícito, usar `fullView` para poder mostrar un bundle privado por nombre.)

- [ ] **Step 4: Build to verify types**

Run: `cd cli && npm run build`
Expected: compila sin errores de tipo.

- [ ] **Step 5: Manual smoke (lectura local del registry)**

> `awm list` sincroniza el registry remoto; para verificar localmente sin remoto, basta con el build verde + la suite de tests. El comportamiento de `list`/`add` queda cubierto por los tests de `registry-view`/`grouping`.

- [ ] **Step 6: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(cli): wire add/list/remove to bundles; list hides private bundles"
```

---

## Task 8: Reescribir using-awm a política por niveles

**Files:**
- Modify: `registry/skills/using-awm/SKILL.md`
- Test: `cli/tests/registry/using-awm.test.ts:26-30`

- [ ] **Step 1: Update the using-awm test**

Reemplaza el test "contains the imperative bootstrap rule (1% pattern)" (líneas 26-30) por:

```ts
    it('uses tiered triggering (no blanket 1% mandate)', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).not.toMatch(/1%/);
        expect(content).toMatch(/always|siempre/i);      // spine/gates always considered
        expect(content).toMatch(/signal|señal/i);        // specialized only on clear signal
    });
```

(Mantén intactos los otros tests: frontmatter, no `model:`, SUBAGENT-STOP, development-process.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cli && npx jest tests/registry/using-awm.test.ts`
Expected: FAIL — el SKILL.md aún contiene "1%".

- [ ] **Step 3: Rewrite the triggering policy in `registry/skills/using-awm/SKILL.md`**

Reemplaza el bloque imperativo del "1%" por una política por niveles. El nuevo texto debe:
- Eliminar toda mención a "1%" y "MUST invoke" general.
- Definir dos niveles:
  - **Espina/gates (always considered)**: las skills de proceso y calidad (development-process, brainstorming, writing-plans, executing-plans, subagent-driven-development, test-driven-development, requesting/receiving-code-review, post-implementation-qa, finishing-a-development-branch, verification-before-completion, systematic-debugging) se consideran **siempre** al iniciar/avanzar trabajo de desarrollo.
  - **Especializadas (on signal)**: las demás (advisory, frontend, docs, etc.) se invocan **solo ante señal clara** del contexto (p. ej. hablar de arquitectura → architecture-advisor; configurar CI → cicd-proposal-builder; trabajar UI → skills de frontend).
- Conservar: el bloque `<SUBAGENT-STOP>`, la prioridad de instrucciones (usuario > skills > sistema), y la referencia a `development-process` como orquestador por defecto.

Texto sugerido para la sección de disparo (reemplaza la sección "## The Rule"/"1%"):

```markdown
## La regla (por niveles)

No toda skill compite por tu atención por igual. Aplica dos niveles:

**Espina y gates — considéralas siempre.** Las skills de proceso y de calidad
(`development-process`, `brainstorming`, `writing-plans`, `executing-plans`,
`subagent-driven-development`, `test-driven-development`,
`requesting-code-review`, `receiving-code-review`, `post-implementation-qa`,
`finishing-a-development-branch`, `verification-before-completion`,
`systematic-debugging`) forman la disciplina del desarrollo: evalúalas en todo
trabajo de desarrollo. Tu entrada por defecto es `development-process`.

**Especializadas — solo ante señal clara.** Las demás skills (advisory de
arquitectura/CI/NFR, frontend, documentación, etc.) se invocan **únicamente
cuando el contexto lo pide explícitamente** (hablas de arquitectura, configuras
un pipeline, trabajas una pantalla UI, documentas un módulo…). No las invoques
"por si acaso": esperar la señal evita ruido y carga innecesaria.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cli && npx jest tests/registry/using-awm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add registry/skills/using-awm/SKILL.md cli/tests/registry/using-awm.test.ts
git commit -m "feat(registry): rewrite using-awm to tiered triggering policy"
```

---

## Task 9: Verificación final (suite completa + build)

**Files:** ninguno (verificación).

- [ ] **Step 1: Run the full test suite**

Run: `cd cli && npm test`
Expected: PASS — todos los suites verdes (incluye los modificados de registry-view, grouping, discovery, using-awm y los nuevos bundles, catalog-consistency, skill-versions).

- [ ] **Step 2: Build**

Run: `cd cli && npm run build`
Expected: compila limpio, `dist/src/index.js` ejecutable.

- [ ] **Step 3: Grep de referencias muertas**

Run: `cd cli && grep -rn "discoverProcesses\|ProcessDefinition\|processes.json\|PROCESSES_FILE" src tests`
Expected: sin resultados (corte limpio completo).

- [ ] **Step 4: Commit (si hubo ajustes)**

```bash
git add -A
git commit -m "chore(cli): finalize phase 1a bundles migration"
```

---

## Self-Review (cobertura del spec)

- **§4.1/§4.2 (catalog + 5 bundles, reparto 44)** → Task 3 (+ consistency test que valida partición y mirror).
- **§4.1 version por skill** → Task 1.
- **§4.1 skills como refs `{name,onSignal}`** → Task 2 (`normalizeSkillRefs`).
- **§3 dependsOn (sin rangos)** → Task 2 (`resolveBundleSkills`).
- **§5.2 visibility private en list** → Tasks 4 + 7.
- **D3 corte limpio de processes.json** → Tasks 3 (delete) + 6 (código) + 9 (grep).
- **§6.1 version informativa** → Task 1 (sin resolver de rangos: correcto para 1a).
- **§6.2 using-awm tiered** → Task 8. *(Anotación de menú `onSignal` en el hook: diferida explícitamente; `onSignal` se persiste como dato en Task 3.)*
- **Type consistency**: `BundleDefinition`/`BundleSkillRef` definidos en Task 2 y usados igual en Tasks 4/5/7; `discoverBundles`/`resolveBundleSkills`/`readCatalog` con firmas estables.

**Fuera de alcance confirmado (no son gaps):** activación por proyecto/profile/sync (1b), `awm doctor` (1c), `awm init` (1d), sources externos (Fase 4), resolver de rangos y tags (Fase 2).
```
