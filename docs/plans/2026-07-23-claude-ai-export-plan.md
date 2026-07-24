# `awm export --target claude-ai` — Implementation Plan

<!-- awm-qa-complete: 2026-07-23 -->
<!-- awm-retro-complete: 2026-07-23 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comando `awm export <nombre>` que genera artefactos subibles a claude.ai (carpeta + zip) desde el registry instalado, con gate de portabilidad y adaptación mecánica/override.

**Architecture:** Motor puro en `cli/src/core/export/` (types, transform, resolve, pack, orquestación) + comando delgado en `cli/src/commands/export.ts` registrado en `cli/src/index.ts`. Reutiliza `discoverAllBundles`/`resolveBundleSkills` de `core/bundles.ts` y `contentRoots()` de `core/registries.ts`. Zip por capas vía binario del sistema con inyección testeable.

**Tech Stack:** TypeScript, commander, picocolors, jest (ts-jest, `--runInBand`), Node `fs`/`child_process` — cero dependencias nuevas.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

**Diseño:** `docs/plans/2026-07-23-claude-ai-export-design.md` (issue [agentic-workflow#9](https://github.com/Kodria/agentic-workflow/issues/9)). R6 (PR de contenido en `awm-baseline-registry`) queda explícitamente FUERA de este plan.

---

### Task 1: `transform.ts` — transform mecánico puro

_Requirements: R3.1, R3.4_

**Files:**
- Create: `cli/src/core/export/types.ts`
- Create: `cli/src/core/export/transform.ts`
- Test: `cli/tests/core/export/transform.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// cli/tests/core/export/transform.test.ts
import { claudeAiTransform, DEFERENCE_LINE } from '../../../src/core/export/transform';

const FM = (lines: string[]) => `---\n${lines.join('\n')}\n---\nBody line.\n`;

describe('claudeAiTransform', () => {
    it('strips version and portable, keeps other keys and body intact', () => {  // verifies R3.1
        const input = FM(['name: mermaid-diagrams', 'version: "1.0.0"', 'portable: true', 'description: "Guide."']);
        const out = claudeAiTransform(input, 'mermaid-diagrams');
        expect(out).not.toMatch(/^version:/m);
        expect(out).not.toMatch(/^portable:/m);
        expect(out).toMatch(/^name: mermaid-diagrams$/m);
        expect(out).toContain('Body line.\n');
    });

    it('appends the deference line inside a quoted description', () => {  // verifies R3.1
        const input = FM(['name: x', 'portable: true', 'description: "Does things."']);
        const out = claudeAiTransform(input, 'x');
        expect(out).toContain(`description: "Does things. ${DEFERENCE_LINE('x')}"`);
    });

    it('appends the deference line to an unquoted description', () => {  // verifies R3.1
        const input = FM(['name: x', 'portable: true', 'description: Does things.']);
        const out = claudeAiTransform(input, 'x');
        expect(out).toContain(`description: Does things. ${DEFERENCE_LINE('x')}`);
    });

    it('throws on missing frontmatter block', () => {  // verifies R3.4
        expect(() => claudeAiTransform('No frontmatter here.', 'x')).toThrow(/frontmatter/);
    });

    it('throws on frontmatter without description', () => {  // verifies R3.4
        expect(() => claudeAiTransform(FM(['name: x', 'portable: true']), 'x')).toThrow(/description/);
    });

    it('throws on multi-line (block scalar) description', () => {  // verifies R3.4
        expect(() => claudeAiTransform(FM(['name: x', 'description: >', '  folded text']), 'x')).toThrow(/single-line/);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/export/transform.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/export/transform'`

- [ ] **Step 3: Write types + implementation**

```ts
// cli/src/core/export/types.ts
//
// Tipos compartidos del motor de export (issue #9).
export interface ResolvedSkill {
    name: string;
    /** Ruta absoluta a skills/<name> en su content root. */
    dir: string;
    portable: boolean;
    /** Ruta a port.claude-ai.md si existe, null si no. */
    overridePath: string | null;
}

export interface ExportResolution {
    kind: 'bundle' | 'skill';
    requested: string;
    /** Solo las skills portables — las que se exportan. */
    skills: ResolvedSkill[];
    /** Modo bundle: nombres omitidos por no portables (visibles, R2.2). */
    skipped: string[];
}

/** Resultado del intento de zip: ok, o binario ausente (fallback R4.2). */
export interface ZipResult {
    ok: boolean;
    missing: boolean;
}
export type ZipFn = (cwd: string, zipName: string, folderName: string) => ZipResult;

export interface ExportSummary {
    /** Directorio target: <out>/claude-ai */
    outDir: string;
    exported: Array<{ name: string; dir: string; zip: string | null }>;
    skipped: string[];
    /** false si el binario zip no estaba disponible (imprime instrucción manual). */
    zipAvailable: boolean;
}
```

```ts
// cli/src/core/export/transform.ts
//
// Transform mecánico claude.ai (R3.1): función pura string → string.
// Frontmatter line-based plano (los SKILL.md del baseline usan claves de una
// línea) — sin parser YAML a propósito (YAGNI, cero deps).
export const DEFERENCE_LINE = (skillName: string): string =>
    `In environments with AWM installed (Claude Code), defer to the registry's ${skillName} skill — this port is for environments without filesystem access.`;

export function claudeAiTransform(skillMd: string, skillName: string): string {
    if (!skillMd.startsWith('---\n')) {
        throw new Error('missing frontmatter block (file must start with ---)');
    }
    const end = skillMd.indexOf('\n---\n', 4);
    if (end === -1) {
        throw new Error('unterminated frontmatter block (closing --- not found)');
    }
    const body = skillMd.slice(end + '\n---\n'.length);
    const fmLines = skillMd.slice(4, end).split('\n')
        .filter((l) => !/^(version|portable):/.test(l));

    const descIdx = fmLines.findIndex((l) => /^description:/.test(l));
    if (descIdx === -1) {
        throw new Error('frontmatter has no description field');
    }
    const descLine = fmLines[descIdx];
    const value = descLine.slice('description:'.length).trim();
    if (value === '' || value === '>' || value === '|' || value.startsWith('>') || value.startsWith('|')) {
        throw new Error('description must be single-line (block scalars are not supported by the export transform)');
    }
    const deference = DEFERENCE_LINE(skillName);
    fmLines[descIdx] = descLine.endsWith('"')
        ? `${descLine.slice(0, -1)} ${deference}"`
        : `${descLine} ${deference}`;

    return `---\n${fmLines.join('\n')}\n---\n${body}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx jest tests/core/export/transform.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/export/types.ts cli/src/core/export/transform.ts cli/tests/core/export/transform.test.ts
git commit -m "feat(export): claude-ai mechanical transform — pure function, line-based frontmatter (#9)"
```

---

### Task 2: `resolve.ts` — resolución bundle/skill + gate de portabilidad

_Requirements: R1, R1.1, R1.2, R2, R2.1, R2.2, R2.3, R3.3_

**Files:**
- Create: `cli/src/core/export/resolve.ts`
- Test: `cli/tests/core/export/resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// cli/tests/core/export/resolve.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveExport } from '../../../src/core/export/resolve';

/** Content root falso: catalog + bundle dev + 3 skills. */
function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-export-root-'));
    fs.mkdirSync(path.join(root, 'bundles/dev'), { recursive: true });
    fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [{ name: 'dev', source: './bundles/dev', version: '1.0.0', scope: 'baseline' }],
    }));
    fs.writeFileSync(path.join(root, 'bundles/dev/bundle.json'), JSON.stringify({
        name: 'dev', version: '1.0.0', scope: 'baseline', dependsOn: [],
        skills: ['proc-skill', { name: 'mermaid', onSignal: true }, { name: 'ported', onSignal: true }],
        workflows: [], agents: [],
    }));
    const mk = (name: string, fm: string[]) => {
        const dir = path.join(root, 'skills', name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm.join('\n')}\n---\nBody.\n`);
        return dir;
    };
    mk('proc-skill', ['name: proc-skill', 'description: "Process skill."']); // NO portable
    mk('mermaid', ['name: mermaid', 'portable: true', 'description: "Diagrams."']);
    const ported = mk('ported', ['name: ported', 'portable: true', 'description: "Ported."']);
    fs.writeFileSync(path.join(ported, 'port.claude-ai.md'), '---\nname: ported\ndescription: "Custom."\n---\nCustom body.\n');
    return root;
}

describe('resolveExport', () => {
    let root: string;
    beforeEach(() => { root = makeRoot(); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('resolves a bundle: portable skills in, non-portable listed as skipped', () => {  // verifies R1, R2, R2.2
        const res = resolveExport('dev', [root]);
        expect(res.kind).toBe('bundle');
        expect(res.skills.map((s) => s.name).sort()).toEqual(['mermaid', 'ported']);
        expect(res.skipped).toEqual(['proc-skill']);
    });

    it('detects the override path when present', () => {  // verifies R3 (input for)
        const res = resolveExport('dev', [root]);
        const ported = res.skills.find((s) => s.name === 'ported')!;
        expect(ported.overridePath).toBe(path.join(root, 'skills/ported/port.claude-ai.md'));
        const mermaid = res.skills.find((s) => s.name === 'mermaid')!;
        expect(mermaid.overridePath).toBeNull();
    });

    it('resolves an individual portable skill', () => {  // verifies R1.1
        const res = resolveExport('mermaid', [root]);
        expect(res.kind).toBe('skill');
        expect(res.skills).toHaveLength(1);
        expect(res.skipped).toEqual([]);
    });

    it('fails on an explicitly requested non-portable skill', () => {  // verifies R2.1
        expect(() => resolveExport('proc-skill', [root])).toThrow(/portable/);
    });

    it('fails on unknown name, listing available bundles', () => {  // verifies R1.2
        expect(() => resolveExport('nope', [root])).toThrow(/dev/);
    });

    it('fails when a bundle has zero portable skills', () => {  // verifies R2.3
        fs.writeFileSync(path.join(root, 'skills/mermaid/SKILL.md'), '---\nname: mermaid\ndescription: "D."\n---\nB.\n');
        fs.writeFileSync(path.join(root, 'skills/ported/SKILL.md'), '---\nname: ported\ndescription: "P."\n---\nB.\n');
        fs.rmSync(path.join(root, 'skills/ported/port.claude-ai.md'));
        expect(() => resolveExport('dev', [root])).toThrow(/no portable skills/i);
    });

    it('fails on override without portable: true (inconsistent metadata)', () => {  // verifies R3.3
        fs.writeFileSync(path.join(root, 'skills/ported/SKILL.md'), '---\nname: ported\ndescription: "P."\n---\nB.\n');
        expect(() => resolveExport('ported', [root])).toThrow(/inconsistent/i);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/export/resolve.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/export/resolve'`

- [ ] **Step 3: Write the implementation**

```ts
// cli/src/core/export/resolve.ts
//
// Resolución <nombre> → skills a exportar (R1/R1.1) con gate de portabilidad
// (R2.x) y consistencia de override (R3.3). Lee SIEMPRE de content roots del
// registry instalado (R1.4) — nunca de ~/.claude/skills.
import fs from 'fs';
import path from 'path';
import { discoverAllBundles, resolveBundleSkills } from '../bundles';
import { ExportResolution, ResolvedSkill } from './types';

const OVERRIDE_FILE = 'port.claude-ai.md';

/** portable: true en el frontmatter (bloque --- inicial), línea plana. */
function isPortable(skillMd: string): boolean {
    if (!skillMd.startsWith('---\n')) return false;
    const end = skillMd.indexOf('\n---\n', 4);
    if (end === -1) return false;
    return /^portable:\s*true\s*$/m.test(skillMd.slice(4, end));
}

function locate(skillName: string, roots: string[]): ResolvedSkill | null {
    for (const root of roots) {
        const dir = path.join(root, 'skills', skillName);
        const skillFile = path.join(dir, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        const overridePath = fs.existsSync(path.join(dir, OVERRIDE_FILE))
            ? path.join(dir, OVERRIDE_FILE) : null;
        return { name: skillName, dir, portable: isPortable(fs.readFileSync(skillFile, 'utf-8')), overridePath };
    }
    return null;
}

/** R3.3: un override declara intención de export; sin portable es contrato a medias. */
function assertOverrideConsistency(s: ResolvedSkill): void {
    if (s.overridePath && !s.portable) {
        throw new Error(
            `Inconsistent metadata for skill "${s.name}": ${OVERRIDE_FILE} exists but SKILL.md does not declare portable: true.`
        );
    }
}

export function resolveExport(requested: string, roots: string[]): ExportResolution {
    const bundles = discoverAllBundles(roots);

    if (bundles.some((b) => b.name === requested)) {
        const skills: ResolvedSkill[] = [];
        const skipped: string[] = [];
        for (const name of resolveBundleSkills(requested, bundles)) {
            const s = locate(name, roots);
            if (!s) throw new Error(`Bundle "${requested}" lists skill "${name}" but no content root contains skills/${name}/SKILL.md.`);
            assertOverrideConsistency(s);
            if (s.portable) skills.push(s);
            else skipped.push(s.name);
        }
        if (skills.length === 0) {
            throw new Error(`Bundle "${requested}" has no portable skills — nothing to export. Mark skills with portable: true in their frontmatter.`);
        }
        return { kind: 'bundle', requested, skills, skipped: skipped.sort() };
    }

    const single = locate(requested, roots);
    if (!single) {
        const available = bundles.map((b) => b.name).join(', ') || '(none)';
        throw new Error(`"${requested}" is neither a bundle nor a skill in any content root. Available bundles: ${available}.`);
    }
    assertOverrideConsistency(single);
    if (!single.portable) {
        throw new Error(
            `Skill "${requested}" is not portable (no portable: true in its frontmatter) — it likely depends on filesystem/git and would break on claude.ai.`
        );
    }
    return { kind: 'skill', requested, skills: [single], skipped: [] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx jest tests/core/export/resolve.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/export/resolve.ts cli/tests/core/export/resolve.test.ts
git commit -m "feat(export): bundle/skill resolution with portability gate and override consistency (#9)"
```

---

### Task 3: `pack.ts` — escritura determinística + zip por capas

_Requirements: R3.2, R4, R4.1, R4.2_

**Files:**
- Create: `cli/src/core/export/pack.ts`
- Test: `cli/tests/core/export/pack.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// cli/tests/core/export/pack.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { packSkill, defaultZip } from '../../../src/core/export/pack';
import { ZipFn } from '../../../src/core/export/types';

const okZip: ZipFn = (cwd, zipName) => {
    fs.writeFileSync(path.join(cwd, zipName), 'fake-zip');
    return { ok: true, missing: false };
};
const missingZip: ZipFn = () => ({ ok: false, missing: true });

describe('packSkill', () => {
    let src: string;
    let out: string;
    beforeEach(() => {
        src = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-src-'));
        out = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-out-'));
        fs.writeFileSync(path.join(src, 'SKILL.md'), 'canonical');
        fs.mkdirSync(path.join(src, 'references'));
        fs.writeFileSync(path.join(src, 'references/a.md'), 'ref-A bytes');
    });
    afterEach(() => {
        fs.rmSync(src, { recursive: true, force: true });
        fs.rmSync(out, { recursive: true, force: true });
    });

    it('writes adapted SKILL.md and byte-identical references', () => {  // verifies R3.2, R4
        const r = packSkill({ name: 'x', adaptedSkillMd: 'adapted', srcDir: src, targetRoot: out, zip: okZip });
        expect(fs.readFileSync(path.join(out, 'x/SKILL.md'), 'utf-8')).toBe('adapted');
        expect(fs.readFileSync(path.join(out, 'x/references/a.md'), 'utf-8')).toBe('ref-A bytes');
        expect(r.zip).toBe(path.join(out, 'x.zip'));
    });

    it('re-export cleans its own subtree first (stale files gone)', () => {  // verifies R4
        fs.mkdirSync(path.join(out, 'x'), { recursive: true });
        fs.writeFileSync(path.join(out, 'x/stale.md'), 'old');
        fs.writeFileSync(path.join(out, 'x.zip'), 'old-zip');
        packSkill({ name: 'x', adaptedSkillMd: 'adapted', srcDir: src, targetRoot: out, zip: missingZip });
        expect(fs.existsSync(path.join(out, 'x/stale.md'))).toBe(false);
        expect(fs.existsSync(path.join(out, 'x.zip'))).toBe(false);
    });

    it('falls back to folder-only when zip binary is missing', () => {  // verifies R4.2
        const r = packSkill({ name: 'x', adaptedSkillMd: 'adapted', srcDir: src, targetRoot: out, zip: missingZip });
        expect(r.zip).toBeNull();
        expect(r.zipMissing).toBe(true);
        expect(fs.existsSync(path.join(out, 'x/SKILL.md'))).toBe(true);
    });

    it('skill without references/ packs SKILL.md alone', () => {  // verifies R4
        fs.rmSync(path.join(src, 'references'), { recursive: true });
        packSkill({ name: 'x', adaptedSkillMd: 'adapted', srcDir: src, targetRoot: out, zip: okZip });
        expect(fs.existsSync(path.join(out, 'x/references'))).toBe(false);
    });
});

describe('defaultZip (system binary, layered)', () => {
    it('produces a real zip when the binary exists, or reports missing', () => {  // verifies R4.1, R4.2
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-zip-'));
        fs.mkdirSync(path.join(cwd, 'folder'));
        fs.writeFileSync(path.join(cwd, 'folder/f.txt'), 'x');
        const r = defaultZip(cwd, 'folder.zip', 'folder');
        if (r.missing) {
            expect(fs.existsSync(path.join(cwd, 'folder.zip'))).toBe(false);  // degrade limpio
        } else {
            expect(r.ok).toBe(true);
            expect(fs.existsSync(path.join(cwd, 'folder.zip'))).toBe(true);
        }
        fs.rmSync(cwd, { recursive: true, force: true });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/export/pack.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/export/pack'`

- [ ] **Step 3: Write the implementation**

```ts
// cli/src/core/export/pack.ts
//
// Escritura determinística del artefacto (R4: limpia su propio subárbol antes
// de escribir) + zip por capas con binario del sistema (R4.1/R4.2). ZipFn es
// inyectable para tests.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ZipFn, ZipResult } from './types';

/** Capa 1: binario `zip` del sistema. ENOENT → missing (capa 2: carpeta). */
export const defaultZip: ZipFn = (cwd, zipName, folderName): ZipResult => {
    const r = spawnSync('zip', ['-r', '-q', zipName, folderName], { cwd });
    if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, missing: true };
    }
    return { ok: r.status === 0, missing: false };
};

export interface PackSkillOptions {
    name: string;
    adaptedSkillMd: string;
    /** skills/<name> canónico — fuente de references/. */
    srcDir: string;
    /** <out>/claude-ai */
    targetRoot: string;
    zip?: ZipFn;
}

export function packSkill(opts: PackSkillOptions): { dir: string; zip: string | null; zipMissing: boolean } {
    const zip = opts.zip ?? defaultZip;
    const skillOut = path.join(opts.targetRoot, opts.name);
    const zipPath = path.join(opts.targetRoot, `${opts.name}.zip`);

    // R4: determinismo — el re-export limpia su propio subárbol primero.
    fs.rmSync(skillOut, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    fs.mkdirSync(skillOut, { recursive: true });

    fs.writeFileSync(path.join(skillOut, 'SKILL.md'), opts.adaptedSkillMd);
    const refs = path.join(opts.srcDir, 'references');
    if (fs.existsSync(refs)) {
        fs.cpSync(refs, path.join(skillOut, 'references'), { recursive: true });  // R3.2 byte-idéntico
    }

    const zr = zip(opts.targetRoot, `${opts.name}.zip`, opts.name);
    if (zr.missing) return { dir: skillOut, zip: null, zipMissing: true };
    if (!zr.ok) throw new Error(`zip failed for skill "${opts.name}" (non-zero exit).`);
    return { dir: skillOut, zip: zipPath, zipMissing: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx jest tests/core/export/pack.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/export/pack.ts cli/tests/core/export/pack.test.ts
git commit -m "feat(export): deterministic artifact writer with layered system-zip (#9)"
```

---

### Task 4: `index.ts` del motor — orquestación `runExport`

_Requirements: R1.3, R1.4, R3, R3.4, R5.2 (+ integración de R1-R4)_

**Files:**
- Create: `cli/src/core/export/index.ts`
- Test: `cli/tests/core/export/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// cli/tests/core/export/engine.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runExport, EXPORT_TARGETS } from '../../../src/core/export';
import { ZipFn } from '../../../src/core/export/types';

const okZip: ZipFn = (cwd, zipName) => {
    fs.writeFileSync(path.join(cwd, zipName), 'fake-zip');
    return { ok: true, missing: false };
};

/** Mismo fixture que resolve.test.ts (root falso con bundle dev + 3 skills). */
function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-engine-root-'));
    fs.mkdirSync(path.join(root, 'bundles/dev'), { recursive: true });
    fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [{ name: 'dev', source: './bundles/dev', version: '1.0.0', scope: 'baseline' }],
    }));
    fs.writeFileSync(path.join(root, 'bundles/dev/bundle.json'), JSON.stringify({
        name: 'dev', version: '1.0.0', scope: 'baseline', dependsOn: [],
        skills: ['proc-skill', { name: 'mermaid', onSignal: true }, { name: 'ported', onSignal: true }],
        workflows: [], agents: [],
    }));
    const mk = (name: string, fm: string[]) => {
        const dir = path.join(root, 'skills', name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm.join('\n')}\n---\nBody of ${name}.\n`);
        return dir;
    };
    mk('proc-skill', ['name: proc-skill', 'description: "Process skill."']);
    const mermaid = mk('mermaid', ['name: mermaid', 'version: "1.0.0"', 'portable: true', 'description: "Diagrams."']);
    fs.mkdirSync(path.join(mermaid, 'references'));
    fs.writeFileSync(path.join(mermaid, 'references/flow.md'), 'flow reference bytes');
    const ported = mk('ported', ['name: ported', 'portable: true', 'description: "Ported."']);
    fs.writeFileSync(path.join(ported, 'port.claude-ai.md'), '---\nname: ported\ndescription: "Custom port."\n---\nOverride body, verbatim.\n');
    return root;
}

describe('runExport (engine end-to-end)', () => {
    let root: string;
    let out: string;
    beforeEach(() => {
        root = makeRoot();
        out = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-engine-out-'));
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(out, { recursive: true, force: true });
    });

    it('exports a bundle: transform for mermaid, verbatim override for ported, skips proc-skill', () => {  // verifies R1, R3, R3.1, R3.2
        const summary = runExport({ name: 'dev', out, roots: [root], zip: okZip });
        expect(summary.exported.map((e) => e.name).sort()).toEqual(['mermaid', 'ported']);
        expect(summary.skipped).toEqual(['proc-skill']);

        const mermaidMd = fs.readFileSync(path.join(out, 'claude-ai/mermaid/SKILL.md'), 'utf-8');
        expect(mermaidMd).not.toMatch(/^version:/m);
        expect(mermaidMd).not.toMatch(/^portable:/m);
        expect(mermaidMd).toContain('defer to the registry');
        expect(fs.readFileSync(path.join(out, 'claude-ai/mermaid/references/flow.md'), 'utf-8')).toBe('flow reference bytes');

        const portedMd = fs.readFileSync(path.join(out, 'claude-ai/ported/SKILL.md'), 'utf-8');
        expect(portedMd).toBe('---\nname: ported\ndescription: "Custom port."\n---\nOverride body, verbatim.\n');  // cero transforms
    });

    it('rejects an unknown target listing the valid ones', () => {  // verifies R1.3
        expect(() => runExport({ name: 'dev', target: 'hermes', out, roots: [root], zip: okZip }))
            .toThrow(new RegExp(EXPORT_TARGETS.join('|')));
    });

    it('wraps transform errors with the offending file path', () => {  // verifies R3.4
        fs.writeFileSync(path.join(root, 'skills/mermaid/SKILL.md'), 'no frontmatter at all');
        expect(() => runExport({ name: 'mermaid', out, roots: [root], zip: okZip }))
            .toThrow(/mermaid[/\\]SKILL\.md/);
    });

    it('reads only the provided roots (never ~/.claude/skills)', () => {  // verifies R1.4
        // La lectura sale exclusivamente de roots: un root vacío no resuelve nada.
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-root-'));
        expect(() => runExport({ name: 'mermaid', out, roots: [empty], zip: okZip })).toThrow(/neither a bundle nor a skill/);
        fs.rmSync(empty, { recursive: true, force: true });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/core/export/engine.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/export'`

- [ ] **Step 3: Write the implementation**

```ts
// cli/src/core/export/index.ts
//
// Orquestación del export (issue #9): resolve → adapt (override verbatim R3,
// o transform mecánico R3.1) → pack. Opera 100% offline (R5.2): solo fs local.
import fs from 'fs';
import path from 'path';
import { contentRoots } from '../registries';
import { resolveExport } from './resolve';
import { claudeAiTransform } from './transform';
import { packSkill } from './pack';
import { ExportSummary, ZipFn } from './types';

export const EXPORT_TARGETS = ['claude-ai'] as const;

export interface RunExportOptions {
    name: string;
    /** Default: claude-ai (único target hoy). */
    target?: string;
    /** Default: ./awm-export */
    out?: string;
    /** Default: contentRoots() del registry instalado (R1.4). Inyectable en tests. */
    roots?: string[];
    zip?: ZipFn;
}

export function runExport(opts: RunExportOptions): ExportSummary {
    const target = opts.target ?? 'claude-ai';
    if (!(EXPORT_TARGETS as readonly string[]).includes(target)) {
        throw new Error(`Unknown export target "${target}". Valid targets: ${EXPORT_TARGETS.join(', ')}.`);
    }
    const roots = opts.roots ?? contentRoots();
    const outDir = path.join(opts.out ?? path.join(process.cwd(), 'awm-export'), target);
    const resolution = resolveExport(opts.name, roots);

    fs.mkdirSync(outDir, { recursive: true });
    const exported: ExportSummary['exported'] = [];
    let zipAvailable = true;
    for (const skill of resolution.skills) {
        let adapted: string;
        if (skill.overridePath) {
            adapted = fs.readFileSync(skill.overridePath, 'utf-8');  // R3: verbatim
        } else {
            const canonical = path.join(skill.dir, 'SKILL.md');
            try {
                adapted = claudeAiTransform(fs.readFileSync(canonical, 'utf-8'), skill.name);
            } catch (e) {
                throw new Error(`${canonical}: ${e instanceof Error ? e.message : String(e)}`);  // R3.4 cita el archivo
            }
        }
        const packed = packSkill({ name: skill.name, adaptedSkillMd: adapted, srcDir: skill.dir, targetRoot: outDir, zip: opts.zip });
        if (packed.zipMissing) zipAvailable = false;
        exported.push({ name: skill.name, dir: packed.dir, zip: packed.zip });
    }
    return { outDir, exported, skipped: resolution.skipped, zipAvailable };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx jest tests/core/export/engine.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/export/index.ts cli/tests/core/export/engine.test.ts
git commit -m "feat(export): engine orchestration — resolve, adapt, pack, offline-only (#9)"
```

---

### Task 5: comando `awm export` + registro en el CLI

_Requirements: R1.3, R2.2, R4.2, R5 (+ superficie de R1)_

**Files:**
- Create: `cli/src/commands/export.ts`
- Modify: `cli/src/index.ts` (import + `registerExportCommand(program)` junto a los demás `registerXCommand`)
- Test: `cli/tests/commands/export.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// cli/tests/commands/export.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runExportCommand } from '../../src/commands/export';
import { ZipFn } from '../../src/core/export/types';

const okZip: ZipFn = (cwd, zipName) => {
    fs.writeFileSync(path.join(cwd, zipName), 'fake-zip');
    return { ok: true, missing: false };
};

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-cmd-root-'));
    fs.mkdirSync(path.join(root, 'bundles/dev'), { recursive: true });
    fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [{ name: 'dev', source: './bundles/dev', version: '1.0.0', scope: 'baseline' }],
    }));
    fs.writeFileSync(path.join(root, 'bundles/dev/bundle.json'), JSON.stringify({
        name: 'dev', version: '1.0.0', scope: 'baseline', dependsOn: [],
        skills: ['proc-skill', { name: 'mermaid', onSignal: true }], workflows: [], agents: [],
    }));
    const mk = (name: string, fm: string[]) => {
        const dir = path.join(root, 'skills', name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm.join('\n')}\n---\nBody.\n`);
    };
    mk('proc-skill', ['name: proc-skill', 'description: "P."']);
    mk('mermaid', ['name: mermaid', 'portable: true', 'description: "D."']);
    return root;
}

describe('runExportCommand (salida al usuario)', () => {
    let root: string;
    let out: string;
    let logs: string[];
    const log = (m: string) => logs.push(m);

    beforeEach(() => {
        root = makeRoot();
        out = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-cmd-out-'));
        logs = [];
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(out, { recursive: true, force: true });
    });

    it('reports exported skills and visible skips', () => {  // verifies R2.2
        runExportCommand('dev', { target: 'claude-ai', out }, { roots: [root], zip: okZip, log });
        const text = logs.join('\n');
        expect(text).toContain('mermaid');
        expect(text).toMatch(/skipped.*proc-skill/i);
    });

    it('prints the manual-zip instruction when the binary is missing', () => {  // verifies R4.2
        const missingZip: ZipFn = () => ({ ok: false, missing: true });
        runExportCommand('dev', { target: 'claude-ai', out }, { roots: [root], zip: missingZip, log });
        expect(logs.join('\n')).toMatch(/zip -r/);
    });

    it('propagates unknown-target errors (commander action will exit(1))', () => {  // verifies R1.3
        expect(() => runExportCommand('dev', { target: 'nope', out }, { roots: [root], zip: okZip, log }))
            .toThrow(/Valid targets/);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cli && npx jest tests/commands/export.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/export'`

- [ ] **Step 3: Write the command implementation**

```ts
// cli/src/commands/export.ts
//
// awm export <nombre> [--target claude-ai] [--out <dir>] — genera artefactos
// subibles a claude.ai desde el registry instalado (issue #9). Comando delgado:
// la lógica vive en core/export.
import { Command } from 'commander';
import pc from 'picocolors';
import path from 'path';
import { runExport, RunExportOptions } from '../core/export';
import { ZipFn } from '../core/export/types';

interface CommandFlags {
    target?: string;
    out?: string;
}

/** Deps inyectables para tests (roots/zip/log); producción usa defaults del motor. */
interface CommandDeps {
    roots?: string[];
    zip?: ZipFn;
    log?: (msg: string) => void;
}

export function runExportCommand(name: string, flags: CommandFlags, deps: CommandDeps = {}): void {
    const log = deps.log ?? console.log;
    const opts: RunExportOptions = {
        name,
        target: flags.target,
        out: flags.out,
        roots: deps.roots,
        zip: deps.zip,
    };
    const summary = runExport(opts);

    for (const e of summary.exported) {
        log(pc.green(`✓ ${e.name}`) + pc.dim(` → ${e.zip ?? e.dir}`));
    }
    if (summary.skipped.length > 0) {
        log(pc.dim(`Skipped (not portable): ${summary.skipped.join(', ')}`));
    }
    if (!summary.zipAvailable) {
        log(pc.yellow('zip binary not found — folders were written without archives.'));
        log(pc.dim(`Compress manually, e.g.: cd ${summary.outDir} && zip -r <skill>.zip <skill>`));
    }
    log(pc.dim(`Output: ${path.resolve(summary.outDir)}`));
}

export function registerExportCommand(program: Command): void {
    program.command('export <name>')
        .description('Export a bundle or skill as claude.ai-uploadable custom skill artifacts (folder + zip)')
        .option('--target <target>', 'export target', 'claude-ai')
        .option('--out <dir>', 'output directory (default: ./awm-export)')
        .action((name: string, flags: CommandFlags) => {
            try {
                runExportCommand(name, flags);
            } catch (e) {
                console.error(pc.red(e instanceof Error ? e.message : String(e)));
                process.exit(1);
            }
        });
}
```

Modificación en `cli/src/index.ts` — junto a los imports de comandos existentes (línea ~32):

```ts
import { registerExportCommand } from './commands/export';
```

y junto a las llamadas `registerPinCommands(program);` (buscar el bloque de `registerXCommand`):

```ts
registerExportCommand(program);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx jest tests/commands/export.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Verify the command registers without breaking the CLI build**

Run: `cd cli && npm run build && node dist/src/index.js export --help`
Expected: build OK + help del comando mostrando `--target` y `--out`

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/export.ts cli/src/index.ts cli/tests/commands/export.test.ts
git commit -m "feat(export): awm export command wired into the CLI (#9)"
```

---

### Task 6: documentación + verificación E2E

_Requirements: R5, R5.1 (verificación de conjunto R1-R5)_

**Files:**
- Modify: `docs/cli-reference.md` (nueva entrada bajo "## Registry & artifacts", después de `### awm update`)

- [ ] **Step 1: Add the CLI reference entry**

Insertar después de la sección `### awm update` (línea ~96-103):

```markdown
### `awm export <name>`

Exports a bundle or an individual skill from the installed registry as claude.ai-uploadable
custom skill artifacts: one folder per skill (`SKILL.md` + `references/`) plus a `.zip`
when the system `zip` binary is available (folder-only fallback otherwise).

- Only skills declaring `portable: true` in their `SKILL.md` frontmatter are exported;
  bundle exports list non-portable skills as skipped, and requesting a non-portable
  skill explicitly is an error.
- If `skills/<name>/port.claude-ai.md` exists in the registry, it is used verbatim;
  otherwise a mechanical transform strips AWM-only frontmatter fields (`version`,
  `portable`) and appends a deference line to the description.
- `--target <target>` (default `claude-ai`, the only target today) · `--out <dir>`
  (default `./awm-export`). Reads from the installed registry content roots.
```

- [ ] **Step 2: Full test suite + build**

Run: `cd cli && npm test`
Expected: todas las suites PASS (las 5 nuevas + las preexistentes, sin regresiones)

Run: `cd cli && npm run build`
Expected: tsc sin errores

- [ ] **Step 3: Verificación de aislamiento de tests (R5.1)**

Run: `grep -rn "mkdtempSync\|AWM_HOME" cli/tests/core/export/ cli/tests/commands/export.test.ts | grep -c mkdtempSync`
Expected: ≥5 (cada suite nueva usa tmpdirs; ninguna toca `~/.awm` real — los tests del motor inyectan `roots` explícitos, ni siquiera dependen de `AWM_HOME`)

- [ ] **Step 4: Commit**

```bash
git add docs/cli-reference.md
git commit -m "docs(cli): reference entry for awm export (#9)"
```

---

## Traceability Matrix

| Req  | Task(s) | Test(s) |
|------|---------|---------|
| R1   | T2, T4  | `resolves a bundle...` (resolve), `exports a bundle...` (engine) |
| R1.1 | T2      | `resolves an individual portable skill` |
| R1.2 | T2      | `fails on unknown name, listing available bundles` |
| R1.3 | T4, T5  | `rejects an unknown target...` (engine), `propagates unknown-target errors` (command) |
| R1.4 | T4      | `reads only the provided roots` — prueba que la lectura sale exclusivamente de `roots`; que el default sea `contentRoots()` se verifica por lectura del código (una línea en `runExport`), sin proxy automatizado |
| R2   | T2      | `resolves a bundle: portable skills in...` |
| R2.1 | T2      | `fails on an explicitly requested non-portable skill` |
| R2.2 | T2, T5  | `...non-portable listed as skipped` (resolve), `reports exported skills and visible skips` (command) |
| R2.3 | T2      | `fails when a bundle has zero portable skills` |
| R3   | T2, T4  | `detects the override path...` (resolve), assert `portedMd` verbatim (engine) |
| R3.1 | T1, T4  | los 3 tests de transform + asserts de frontmatter en engine |
| R3.2 | T3, T4  | `writes adapted SKILL.md and byte-identical references` (pack), assert `flow.md` (engine) |
| R3.3 | T2      | `fails on override without portable: true` |
| R3.4 | T1, T4  | 3 tests de error de transform + `wraps transform errors with the offending file path` |
| R4   | T3      | `re-export cleans its own subtree`, `skill without references/...` |
| R4.1 | T3      | `defaultZip... produces a real zip when the binary exists` |
| R4.2 | T3, T5  | `falls back to folder-only...` (pack), `prints the manual-zip instruction` (command) |
| R5   | T1-T6   | estructura de archivos del plan (core/export/ + comando delgado) + `npm run build` en T6; verificación por lectura de estructura, no proxy |
| R5.1 | T6      | Step 3 (grep de tmpdirs) + patrón de todas las suites nuevas |
| R5.2 | T4      | por construcción: `core/export/*` importa solo `fs`/`path`/`child_process`/módulos propios — verificable con `grep -rn "import" cli/src/core/export/` (sin http/net/fetch); anotado como lectura dirigida |
| R6   | —       | FUERA de este plan (trabajo hermano de contenido, ver design doc) — sin task por diseño |

**Analyze gate:** todos los R de este repo (R1-R5.2) tienen ≥1 task y ≥1 verificación; R6 está excluido por diseño con nota explícita. Ningún task carece de requirement. Notas de precisión: R1.4 default, R5 estructura y R5.2 offline se verifican por lectura dirigida declarada (no proxy mecánico débil). Sin gaps.
