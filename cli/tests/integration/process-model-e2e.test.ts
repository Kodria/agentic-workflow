// cli/tests/integration/process-model-e2e.test.ts
//
// Ledger signature: ca1-2-1-3-no-e2e-regression-test.
//
// CA-1.2 y CA-1.3 del plan R1a (docs/plans/2026-08-23-process-model-r1a-plan.md)
// fueron verificados MANUALMENTE varias veces durante esa sesión, pero ningún
// test permanente los sostenía. Este test cierra ese hueco ejecutando el
// binario compilado real (dist/src/index.js) contra un AWM_HOME/registry
// fixture aislado — no llama funciones internas directamente. El plan es
// explícito: "No vale el test unitario: el criterio dice 'reporta', y eso se
// prueba ejecutando" (CA-1.2). Sigue el patrón de invocación de
// tests/structural/r3-cli-major-version.test.ts (spawnSync del dist compilado)
// y el patrón de fixture de tests/core/process/discover.test.ts +
// tests/core/process/no-regression.test.ts (registries.json + skills/<name>/SKILL.md
// bajo un AWM_HOME de tmpdir, nunca el ~/.awm real).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const CLI_ROOT = path.resolve(__dirname, '../..');
const DIST_ENTRYPOINT = path.join(CLI_ROOT, 'dist', 'src', 'index.js');

// Fixture canónico del plan R1a, reproducido byte a byte (bloque "Canonical fixture").
const EJEMPLO_PROCESO_SKILL_MD = `---
awm: process-model
schema: 1
name: ejemplo-proceso
status: draft
entry_point: true
terminates_to: none
created: 2026-08-23
updated: 2026-08-23
---

# Ejemplo

## Objetivo

G — Llevar una idea hasta una rama cerrada.

## Cuándo aplica

Cuando hay una tarea de desarrollo sin plan previo.

## Estructura

- SG-1 — Diseñar
  - OP-1.1 — Elicitar requisitos
  - OP-1.2 — Escribir el design doc
- SG-2 — Ejecutar
  - OP-2.1 — Implementar por tasks

## Ruteo

| Cuándo | Estado requerido | Va a | Termina en |
|---|---|---|---|
| No hay design doc | | OP-1.1 | SG-1 |
| Design doc aprobado | SG-1 | OP-2.1 | SG-2 |

## Terminación

finishing-a-development-branch

## Sin verificar

Nada.
`;

interface Fixture { root: string; project: string; home: string; awmHome: string }

/** Construye AWM_HOME/registries.json + AWM_HOME/registries/<name>/skills/<skill>/SKILL.md
 *  — el mismo layout que contentRoots() (src/core/registries.ts) resuelve para
 *  descubrimiento real, sin clonar git: contentRoots() solo necesita que el
 *  directorio exista y pase inspectRegistrySafety (ningún symlink, ≥1 dir
 *  administrado). El campo "remote" no se usa en este test — nada corre `awm update`. */
function fixture(): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-process-e2e-'));
    const project = path.join(root, 'project');
    const home = path.join(root, 'home');
    const awmHome = path.join(home, '.awm');
    const registryRoot = path.join(awmHome, 'registries', 'baseline');
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(path.join(registryRoot, 'skills', 'ejemplo-proceso'), { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'process-model-e2e-fixture', private: true }));
    fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'https://example.invalid/baseline.git' }]));
    fs.writeFileSync(path.join(registryRoot, 'skills', 'ejemplo-proceso', 'SKILL.md'), EJEMPLO_PROCESO_SKILL_MD);
    return { root, project, home, awmHome };
}

function runCompiledCli(f: Fixture, ...args: string[]): { code: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [DIST_ENTRYPOINT, ...args], {
        cwd: f.project,
        encoding: 'utf8',
        env: {
            ...process.env,
            HOME: f.home,
            USERPROFILE: f.home,
            AWM_HOME: f.awmHome,
            AWM_NO_UPDATE_CHECK: '1',
        },
    });
    expect(result.error).toBeUndefined();
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('process model E2E against the real built binary (CA-1.2, CA-1.3)', () => {
    jest.setTimeout(60_000);

    beforeAll(() => {
        if (!fs.existsSync(DIST_ENTRYPOINT)) {
            throw new Error(
                `${DIST_ENTRYPOINT} no existe — este test ejecuta el binario compilado real. ` +
                'Correr `npm run build` antes de `jest` (mismo pre-requisito que tests/structural/r3-cli-major-version.test.ts).'
            );
        }
    });

    let f: Fixture;
    beforeEach(() => { f = fixture(); });
    afterEach(() => { fs.rmSync(f.root, { recursive: true, force: true }); });

    test('CA-1.2 — `process list` reporta ejemplo-proceso con su status', () => {
        const result = runCompiledCli(f, 'process', 'list');
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('ejemplo-proceso');
        expect(result.stdout).toContain('draft');
    });

    test('CA-1.2 — `process show ejemplo-proceso --json` emite el modelo parseado completo', () => {
        const result = runCompiledCli(f, 'process', 'show', 'ejemplo-proceso', '--json');
        expect(result.code).toBe(0);
        const model = JSON.parse(result.stdout) as {
            name: string; schema: number; status: string; entryPoint: boolean; terminatesTo: string;
            body: {
                objective: string; appliesWhen: string;
                structure: Array<{ id: string; text: string; operations: Array<{ id: string; text: string }> }>;
                routing: Array<{ when: string; requiredState: string; goesTo: string; endsAt: string }>;
                termination: string; unverified: string[];
            };
        };
        expect(model).toEqual(expect.objectContaining({
            name: 'ejemplo-proceso',
            schema: 1,
            status: 'draft',
            entryPoint: true,
            terminatesTo: 'none',
        }));
        expect(model.body.structure).toEqual([
            { id: 'SG-1', text: 'Diseñar', operations: [
                { id: 'OP-1.1', text: 'Elicitar requisitos' },
                { id: 'OP-1.2', text: 'Escribir el design doc' },
            ] },
            { id: 'SG-2', text: 'Ejecutar', operations: [
                { id: 'OP-2.1', text: 'Implementar por tasks' },
            ] },
        ]);
        expect(model.body.routing).toEqual([
            { when: 'No hay design doc', requiredState: '', goesTo: 'OP-1.1', endsAt: 'SG-1' },
            { when: 'Design doc aprobado', requiredState: 'SG-1', goesTo: 'OP-2.1', endsAt: 'SG-2' },
        ]);
        expect(model.body.termination).toBe('finishing-a-development-branch');
        // No source path leaks into the published/consumable view (see publicView
        // in src/commands/process/index.ts) — assert the field is entirely absent.
        expect(model).not.toHaveProperty('source');
    });

    test('CA-1.3 — `doctor --full` renderiza la seccion Processes desde el adapter, sin re-parseo ad-hoc', () => {
        const result = runCompiledCli(f, 'doctor', '--full');
        expect([0, 1]).toContain(result.code);
        expect(result.stdout).toContain('Processes');
        // El adapter de producción (productionDashboardAdapters.processes, src/core/dashboard/collect.ts)
        // construye el id de item como `process.<name>` vía sanitizeDashboardId — esto es lo que
        // demuestra que la sección viene del adapter real (discoverProcessModels() -> Dashboard),
        // no de un parser propio del Dashboard.
        expect(result.stdout).toContain('process.ejemplo-proceso');
    });
});
