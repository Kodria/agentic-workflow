# `awm doctor` (Sub-fase 1c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar `awm doctor`, un comando read-only que computa e imprime el estado del harness (máquina + proyecto), construyendo un motor de diagnóstico compartido (probe + checks puros) que `init` (1d) reutilizará sin refactor.

**Architecture:** Tres capas en `cli/src/`. `core/diagnostics/context.ts` (PROBE) es la única que toca disco/git y produce un `HarnessContext` de hechos crudos. `core/diagnostics/checks.ts` (CHECK) es una función pura que evalúa el contexto y produce un `CheckReport`. `commands/doctor.ts` (RENDER) imprime el dashboard o `--json` y mapea `overall → exit code`. Contratos en `core/diagnostics/types.ts`.

**Tech Stack:** TypeScript, `commander` (CLI), `picocolors` (color), `jest --runInBand` + `ts-jest` (tests). Reutiliza módulos existentes: `core/profile.ts`, `core/bundles.ts`, `commands/hooks/status.ts`, `providers/index.ts`.

**Spec:** [`2026-06-04-awm-doctor-design.md`](2026-06-04-awm-doctor-design.md)

**Branch:** `feature/improvements-r3` (continúa sobre 1a/1b ya mergeadas en `main`).

**Convención de trabajo:** todos los comandos se ejecutan desde `cli/`. Tests con `npx jest --runInBand`. Build con `npm run build`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/diagnostics/types.ts` (crear) | Contratos: `HarnessContext`, `CheckResult`, `CheckReport`, `Remedy`, etc. Sin runtime. |
| `cli/src/core/diagnostics/checks.ts` (crear) | `runChecks(ctx) → CheckReport`. Función pura. |
| `cli/src/core/diagnostics/context.ts` (crear) | `gatherContext(opts) → HarnessContext`. Única capa con I/O. |
| `cli/src/commands/doctor.ts` (crear) | `renderReport`, `runDoctor`, `registerDoctorCommand`. |
| `cli/src/index.ts` (modificar) | Registrar el comando `doctor`. |
| `cli/tests/core/diagnostics/checks.test.ts` (crear) | Tests de los checks puros. |
| `cli/tests/core/diagnostics/context.test.ts` (crear) | Tests del probe en `tmp` con `HOME`/`AWM_HOME` override. |
| `cli/tests/commands/doctor.test.ts` (crear) | Tests de render + exit code + `--json`. |

---

## Task 1: Contratos (`types.ts`)

**Files:**
- Create: `cli/src/core/diagnostics/types.ts`

Este archivo es solo declaraciones de tipos (sin comportamiento en runtime), por lo que no lleva test unitario propio: se verifica por compilación (`tsc`) al ser consumido por las tareas siguientes. Esta es la única excepción al patrón TDD del plan.

- [ ] **Step 1: Crear el archivo de contratos**

Crear `cli/src/core/diagnostics/types.ts` con exactamente:

```typescript
// src/core/diagnostics/types.ts

export type CheckLevel = 'machine' | 'project';
export type CheckStatus = 'ok' | 'warn' | 'missing'; // ✔ / ⚠ / ✖
export type GitState = 'clean' | 'behind' | 'dirty' | 'unknown';

// Frontera CLI↔agente codificada en los datos.
export type Remedy =
    | { kind: 'command'; value: string }   // accionable por init (1d)
    | { kind: 'skill'; value: string }     // lo redacta el agente
    | { kind: 'none' };                    // ok, sin acción

export interface CheckResult {
    id: string;            // estable: 'machine.hook', 'project.constitution', …
    level: CheckLevel;
    label: string;
    status: CheckStatus;
    detail?: string;
    remedy: Remedy;
}

export interface MachineFacts {
    cliSource: { present: boolean; version?: string; gitState?: GitState };
    hook: { present: boolean; degraded?: boolean };
    devCore: { present: boolean; brokenLinks: string[] };
    ambient: { wanted: string[]; installed: string[] };
}

export interface ProjectFacts {
    root: string;
    profile: { present: boolean; extensions: string[] };
    activeBundles: { expected: string[]; linked: string[]; broken: string[] };
    sensors: { present: boolean };
    constitution: { present: boolean };
    context: { present: boolean; file?: 'CLAUDE.md' | 'AGENTS.md' };
}

export interface HarnessContext {
    machine: MachineFacts;
    project: ProjectFacts | null;
}

export interface CheckReport {
    results: CheckResult[];
    overall: 'healthy' | 'degraded';
    hasProject: boolean;
    projectName?: string;
}
```

- [ ] **Step 2: Verificar que compila**

Run: `cd cli && npx tsc --noEmit`
Expected: sin errores (el archivo es solo tipos; aún no se importa en ningún lado).

- [ ] **Step 3: Commit**

```bash
git add cli/src/core/diagnostics/types.ts
git commit -m "feat(diagnostics): add HarnessContext/CheckReport contracts for awm doctor"
```

---

## Task 2: Checks puros (`checks.ts`)

**Files:**
- Create: `cli/src/core/diagnostics/checks.ts`
- Test: `cli/tests/core/diagnostics/checks.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `cli/tests/core/diagnostics/checks.test.ts`:

```typescript
import { runChecks } from '../../../src/core/diagnostics/checks';
import { HarnessContext, ProjectFacts } from '../../../src/core/diagnostics/types';

function healthyMachine(): HarnessContext['machine'] {
    return {
        cliSource: { present: true, version: '1.0.0', gitState: 'clean' },
        hook: { present: true, degraded: false },
        devCore: { present: true, brokenLinks: [] },
        ambient: { wanted: [], installed: [] },
    };
}

function healthyProject(): ProjectFacts {
    return {
        root: '/repo/belanz',
        profile: { present: true, extensions: ['frontend'] },
        activeBundles: { expected: ['frontend-craft'], linked: ['frontend-craft'], broken: [] },
        sensors: { present: true },
        constitution: { present: true },
        context: { present: true, file: 'CLAUDE.md' },
    };
}

function byId(ctx: HarnessContext, id: string) {
    return runChecks(ctx).results.find((r) => r.id === id)!;
}

describe('runChecks — overall', () => {
    it('is healthy when machine is fully ok and there is no project', () => {
        const report = runChecks({ machine: healthyMachine(), project: null });
        expect(report.overall).toBe('healthy');
        expect(report.hasProject).toBe(false);
        expect(report.projectName).toBeUndefined();
    });

    it('is healthy when machine and project are fully ok', () => {
        const report = runChecks({ machine: healthyMachine(), project: healthyProject() });
        expect(report.overall).toBe('healthy');
        expect(report.hasProject).toBe(true);
        expect(report.projectName).toBe('belanz');
    });

    it('degrades when any check is missing', () => {
        const m = healthyMachine();
        m.hook.present = false;
        expect(runChecks({ machine: m, project: null }).overall).toBe('degraded');
    });

    it('does NOT degrade on warn-only states', () => {
        const m = healthyMachine();
        m.cliSource.gitState = 'behind'; // warn
        expect(runChecks({ machine: m, project: null }).overall).toBe('healthy');
    });
});

describe('runChecks — machine.cli', () => {
    it('ok + version label when cache clean', () => {
        const c = byId({ machine: healthyMachine(), project: null }, 'machine.cli');
        expect(c.status).toBe('ok');
        expect(c.label).toBe('CLI v1.0.0');
        expect(c.remedy).toEqual({ kind: 'none' });
    });

    it('warn → awm update when behind', () => {
        const m = healthyMachine(); m.cliSource.gitState = 'behind';
        const c = byId({ machine: m, project: null }, 'machine.cli');
        expect(c.status).toBe('warn');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm update' });
    });

    it('warn + no action when dirty/unknown', () => {
        const m = healthyMachine(); m.cliSource.gitState = 'dirty';
        const c = byId({ machine: m, project: null }, 'machine.cli');
        expect(c.status).toBe('warn');
        expect(c.remedy).toEqual({ kind: 'none' });
    });

    it('missing → awm init when cache absent', () => {
        const m = healthyMachine(); m.cliSource = { present: false };
        const c = byId({ machine: m, project: null }, 'machine.cli');
        expect(c.status).toBe('missing');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm init' });
    });
});

describe('runChecks — machine.hook / devCore', () => {
    it('hook degraded → warn', () => {
        const m = healthyMachine(); m.hook = { present: true, degraded: true };
        expect(byId({ machine: m, project: null }, 'machine.hook').status).toBe('warn');
    });

    it('hook absent → missing + awm init', () => {
        const m = healthyMachine(); m.hook = { present: false };
        const c = byId({ machine: m, project: null }, 'machine.hook');
        expect(c.status).toBe('missing');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm init' });
    });

    it('devCore with broken links → warn', () => {
        const m = healthyMachine(); m.devCore = { present: true, brokenLinks: ['brainstorming'] };
        expect(byId({ machine: m, project: null }, 'machine.devCore').status).toBe('warn');
    });

    it('devCore absent → missing', () => {
        const m = healthyMachine(); m.devCore = { present: false, brokenLinks: [] };
        expect(byId({ machine: m, project: null }, 'machine.devCore').status).toBe('missing');
    });
});

describe('runChecks — machine.ambient (dynamic)', () => {
    it('emits no ambient rows when nothing is wanted', () => {
        const report = runChecks({ machine: healthyMachine(), project: null });
        expect(report.results.some((r) => r.id.startsWith('machine.ambient.'))).toBe(false);
    });

    it('one row per wanted bundle, missing → awm add <b>', () => {
        const m = healthyMachine();
        m.ambient = { wanted: ['personal-notion', 'docs'], installed: ['docs'] };
        const report = runChecks({ machine: m, project: null });
        const notion = report.results.find((r) => r.id === 'machine.ambient.personal-notion')!;
        const docs = report.results.find((r) => r.id === 'machine.ambient.docs')!;
        expect(notion.status).toBe('missing');
        expect(notion.remedy).toEqual({ kind: 'command', value: 'awm add personal-notion' });
        expect(docs.status).toBe('ok');
        expect(report.overall).toBe('degraded');
    });
});

describe('runChecks — project', () => {
    it('omits project checks when project is null', () => {
        const report = runChecks({ machine: healthyMachine(), project: null });
        expect(report.results.some((r) => r.level === 'project')).toBe(false);
    });

    it('constitution absent → missing + skill remedy (degrades)', () => {
        const p = healthyProject(); p.constitution = { present: false };
        const report = runChecks({ machine: healthyMachine(), project: p });
        const c = report.results.find((r) => r.id === 'project.constitution')!;
        expect(c.status).toBe('missing');
        expect(c.remedy).toEqual({ kind: 'skill', value: 'project-constitution' });
        expect(report.overall).toBe('degraded');
    });

    it('context absent → warn + skill remedy (does NOT degrade)', () => {
        const p = healthyProject(); p.context = { present: false };
        const report = runChecks({ machine: healthyMachine(), project: p });
        const c = report.results.find((r) => r.id === 'project.context')!;
        expect(c.status).toBe('warn');
        expect(c.remedy).toEqual({ kind: 'skill', value: 'project-context-init' });
        expect(report.overall).toBe('healthy');
    });

    it('activation with missing links → missing + awm sync', () => {
        const p = healthyProject();
        p.activeBundles = { expected: ['frontend-craft', 'impeccable'], linked: ['frontend-craft'], broken: [] };
        const c = runChecks({ machine: healthyMachine(), project: p }).results.find((r) => r.id === 'project.activation')!;
        expect(c.status).toBe('missing');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm sync' });
    });

    it('sensors absent → missing + awm sensors init', () => {
        const p = healthyProject(); p.sensors = { present: false };
        const c = runChecks({ machine: healthyMachine(), project: p }).results.find((r) => r.id === 'project.sensors')!;
        expect(c.status).toBe('missing');
        expect(c.remedy).toEqual({ kind: 'command', value: 'awm sensors init' });
    });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd cli && npx jest --runInBand diagnostics/checks`
Expected: FAIL con "Cannot find module '../../../src/core/diagnostics/checks'".

- [ ] **Step 3: Implementar `checks.ts`**

Crear `cli/src/core/diagnostics/checks.ts`:

```typescript
// src/core/diagnostics/checks.ts
import path from 'path';
import { HarnessContext, MachineFacts, ProjectFacts, CheckResult, CheckReport, Remedy } from './types';

const cmd = (value: string): Remedy => ({ kind: 'command', value });
const skillRemedy = (value: string): Remedy => ({ kind: 'skill', value });
const none: Remedy = { kind: 'none' };

function machineChecks(m: MachineFacts): CheckResult[] {
    const out: CheckResult[] = [];
    const version = m.cliSource.version ?? '?';

    // machine.cli
    if (!m.cliSource.present) {
        out.push({ id: 'machine.cli', level: 'machine', label: 'CLI', status: 'missing',
            detail: 'cache ~/.awm/cli-source ausente', remedy: cmd('awm init') });
    } else if (m.cliSource.gitState === 'clean') {
        out.push({ id: 'machine.cli', level: 'machine', label: `CLI v${version}`, status: 'ok', remedy: none });
    } else if (m.cliSource.gitState === 'behind') {
        out.push({ id: 'machine.cli', level: 'machine', label: `CLI v${version}`, status: 'warn',
            detail: 'cache desactualizado', remedy: cmd('awm update') });
    } else {
        // dirty | unknown | undefined → advisory, sin acción
        out.push({ id: 'machine.cli', level: 'machine', label: `CLI v${version}`, status: 'warn',
            detail: `git ${m.cliSource.gitState ?? 'unknown'}`, remedy: none });
    }

    // machine.hook
    if (m.hook.present && !m.hook.degraded) {
        out.push({ id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'ok', remedy: none });
    } else if (m.hook.present) {
        out.push({ id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'warn',
            detail: 'scripts incompletos', remedy: cmd('awm init') });
    } else {
        out.push({ id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'missing',
            remedy: cmd('awm init') });
    }

    // machine.devCore
    if (m.devCore.present && m.devCore.brokenLinks.length === 0) {
        out.push({ id: 'machine.devCore', level: 'machine', label: 'dev-core (baseline)', status: 'ok', remedy: none });
    } else if (m.devCore.present) {
        out.push({ id: 'machine.devCore', level: 'machine', label: 'dev-core (baseline)', status: 'warn',
            detail: `${m.devCore.brokenLinks.length} symlinks rotos`, remedy: cmd('awm init') });
    } else {
        out.push({ id: 'machine.devCore', level: 'machine', label: 'dev-core (baseline)', status: 'missing',
            remedy: cmd('awm init') });
    }

    // machine.ambient.<b> — una fila por bundle deseado
    for (const b of m.ambient.wanted) {
        const installed = m.ambient.installed.includes(b);
        out.push({ id: `machine.ambient.${b}`, level: 'machine', label: `${b} (ambient)`,
            status: installed ? 'ok' : 'missing', remedy: installed ? none : cmd(`awm add ${b}`) });
    }

    return out;
}

function projectChecks(p: ProjectFacts): CheckResult[] {
    const out: CheckResult[] = [];

    // project.profile
    if (p.profile.present) {
        const exts = p.profile.extensions.length ? p.profile.extensions.join(', ') : 'sin extensiones';
        out.push({ id: 'project.profile', level: 'project', label: `.awm/profile.json (${exts})`,
            status: 'ok', remedy: none });
    } else {
        out.push({ id: 'project.profile', level: 'project', label: '.awm/profile.json', status: 'missing',
            remedy: cmd('awm init') });
    }

    // project.activation
    const missingLinks = p.activeBundles.expected.filter((s) => !p.activeBundles.linked.includes(s));
    if (p.activeBundles.broken.length === 0 && missingLinks.length === 0) {
        out.push({ id: 'project.activation', level: 'project', label: 'bundles activos', status: 'ok', remedy: none });
    } else {
        out.push({ id: 'project.activation', level: 'project', label: 'bundles activos', status: 'missing',
            detail: `${missingLinks.length} faltan, ${p.activeBundles.broken.length} rotos`, remedy: cmd('awm sync') });
    }

    // project.sensors
    out.push(p.sensors.present
        ? { id: 'project.sensors', level: 'project', label: 'sensores', status: 'ok', remedy: none }
        : { id: 'project.sensors', level: 'project', label: 'sensores no inicializados', status: 'missing',
            remedy: cmd('awm sensors init') });

    // project.constitution (missing degrada; remedio agente)
    out.push(p.constitution.present
        ? { id: 'project.constitution', level: 'project', label: 'CONSTITUTION.md', status: 'ok', remedy: none }
        : { id: 'project.constitution', level: 'project', label: 'CONSTITUTION.md ausente', status: 'missing',
            remedy: skillRemedy('project-constitution') });

    // project.context (advisory; no degrada)
    if (p.context.present) {
        out.push({ id: 'project.context', level: 'project', label: p.context.file ?? 'CLAUDE.md',
            status: 'ok', remedy: none });
    } else {
        out.push({ id: 'project.context', level: 'project', label: 'CLAUDE.md ausente', status: 'warn',
            remedy: skillRemedy('project-context-init') });
    }

    return out;
}

export function runChecks(ctx: HarnessContext): CheckReport {
    const results = [
        ...machineChecks(ctx.machine),
        ...(ctx.project ? projectChecks(ctx.project) : []),
    ];
    const overall: CheckReport['overall'] = results.some((r) => r.status === 'missing') ? 'degraded' : 'healthy';
    return {
        results,
        overall,
        hasProject: ctx.project !== null,
        projectName: ctx.project ? path.basename(ctx.project.root) : undefined,
    };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd cli && npx jest --runInBand diagnostics/checks`
Expected: PASS (todos los `describe`/`it`).

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/diagnostics/checks.ts cli/tests/core/diagnostics/checks.test.ts
git commit -m "feat(diagnostics): pure runChecks engine for awm doctor"
```

---

## Task 3: Probe (`context.ts`)

**Files:**
- Create: `cli/src/core/diagnostics/context.ts`
- Test: `cli/tests/core/diagnostics/context.test.ts`

El probe es la única capa con I/O. Los tests overridean `HOME`/`AWM_HOME` a un `tmp`, usan `jest.resetModules()` + `require()` interno (mismo patrón que `tests/commands/hooks/status.test.ts`), e **inyectan** bundles sintéticos vía `gatherContext({ cwd, bundles })` para no depender del registry real.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `cli/tests/core/diagnostics/context.test.ts`:

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BundleDefinition } from '../../../src/core/bundles';

function bundle(name: string, scope: BundleDefinition['scope'], skills: string[]): BundleDefinition {
    return {
        name, description: '', version: '1.0.0', scope, visibility: 'public',
        dependsOn: [], skills: skills.map((s) => ({ name: s, onSignal: false })),
        workflows: [], agents: [],
    };
}

describe('gatherContext', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    // Crea un symlink "vivo" <claudeSkills>/<skill> → un target real.
    function linkGlobalSkill(skill: string) {
        const skillsDir = path.join(tmpHome, '.claude', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        const target = path.join(tmpHome, 'targets', skill);
        fs.mkdirSync(target, { recursive: true });
        fs.symlinkSync(target, path.join(skillsDir, skill), 'dir');
    }

    it('machine: cli/hook/devCore absent on a bare HOME', () => {
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundle('dev-core', 'baseline', ['brainstorming'])] });
        expect(ctx.machine.cliSource.present).toBe(false);
        expect(ctx.machine.hook.present).toBe(false);
        expect(ctx.machine.devCore.present).toBe(false);
        expect(ctx.machine.ambient.wanted).toEqual([]);
    });

    it('machine: devCore present when baseline skills are linked globally', () => {
        linkGlobalSkill('brainstorming');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundle('dev-core', 'baseline', ['brainstorming'])] });
        expect(ctx.machine.devCore.present).toBe(true);
        expect(ctx.machine.devCore.brokenLinks).toEqual([]);
    });

    it('machine: reports a broken dev-core symlink', () => {
        const skillsDir = path.join(tmpHome, '.claude', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.symlinkSync(path.join(tmpHome, 'targets', 'gone'), path.join(skillsDir, 'brainstorming'), 'dir');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [bundle('dev-core', 'baseline', ['brainstorming'])] });
        expect(ctx.machine.devCore.present).toBe(false);
        expect(ctx.machine.devCore.brokenLinks).toContain('brainstorming');
    });

    it('machine: ambient wanted read from ~/.awm/config.json, installed reflects links', () => {
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.awm', 'config.json'), JSON.stringify({ ambient: ['personal-notion'] }));
        linkGlobalSkill('notion-skill');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const bundles = [
            bundle('dev-core', 'baseline', ['brainstorming']),
            bundle('personal-notion', 'ambient', ['notion-skill']),
        ];
        const ctx = gatherContext({ cwd: tmpHome, bundles });
        expect(ctx.machine.ambient.wanted).toEqual(['personal-notion']);
        expect(ctx.machine.ambient.installed).toEqual(['personal-notion']);
    });

    it('project: null when cwd has no project root', () => {
        // tmpHome is bare (no .git / package.json / .awm/profile.json)
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: tmpHome, bundles: [] });
        expect(ctx.project).toBeNull();
    });

    it('project: maps profile, activation, sensors, constitution and context', () => {
        const root = path.join(tmpHome, 'repo');
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), '{}'); // project root marker
        fs.writeFileSync(path.join(root, '.awm', 'profile.json'), JSON.stringify({ extensions: ['frontend'] }));
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), '{}');
        fs.writeFileSync(path.join(root, 'CONSTITUTION.md'), '# rules');
        fs.writeFileSync(path.join(root, 'AGENTS.md'), '# agents');
        // link the expected project skill locally
        const localSkills = path.join(root, '.claude', 'skills');
        fs.mkdirSync(localSkills, { recursive: true });
        const target = path.join(root, 'targets', 'frontend-craft');
        fs.mkdirSync(target, { recursive: true });
        fs.symlinkSync(target, path.join(localSkills, 'frontend-craft'), 'dir');

        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: root, bundles: [bundle('frontend', 'project', ['frontend-craft'])] });

        expect(ctx.project).not.toBeNull();
        expect(ctx.project.profile).toEqual({ present: true, extensions: ['frontend'] });
        expect(ctx.project.activeBundles.expected).toEqual(['frontend-craft']);
        expect(ctx.project.activeBundles.linked).toEqual(['frontend-craft']);
        expect(ctx.project.activeBundles.broken).toEqual([]);
        expect(ctx.project.sensors.present).toBe(true);
        expect(ctx.project.constitution.present).toBe(true);
        expect(ctx.project.context).toEqual({ present: true, file: 'AGENTS.md' });
    });

    it('project: context prefers CLAUDE.md over AGENTS.md', () => {
        const root = path.join(tmpHome, 'repo2');
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# claude');
        fs.writeFileSync(path.join(root, 'AGENTS.md'), '# agents');
        const { gatherContext } = require('../../../src/core/diagnostics/context');
        const ctx = gatherContext({ cwd: root, bundles: [] });
        expect(ctx.project.context).toEqual({ present: true, file: 'CLAUDE.md' });
    });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd cli && npx jest --runInBand diagnostics/context`
Expected: FAIL con "Cannot find module '../../../src/core/diagnostics/context'".

- [ ] **Step 3: Implementar `context.ts`**

Crear `cli/src/core/diagnostics/context.ts`:

```typescript
// src/core/diagnostics/context.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { HarnessContext, MachineFacts, ProjectFacts, GitState } from './types';
import { PROVIDERS } from '../../providers';
import { computeHookStatus } from '../../commands/hooks/status';
import { findProjectRoot, readProfile } from '../profile';
import { discoverBundles, resolveBundleSkills, BundleDefinition } from '../bundles';

function home(): string { return process.env.HOME || os.homedir(); }
function awmHome(): string { return process.env.AWM_HOME || path.join(home(), '.awm'); }

// Estado de un artefacto en <dir>/<skill>: link vivo / symlink colgante / ausente.
function linkState(dir: string, skill: string): 'present' | 'broken' | 'absent' {
    const p = path.join(dir, skill);
    let lst: fs.Stats;
    try { lst = fs.lstatSync(p); } catch { return 'absent'; }
    if (lst.isSymbolicLink()) return fs.existsSync(p) ? 'present' : 'broken';
    return 'present'; // un dir/archivo real también cuenta como presente
}

function classifyLinks(skillNames: string[], dir: string): { linked: string[]; broken: string[] } {
    const linked: string[] = [];
    const broken: string[] = [];
    for (const s of skillNames) {
        const st = linkState(dir, s);
        if (st === 'present') linked.push(s);
        else if (st === 'broken') broken.push(s);
    }
    return { linked, broken };
}

function detectGitState(repoDir: string): GitState {
    try {
        const porcelain = execSync('git status --porcelain', { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim();
        if (porcelain.length > 0) return 'dirty';
        try {
            const behind = execSync('git rev-list --count HEAD..@{u}', { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'] })
                .toString().trim();
            if (behind !== '' && behind !== '0') return 'behind';
        } catch { /* sin upstream configurado */ }
        return 'clean';
    } catch {
        return 'unknown';
    }
}

function gatherMachine(bundles: BundleDefinition[]): MachineFacts {
    // cliSource
    const cacheDir = path.join(awmHome(), 'cli-source');
    const cliPresent = fs.existsSync(path.join(cacheDir, '.git'));
    let version: string | undefined;
    let gitState: GitState | undefined;
    if (cliPresent) {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(cacheDir, 'cli', 'package.json'), 'utf-8'));
            version = typeof pkg.version === 'string' ? pkg.version : undefined;
        } catch { /* deja version undefined */ }
        gitState = detectGitState(cacheDir);
    }

    // hook (reutiliza computeHookStatus)
    let hookPresent = false;
    let hookDegraded = false;
    try {
        const hs = computeHookStatus('claude-code');
        hookPresent = hs.checks.settingsEntry.ok;
        hookDegraded = hs.overall === 'DEGRADED';
    } catch { /* sin soporte de hooks → ausente */ }

    // devCore (bundle baseline)
    const skillsDir = PROVIDERS['claude-code'].skill.global;
    const baseline = bundles.find((b) => b.scope === 'baseline');
    let devCorePresent = false;
    let brokenLinks: string[] = [];
    if (baseline) {
        const skillNames = resolveBundleSkills(baseline.name, bundles);
        const { linked, broken } = classifyLinks(skillNames, skillsDir);
        devCorePresent = skillNames.length > 0 && linked.length === skillNames.length;
        brokenLinks = broken;
    }

    // ambient (deseados desde ~/.awm/config.json)
    let wanted: string[] = [];
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(awmHome(), 'config.json'), 'utf-8'));
        if (Array.isArray(cfg.ambient)) {
            wanted = cfg.ambient.filter((x: unknown): x is string => typeof x === 'string');
        }
    } catch { /* sin config → ningún ambient deseado */ }
    const installed = wanted.filter((name) => {
        const skillNames = resolveBundleSkills(name, bundles);
        if (skillNames.length === 0) return false;
        const { linked } = classifyLinks(skillNames, skillsDir);
        return linked.length === skillNames.length;
    });

    return {
        cliSource: { present: cliPresent, version, gitState },
        hook: { present: hookPresent, degraded: hookDegraded },
        devCore: { present: devCorePresent, brokenLinks },
        ambient: { wanted, installed },
    };
}

function gatherProject(root: string, bundles: BundleDefinition[]): ProjectFacts {
    const profile = readProfile(root);
    const profilePresent = fs.existsSync(path.join(root, '.awm', 'profile.json'));

    const localSkillsDir = path.join(root, PROVIDERS['claude-code'].skill.local); // '.claude/skills'
    const expected: string[] = [];
    for (const ext of profile.extensions) {
        for (const s of resolveBundleSkills(ext, bundles)) if (!expected.includes(s)) expected.push(s);
    }
    const { linked, broken } = classifyLinks(expected, localSkillsDir);

    let context: ProjectFacts['context'] = { present: false };
    if (fs.existsSync(path.join(root, 'CLAUDE.md'))) context = { present: true, file: 'CLAUDE.md' };
    else if (fs.existsSync(path.join(root, 'AGENTS.md'))) context = { present: true, file: 'AGENTS.md' };

    return {
        root,
        profile: { present: profilePresent, extensions: profile.extensions },
        activeBundles: { expected, linked, broken },
        sensors: { present: fs.existsSync(path.join(root, '.awm', 'sensors.json')) },
        constitution: { present: fs.existsSync(path.join(root, 'CONSTITUTION.md')) },
        context,
    };
}

export interface GatherOptions {
    cwd?: string;
    bundles?: BundleDefinition[];
}

export function gatherContext(opts: GatherOptions = {}): HarnessContext {
    const cwd = opts.cwd ?? process.cwd();
    const bundles = opts.bundles ?? discoverBundles();
    const root = findProjectRoot(cwd);
    return {
        machine: gatherMachine(bundles),
        project: root ? gatherProject(root, bundles) : null,
    };
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd cli && npx jest --runInBand diagnostics/context`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/diagnostics/context.ts cli/tests/core/diagnostics/context.test.ts
git commit -m "feat(diagnostics): gatherContext probe for awm doctor (machine + project)"
```

---

## Task 4: Render + comando (`doctor.ts`)

**Files:**
- Create: `cli/src/commands/doctor.ts`
- Test: `cli/tests/commands/doctor.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `cli/tests/commands/doctor.test.ts`:

```typescript
import { renderReport, runDoctor } from '../../src/commands/doctor';
import type { CheckReport } from '../../src/core/diagnostics/types';
import fs from 'fs';
import os from 'os';
import path from 'path';

function report(partial: Partial<CheckReport> = {}): CheckReport {
    return {
        results: [
            { id: 'machine.cli', level: 'machine', label: 'CLI v1.0.0', status: 'ok', remedy: { kind: 'none' } },
            { id: 'machine.hook', level: 'machine', label: 'hook SessionStart', status: 'missing',
                remedy: { kind: 'command', value: 'awm init' } },
        ],
        overall: 'degraded',
        hasProject: false,
        ...partial,
    };
}

describe('renderReport', () => {
    it('renders the machine block with glyphs and remedies', () => {
        const out = renderReport(report());
        expect(out).toContain('AWM · estado del harness');
        expect(out).toContain('Máquina (global)');
        expect(out).toContain('✔ CLI v1.0.0');
        expect(out).toContain('✖ hook SessionStart');
        expect(out).toContain('→ awm init');
        expect(out).toContain('estado: degradado · 1 acciones sugeridas');
    });

    it('omits the project block and shows a hint when hasProject is false', () => {
        const out = renderReport(report());
        expect(out).toContain('(sin proyecto en el cwd)');
        expect(out).not.toContain('Proyecto:');
    });

    it('renders the project block titled with projectName', () => {
        const out = renderReport(report({
            hasProject: true,
            projectName: 'belanz',
            results: [
                { id: 'project.constitution', level: 'project', label: 'CONSTITUTION.md ausente',
                    status: 'missing', remedy: { kind: 'skill', value: 'project-constitution' } },
            ],
        }));
        expect(out).toContain('Proyecto: belanz');
        expect(out).toContain('→ skill: project-constitution');
    });
});

describe('runDoctor', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;
    let writeSpy: jest.SpyInstance;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-run-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        writeSpy.mockRestore();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = originalAwmHome;
    });

    it('returns exit code 1 when the harness is degraded (bare HOME, no project)', () => {
        const code = runDoctor({ cwd: tmpHome });
        expect(code).toBe(1);
    });

    it('--json emits a parseable CheckReport and keeps the same exit code', () => {
        const code = runDoctor({ cwd: tmpHome, json: true });
        const written = writeSpy.mock.calls.map((c) => c[0]).join('');
        const parsed = JSON.parse(written);
        expect(parsed.overall).toBe('degraded');
        expect(Array.isArray(parsed.results)).toBe(true);
        expect(code).toBe(1);
    });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd cli && npx jest --runInBand commands/doctor`
Expected: FAIL con "Cannot find module '../../src/commands/doctor'".

- [ ] **Step 3: Implementar `doctor.ts`**

Crear `cli/src/commands/doctor.ts`:

```typescript
// src/commands/doctor.ts
import { Command } from 'commander';
import pc from 'picocolors';
import { gatherContext } from '../core/diagnostics/context';
import { runChecks } from '../core/diagnostics/checks';
import { CheckReport, CheckResult } from '../core/diagnostics/types';

function glyph(status: CheckResult['status']): string {
    if (status === 'ok') return pc.green('✔');
    if (status === 'warn') return pc.yellow('⚠');
    return pc.red('✖');
}

function remedyText(r: CheckResult): string {
    if (r.remedy.kind === 'command') return pc.dim(`→ ${r.remedy.value}`);
    if (r.remedy.kind === 'skill') return pc.dim(`→ skill: ${r.remedy.value}`);
    return '';
}

function line(r: CheckResult): string {
    const rem = remedyText(r);
    return `  ${glyph(r.status)} ${r.label}${rem ? '   ' + rem : ''}`;
}

export function renderReport(report: CheckReport): string {
    const lines: string[] = [];
    lines.push(pc.bold('AWM · estado del harness'));
    lines.push('');
    lines.push('Máquina (global)');
    for (const r of report.results.filter((x) => x.level === 'machine')) lines.push(line(r));
    lines.push('');
    if (report.hasProject) {
        lines.push(`Proyecto: ${report.projectName ?? ''}`.trimEnd());
        for (const r of report.results.filter((x) => x.level === 'project')) lines.push(line(r));
    } else {
        lines.push(pc.dim('(sin proyecto en el cwd)'));
    }
    lines.push('');
    const actions = report.results.filter((r) => r.remedy.kind !== 'none').length;
    const estado = report.overall === 'healthy' ? pc.green('sano') : pc.red('degradado');
    lines.push(`estado: ${estado} · ${actions} acciones sugeridas`);
    return lines.join('\n');
}

export interface RunDoctorOptions {
    json?: boolean;
    cwd?: string;
}

export function runDoctor(opts: RunDoctorOptions = {}): number {
    let report: CheckReport;
    try {
        report = runChecks(gatherContext({ cwd: opts.cwd }));
    } catch (err) {
        process.stderr.write(`awm doctor: error interno: ${(err as Error).message}\n`);
        return 2;
    }
    if (opts.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
        process.stdout.write(renderReport(report) + '\n');
    }
    return report.overall === 'healthy' ? 0 : 1;
}

export function registerDoctorCommand(program: Command): void {
    program.command('doctor')
        .description('Read-only dashboard of the AWM harness state (machine + project)')
        .option('--json', 'Emit the diagnostic report as JSON')
        .action((options: { json?: boolean }) => {
            process.exitCode = runDoctor({ json: options.json });
        });
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd cli && npx jest --runInBand commands/doctor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/doctor.ts cli/tests/commands/doctor.test.ts
git commit -m "feat(doctor): render dashboard + --json + exit codes"
```

---

## Task 5: Registrar el comando y verificación integral

**Files:**
- Modify: `cli/src/index.ts`

- [ ] **Step 1: Importar el registrador**

En `cli/src/index.ts`, junto a los otros imports de comandos (cerca de `import { registerHooksCommand } from './commands/hooks';`), añadir:

```typescript
import { registerDoctorCommand } from './commands/doctor';
```

- [ ] **Step 2: Registrar el comando**

En `cli/src/index.ts`, donde se invocan los registradores existentes (`registerHooksCommand(program);` / `registerSensorsCommand(program);`), añadir en la misma zona, **antes** de `program.parse();`:

```typescript
registerDoctorCommand(program);
```

- [ ] **Step 3: Verificar que compila**

Run: `cd cli && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Correr la suite completa**

Run: `cd cli && npx jest --runInBand`
Expected: PASS — toda la suite (incluyendo los nuevos `diagnostics/checks`, `diagnostics/context`, `commands/doctor`).

- [ ] **Step 5: Build y smoke manual del comando**

Run:
```bash
cd cli && npm run build
node dist/src/index.js doctor
node dist/src/index.js doctor --json
echo "exit: $?"
```
Expected: el dashboard se imprime (bloque Máquina; bloque Proyecto si el cwd es un repo); `--json` imprime un `CheckReport` parseable; el exit code es `0` (sano) o `1` (degradado) según el estado real de la máquina.

- [ ] **Step 6: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(cli): register 'awm doctor' command"
```

---

## Self-Review (completado al escribir el plan)

**1. Cobertura del spec:**
- §2 Arquitectura (3 capas) → Tasks 1–4 crean `types`/`checks`/`context`/`doctor` con la frontera probe/check/render. ✔
- §3 Modelo de datos → Task 1 (todos los tipos, incl. `Remedy` discriminada y `projectName`). ✔
- §4 Catálogo de checks (todas las filas máquina + proyecto, semántica warn/missing, remedios) → Task 2 (`checks.ts`) + tests por `id`. ✔
- §5 Salida (dashboard, `--json`, exit codes 0/1/2) → Task 4 (`doctor.ts`) + tests. ✔ (exit 2 cubierto por el `try/catch` de `runDoctor`; los caminos 0/1 testeados.)
- §6 Testing (checks puros, probe en tmp, render+exit) → Tasks 2/3/4. ✔
- §7 Componentes y límites → respetado por la separación de archivos. La extracción opcional de `hooks/status.ts` se evita: `context.ts` **reutiliza `computeHookStatus` tal cual**, reduciendo riesgo sin duplicar el parseo de settings. ✔
- §8 Fuera de alcance → no se implementa `init` ni auto-reparación. ✔

**2. Placeholder scan:** sin TBD/TODO; todo el código y los comandos están completos. ✔

**3. Consistencia de tipos:** `gatherContext(opts)` retorna `HarnessContext`; `runChecks(ctx)` consume `HarnessContext` y retorna `CheckReport`; `renderReport`/`runDoctor` consumen `CheckReport`. `MachineFacts`/`ProjectFacts` se usan idénticos en `types.ts`, `checks.ts` y `context.ts`. `BundleDefinition`/`resolveBundleSkills`/`discoverBundles` coinciden con `core/bundles.ts`. `computeHookStatus(...).checks.settingsEntry.ok` y `.overall` coinciden con `commands/hooks/status.ts`. ✔

---

## Execution Handoff

Plan completo y guardado en `docs/plans/2026-06-04-awm-doctor-plan.md`. Dos opciones de ejecución:

**1. Subagent-Driven (recomendado)** — despacho un subagente fresco por tarea, reviso entre tareas, iteración rápida.

**2. Inline Execution** — ejecuto las tareas en esta sesión con `executing-plans`, en lotes con checkpoints de revisión.

¿Cuál preferís?
