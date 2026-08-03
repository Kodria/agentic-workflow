// Task 10 (R5.2/R5.8/R5.9/R6.3/R6.4/R6.5/C7): precondiciones puras de join +
// lock de integración real. `validateJoinReadiness`/`planJoinOrder` son
// puras (sin I/O) — se prueban con fixtures en memoria. El lock y
// `assertPlanHead` (git.ts) sí tocan el mundo real (fs + git) y se prueban
// con un repo real, mismo patrón que `tests/commands/watch/lock.test.ts`.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import {
    validateJoinReadiness, planJoinOrder, JoinReadiness,
    acquireIntegrationLock, releaseIntegrationLock, IntegrationLockBlockedError,
    stopControllerGenerationConfirmed,
} from '../../../src/core/tracks/join';
import { assertPlanHead, headSha } from '../../../src/core/tracks/git';
import { integrationLockPath } from '../../../src/core/journal/paths';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';

function readyJoin(overrides: Partial<JoinReadiness> = {}): JoinReadiness {
    return {
        frozenHeadSha: 'track-head', actualHeadSha: 'track-head', dirtyPaths: [],
        gatePass: true, liveJobs: 0, supervisorAlive: false, lockExists: false,
        ...overrides,
    };
}

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

describe('validateJoinReadiness (R6.4/R6.5)', () => {
    test('join exige freeze SHA, árbol limpio, gate recalculado, cero jobs y lock libre (R6.4, R6.5)', () => {
        const base = readyJoin({
            frozenHeadSha: 'track-head', actualHeadSha: 'track-head', dirtyPaths: [],
            gatePass: true, liveJobs: 0, supervisorAlive: false, lockExists: false,
        });
        expect(validateJoinReadiness(base)).toEqual({ ok: true });
        for (const mutation of [
            { dirtyPaths: ['untracked.txt'] }, { gatePass: false }, { liveJobs: 1 },
            { supervisorAlive: true }, { lockExists: true }, { actualHeadSha: 'moved' },
        ]) {
            expect(validateJoinReadiness({ ...base, ...mutation })).toMatchObject({ ok: false });
        }
    });

    test('dirty paths se nombran y nunca se descartan (R6.5)', () => {
        expect(validateJoinReadiness(readyJoin({ dirtyPaths: ['a.ts', 'new.txt'] })))
            .toEqual({ ok: false, reasons: ['worktree sucio: a.ts, new.txt'] });
    });

    test('dirty paths se ordenan deterministicamente sin importar el orden de entrada (R6.5)', () => {
        expect(validateJoinReadiness(readyJoin({ dirtyPaths: ['z.ts', 'a.ts'] })))
            .toEqual({ ok: false, reasons: ['worktree sucio: a.ts, z.ts'] });
    });

    test('múltiples hechos adversos se reportan TODOS, ninguno se pisa (R6.4)', () => {
        const result = validateJoinReadiness(readyJoin({ gatePass: false, liveJobs: 2, lockExists: true }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reasons).toEqual(expect.arrayContaining(['gate local rojo', '2 jobs vivos', 'lock de track retenido']));
            expect(result.reasons).toHaveLength(3);
        }
    });
});

describe('planJoinOrder (R5.7/R5.8/R5.9/C5)', () => {
    test('ownership real fuera de scope serializa joins restantes, no ejecución (R5.8, R5.9)', () => {
        const out = planJoinOrder(['a', 'b'], {
            a: { outsideOwnership: ['outside.ts'], globalClasses: [] },
            b: { outsideOwnership: [], globalClasses: [] },
        });
        expect(out).toEqual({
            mode: 'serial-joins', order: ['a', 'b'],
            violations: { a: ['outside.ts'] }, parallelInvalidatedBy: [],
        });
    });

    test('una clase global tocada de verdad invalida el paralelismo de la cohorte (R5.7, C5)', () => {
        const out = planJoinOrder(['a', 'b'], {
            a: { outsideOwnership: ['package-lock.json'], globalClasses: ['lockfile:package-lock.json'] },
            b: { outsideOwnership: [], globalClasses: [] },
        });
        expect(out.mode).toBe('serial-joins');
        expect(out.parallelInvalidatedBy).toEqual(['a:lockfile:package-lock.json']);
    });

    test('ownership limpia en todos los tracks preserva paralelismo (caso feliz)', () => {
        const out = planJoinOrder(['a', 'b'], {
            a: { outsideOwnership: [], globalClasses: [] },
            b: { outsideOwnership: [], globalClasses: [] },
        });
        expect(out).toEqual({ mode: 'parallel-joins', order: ['a', 'b'], violations: {}, parallelInvalidatedBy: [] });
    });
});

describe('acquireIntegrationLock / releaseIntegrationLock (R5.8/R5.9/C7)', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-integration-lock-')); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('adquisición exclusiva: una segunda adquisición falla mientras la primera vive', () => {
        const l1 = acquireIntegrationLock(repo, { planJournalId: 'j-1', expectedPlanHeadSha: 'sha-1' });
        expect(fs.existsSync(integrationLockPath(repo))).toBe(true);
        expect(() => acquireIntegrationLock(repo, { planJournalId: 'j-1', expectedPlanHeadSha: 'sha-1' })).toThrow(/integración activa/);
        releaseIntegrationLock(l1);
        expect(fs.existsSync(integrationLockPath(repo))).toBe(false);
    });

    test('el body persistido lleva planJournalId + expectedPlanHeadSha, no solo la identidad del proceso', () => {
        const l1 = acquireIntegrationLock(repo, { planJournalId: 'j-42', expectedPlanHeadSha: 'sha-42' });
        const onDisk = JSON.parse(fs.readFileSync(integrationLockPath(repo), 'utf8'));
        expect(onDisk).toMatchObject({ planJournalId: 'j-42', expectedPlanHeadSha: 'sha-42', pid: process.pid });
        releaseIntegrationLock(l1);
    });

    test('lock con identidad muerta PROBADA se reclama con reintento único', () => {
        fs.mkdirSync(path.dirname(integrationLockPath(repo)), { recursive: true });
        fs.writeFileSync(integrationLockPath(repo), JSON.stringify({
            pid: 999999, startTime: 'gone', spawnNonce: 'x', argvDigest: 'y', processGroup: 999999, psArgsDigest: 'z',
            planJournalId: 'j-old', expectedPlanHeadSha: 'sha-old',
        }));
        const l = acquireIntegrationLock(repo, { planJournalId: 'j-new', expectedPlanHeadSha: 'sha-new' });
        expect(l.ref.pid).toBe(process.pid);
        releaseIntegrationLock(l);
    });

    test('lock ilegible o con shape inválido => IntegrationLockBlockedError, JAMÁS se reclama', () => {
        fs.mkdirSync(path.dirname(integrationLockPath(repo)), { recursive: true });
        fs.writeFileSync(integrationLockPath(repo), '{roto');
        expect(() => acquireIntegrationLock(repo, { planJournalId: 'j', expectedPlanHeadSha: 's' })).toThrow(IntegrationLockBlockedError);
        fs.writeFileSync(integrationLockPath(repo), JSON.stringify({ pid: 1 }));   // shape parcial: falta planJournalId/expectedPlanHeadSha
        expect(() => acquireIntegrationLock(repo, { planJournalId: 'j', expectedPlanHeadSha: 's' })).toThrow(IntegrationLockBlockedError);
        expect(fs.existsSync(integrationLockPath(repo))).toBe(true);   // sigue ahí: nadie lo pisó
    });

    test('release solo borra el lock si sigue siendo el nuestro (spawnNonce coincide)', () => {
        const l1 = acquireIntegrationLock(repo, { planJournalId: 'j-1', expectedPlanHeadSha: 'sha-1' });
        // Simula que otro holder legítimo reclamó el lock después (ej. tras un
        // release nuestro que ya ocurrió y una segunda adquisición ajena) —
        // `releaseIntegrationLock` jamás borra un lock cuyo spawnNonce no es
        // el propio.
        fs.writeFileSync(integrationLockPath(repo), JSON.stringify({ ...l1.ref, spawnNonce: 'otro' }));
        releaseIntegrationLock(l1);
        expect(fs.existsSync(integrationLockPath(repo))).toBe(true);
        fs.rmSync(integrationLockPath(repo));
    });
});

describe('assertPlanHead (R5.8/R5.9/C7): TOCTOU entre intent y cualquier operación git', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-assert-head-')); git(repo, 'init', '-q', '-b', 'main'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('HEAD sin cambios: no lanza', () => {
        fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c1');
        const sha = headSha(repo);
        expect(() => assertPlanHead(repo, sha)).not.toThrow();
    });

    test('TOCTOU: adquirir el lock de integración con un expectedPlanHeadSha, mutar el HEAD del plan (commit humano), assertPlanHead BLOQUEA sin proceder', async () => {
        fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c1');
        const expectedSha = headSha(repo);

        // Intent: se adquiere el lock de integración con el SHA observado en
        // este instante — modela el "expected SHA" que cualquier operación
        // Git de join (Task 11) debe reverificar antes/después de mutar.
        const lock = acquireIntegrationLock(repo, { planJournalId: 'j-1', expectedPlanHeadSha: expectedSha });
        expect(() => assertPlanHead(repo, expectedSha)).not.toThrow();

        // Un humano muta el repo del plan MIENTRAS el lock está retenido —
        // "un humano puede mutar el repo, pero la mutación se detecta y
        // bloquea" (Step 5 del plan): jamás se procede con un merge sobre un
        // HEAD que ya no es el que se congeló al pedir el lock.
        fs.writeFileSync(path.join(repo, 'b.txt'), 'y');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'commit humano fuera de banda');

        // La operación de merge simulada consulta `assertPlanHead` con el
        // MISMO `expectedPlanHeadSha` que persistió el lock — BLOQUEA sin
        // haber tocado el repo (sin merge, R6/C7's "BLOCKED sin merge").
        expect(() => assertPlanHead(repo, expectedSha)).toThrow(/HEAD del plan cambió/);
        // El SHA drifteado se ve en el mensaje — no es un bloqueo silencioso.
        try {
            assertPlanHead(repo, expectedSha);
            throw new Error('no debería llegar acá');
        } catch (e) {
            expect((e as Error).message).toContain(expectedSha);
        }
        releaseIntegrationLock(lock);
    });

    test('fail-closed: repo ilegible (git falla) nunca se interpreta como "sin cambios"', () => {
        const gone = path.join(repo, 'no-existe-mas');
        expect(() => assertPlanHead(gone, 'cualquier-sha')).toThrow(/indemostrable/);
    });
});

describe('stopControllerGenerationConfirmed (R5.8/C7)', () => {
    const BRANCH = 'main';
    let planRoot: string;
    beforeEach(() => { planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-stop-gen-')); initJournal(planRoot, BRANCH); });
    afterEach(() => { fs.rmSync(planRoot, { recursive: true, force: true }); });

    test('sin generación activa: no-op, no lanza', async () => {
        await expect(stopControllerGenerationConfirmed(planRoot, BRANCH, { termGraceMs: 10, killGraceMs: 10 })).resolves.toBeUndefined();
    });

    test('generación activa sin processRef/wrapperRef vivos: se marca terminated sin intentar señales', async () => {
        const s = readJournal(planRoot, BRANCH).state!;
        s.generations.push({ n: 1, token: 'tok-1', state: 'active', launchedAt: new Date().toISOString() });
        writeJournal(planRoot, BRANCH, s);

        await stopControllerGenerationConfirmed(planRoot, BRANCH, { termGraceMs: 10, killGraceMs: 10 });
        const after = readJournal(planRoot, BRANCH).state!;
        expect(after.generations[0].state).toBe('terminated');
    });
});
