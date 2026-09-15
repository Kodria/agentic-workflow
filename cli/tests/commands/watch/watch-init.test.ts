import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectRequiredVerifiers, initWatch } from '../../../src/commands/watch/init';
import { readJournal } from '../../../src/core/journal/store';
import type { PlanValidationReport } from '../../../src/core/plan/types';

describe('watch --init: plan-vs-repo mecanico', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-')); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('package.json con script test => verificador test requerido (R1.4b)', () => {  // verifies R1.4b
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
        expect(detectRequiredVerifiers(repo)).toEqual(['test']);
    });

    test('sensors.json => verificador sensors requerido; ambos => ambos (R1.4b)', () => {  // verifies R1.4b
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
        fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), '{}');
        expect(detectRequiredVerifiers(repo)).toEqual(['test', 'sensors']);
    });

    test('descubre suite y sensors en paquetes anidados del repositorio', () => {
        const cli = path.join(repo, 'cli');
        fs.mkdirSync(path.join(cli, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(cli, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
        fs.writeFileSync(path.join(cli, '.awm', 'sensors.json'), '{}');
        expect(detectRequiredVerifiers(repo)).toEqual(['test', 'sensors']);
    });

    test('repo sin verificadores => lista vacia (el gate degrada por empty-cycle-plan igualmente, R3.6)', () => {  // verifies R3.6
        expect(detectRequiredVerifiers(repo)).toEqual([]);
    });

    test('initWatch persiste requiredVerifiers y gitignorea el journal (R1.1/R1.4b)', () => {  // verifies R1.4b
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
        const out = initWatch(repo, 'rama');
        expect(out.requiredVerifiers).toEqual(['test']);
        expect(readJournal(repo, 'rama').state!.requiredVerifiers).toEqual(['test']);
        expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')).toContain('.awm/');
        expect(() => initWatch(repo, 'rama')).not.toThrow();   // idempotente
    });

    test('watch --init --plan crea una sola vinculacion schema-2 desatendida', () => {
        const plan: Extract<PlanValidationReport, { state: 'valid' }> = {
            state: 'valid', schema: 'compact-slices/v1', planDigest: 'a'.repeat(64),
            manifest: { schema: 'compact-slices/v1', planId: 'fixture', requirements: [], sources: [], commands: [], slices: [], closureCommands: [] },
        };
        const out = initWatch(repo, 'rama', { path: 'docs/plan.md', report: plan });
        expect(out.planBinding).toEqual(expect.objectContaining({ path: 'docs/plan.md', digest: 'a'.repeat(64), schema: 'compact-slices/v1', executionMode: 'desatendido' }));
        const state = readJournal(repo, 'rama').state!;
        expect(state.schema).toBe(2);
        expect(state.planBinding).toEqual(expect.objectContaining({ path: 'docs/plan.md', digest: 'a'.repeat(64) }));
        expect(() => initWatch(repo, 'rama', { path: 'docs/plan.md', report: plan })).toThrow(/sobrescribir|overwrite/i);
    });

    test('watch --init --plan bloquea un plan no valido antes de crear journal', () => {
        const invalid: PlanValidationReport = { state: 'invalid', diagnostics: [{ code: 'PLAN_SHAPE', message: 'bad' }] };
        expect(() => initWatch(repo, 'rama', { path: 'docs/plan.md', report: invalid })).toThrow(/válido/i);
        expect(readJournal(repo, 'rama').corrupt).toBe(true);
    });
});
