import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { Command } from 'commander';
import { detectRequiredVerifiers, initWatch, rebindWatchPlan } from '../../../src/commands/watch/init';
import { registerWatchCommand } from '../../../src/commands/watch';
import { readJournal, writeJournal } from '../../../src/core/journal/store';
import { supervisorLockPath } from '../../../src/core/journal/paths';
import type { PlanValidationReport } from '../../../src/core/plan/types';
import { validatePlanFile } from '../../../src/core/plan/validate';
import { initRepo } from '../../helpers/git-fixture';

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

    test('falla cerradamente ante un arbol de paquetes demasiado profundo o grande', () => {
        let cursor = repo;
        for (let depth = 0; depth < 65; depth++) { cursor = path.join(cursor, `d${depth}`); fs.mkdirSync(cursor); }
        expect(() => detectRequiredVerifiers(repo)).toThrow(/límite|limit/i);
    });

    test('falla cerradamente ante package.json que excede el límite de lectura', () => {
        fs.writeFileSync(path.join(repo, 'package.json'), '{"scripts":{"test":"x"},"padding":"' + 'x'.repeat(1024 * 1024) + '"}');
        expect(() => detectRequiredVerifiers(repo)).toThrow(/package\.json.*límite|package\.json.*limit/i);
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

    test('watch --init --plan rechaza paths con caracteres de control antes de persistir', () => {
        const report = { state: 'valid', schema: 'compact-slices/v1', planDigest: 'a'.repeat(64), manifest: {} } as PlanValidationReport;
        expect(() => initWatch(repo, 'rama', { path: 'docs/plan\u0000.md', report })).toThrow(/path inválido/);
        expect(readJournal(repo, 'rama').state).toBeNull();
    });

    test('rebind reconcilia un digest obsoleto tras actualizar el ciclo y conserva el binding anterior', () => {
        const original = validPlan('a');
        initWatch(repo, 'rama', { path: 'docs/plan.md', report: original });

        const rebound = rebindWatchPlan(repo, 'rama', { path: 'docs/plan.md', report: validPlan('b') });

        expect(rebound.digest).toBe('b'.repeat(64));
        const state = readJournal(repo, 'rama').state!;
        expect(state.planBinding).toEqual(expect.objectContaining({ digest: 'b'.repeat(64), path: 'docs/plan.md' }));
        expect(state.planBindingHistory).toEqual([expect.objectContaining({ digest: 'a'.repeat(64), path: 'docs/plan.md' })]);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);
    });

    test('rebind rechaza una ruta canónica distinta y deja el journal byte-a-byte intacto', () => {
        initWatch(repo, 'rama', { path: 'docs/plan.md', report: validPlan('a') });
        const before = readJournal(repo, 'rama').raw!;

        expect(() => rebindWatchPlan(repo, 'rama', { path: 'docs/other.md', report: validPlan('b') })).toThrow(/misma ruta/i);

        expect(readJournal(repo, 'rama').raw).toBe(before);
    });

    test('rebind rechaza un binding ya vigente y no inventa historia duplicada', () => {
        initWatch(repo, 'rama', { path: 'docs/plan.md', report: validPlan('a') });
        const before = readJournal(repo, 'rama').raw!;

        expect(() => rebindWatchPlan(repo, 'rama', { path: 'docs/plan.md', report: validPlan('a') })).toThrow(/ya está vigente/i);
        expect(readJournal(repo, 'rama').raw).toBe(before);
    });

    test('rebind rechaza evidencia adversa durable y no reescribe el binding obsoleto', () => {
        initWatch(repo, 'rama', { path: 'docs/plan.md', report: validPlan('a') });
        const state = readJournal(repo, 'rama').state!;
        state.verdicts.push({ id: 'v-1', obligationId: 'o-1', result: 'fail', detail: 'adverso', receivedAt: new Date().toISOString(), fingerprint: '', argv: [], paths: [], cwd: '.' });
        writeJournal(repo, 'rama', state);

        expect(() => rebindWatchPlan(repo, 'rama', { path: 'docs/plan.md', report: validPlan('b') })).toThrow(/evidencia adversa/i);
        expect(readJournal(repo, 'rama').state!.planBinding!.digest).toBe('a'.repeat(64));
    });

    test('rebind rechaza jobs no terminales y conserva el estado recuperable', () => {
        initWatch(repo, 'rama', { path: 'docs/plan.md', report: validPlan('a') });
        const state = readJournal(repo, 'rama').state!;
        state.jobs.pending = { id: 'pending', fingerprint: '', commandDigest: '', argv: [], cwd: '.', paths: [], expandedPaths: [], executionState: 'received', observationState: 'progressing', phaseTimestamps: {} };
        writeJournal(repo, 'rama', state);
        const before = readJournal(repo, 'rama').raw!;

        expect(() => rebindWatchPlan(repo, 'rama', { path: 'docs/plan.md', report: validPlan('b') })).toThrow(/no terminales/i);
        expect(readJournal(repo, 'rama').raw).toBe(before);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);
    });

    test('help declara rebind como ruta intencional separada de --init', () => {
        const program = new Command();
        registerWatchCommand(program);
        const watch = program.commands.find(command => command.name() === 'watch')!;
        expect(watch.helpInformation()).toContain('rebind');
        expect(watch.commands.find(command => command.name() === 'rebind')!.description()).toMatch(/reconcilia/i);
    });

    test('CLI compilado acepta exactamente `watch rebind --plan` y reconcilia el digest', () => {
        const cliRepo = initRepo();
        try {
            const planPath = path.join(cliRepo, 'docs', 'plan.md');
            fs.mkdirSync(path.dirname(planPath), { recursive: true });
            const plan = fs.readFileSync(path.join(__dirname, '../../core/plan/fixtures/compact-slices-v1/valid.md'), 'utf8');
            fs.writeFileSync(planPath, plan);
            fs.writeFileSync(path.join(cliRepo, 'source.md'), '## Canonical source\nfixture source\n');
            initWatch(cliRepo, 'main', { path: 'docs/plan.md', report: validatePlan(cliRepo, 'docs/plan.md') });
            fs.appendFileSync(planPath, '\nLifecycle checkbox completed.\n');

            const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../../dist/src/index.js'), 'watch', 'rebind', '--plan', 'docs/plan.md'], {
                cwd: cliRepo, encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' },
            });

            expect(result.status).toBe(0);
            expect(result.stderr).not.toContain('required option');
            expect(readJournal(cliRepo, 'main').state!.planBinding!.digest).toBe(validatePlan(cliRepo, 'docs/plan.md').planDigest);
        } finally { fs.rmSync(cliRepo, { recursive: true, force: true }); }
    });
});

function validPlan(digestCharacter: string): Extract<PlanValidationReport, { state: 'valid' }> {
    return {
        state: 'valid', schema: 'compact-slices/v1', planDigest: digestCharacter.repeat(64),
        manifest: { schema: 'compact-slices/v1', planId: 'fixture', requirements: [], sources: [], commands: [], slices: [], closureCommands: [] },
    };
}

function validatePlan(repo: string, relativePath: string): Extract<PlanValidationReport, { state: 'valid' }> {
    // Keep the external process test tied to the real compact validator, not a
    // hand-built report that could diverge from a lifecycle edit on disk.
    const report = validatePlanFile(relativePath, repo);
    if (report.state !== 'valid') throw new Error(`fixture plan unexpectedly invalid: ${JSON.stringify(report)}`);
    return report;
}
