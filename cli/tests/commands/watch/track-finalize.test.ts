// Task 12 (R3.6, R7.1-R7.7, R8.1/R8.2, C3/C4): QA final, integración canónica
// única e interlock. Dos frentes:
//   A. `canCompleteCohort` — pura, sin I/O (R8.1).
//   B. El finalizer end-to-end: `Supervisor.tick()` real + `reconcileTracks`
//      real, sobre un repo git real y un journal real — mismo criterio que
//      `track-freeze.test.ts`/`track-runtime-git.test.ts`: la única forma
//      honesta de probar C3/C4 (un único job canónico, con el conjunto
//      COMPLETO de satisfiers, superviviente a un crash/restart) es contra
//      journal y git reales, nunca un mock del protocolo.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Supervisor, DEFAULT_SUPERVISOR_CONFIG } from '../../../src/commands/watch/supervisor';
import { canCompleteCohort } from '../../../src/commands/watch/tracks';
import { WrapperSpawner } from '../../../src/commands/watch/runner';
import { runExecWrapper } from '../../../src/commands/job/exec-wrapper';
import { initWatch } from '../../../src/commands/watch/init';
import { emitRequest } from '../../../src/core/journal/requests';
import { registerTrackIntegrationItems } from '../../../src/commands/watch/apply';
import { readJournal, writeJournal } from '../../../src/core/journal/store';
import { computeGate, GateResult } from '../../../src/commands/job/gate';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';
import { integrationLockPath } from '../../../src/core/journal/paths';
import { emptyState } from '../../../src/core/journal/types';
import type { Job, JournalState, TrackRef } from '../../../src/core/journal/types';

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
}

// --- Parte A: canCompleteCohort (R8.1), pura ------------------------------

function trackRef(trackId: string, phase: TrackRef['phase']): TrackRef {
    return {
        trackId, worktreePath: `/tmp/${trackId}`, branch: `awm-track/${trackId}`,
        ownership: [], sharedResources: [], dependsOn: [],
        fencingToken: `f-${trackId}`.padEnd(32, '0'), phase, readinessNonce: `r-${trackId}`.padEnd(32, '0'),
    };
}

function stateWithPhases(phases: Record<string, TrackRef['phase']>): JournalState {
    const s = emptyState('main');
    s.tracks = Object.entries(phases).map(([id, phase]) => trackRef(id, phase));
    return s;
}

describe('canCompleteCohort (R8.1, Task 12)', () => {
    test('un track pendiente mantiene IN_PROGRESS y lo nombra', () => {
        expect(canCompleteCohort(stateWithPhases({ a: 'MERGED_UNVERIFIED', b: 'FROZEN' })))
            .toEqual({ complete: false, pendingTracks: ['b'] });
    });

    test('todos MERGED_UNVERIFIED: completo, sin pendientes', () => {
        expect(canCompleteCohort(stateWithPhases({ a: 'MERGED_UNVERIFIED', b: 'MERGED_UNVERIFIED' })))
            .toEqual({ complete: true, pendingTracks: [] });
    });

    test('menos de dos tracks nunca se considera completo', () => {
        expect(canCompleteCohort(stateWithPhases({ a: 'MERGED_UNVERIFIED' })))
            .toEqual({ complete: false, pendingTracks: [] });
    });

    test('sin tracks (journal que no es de una cohorte): nunca completo', () => {
        expect(canCompleteCohort(emptyState('main'))).toEqual({ complete: false, pendingTracks: [] });
    });
});

// --- Parte B: el finalizer end-to-end -------------------------------------

const INTEGRATION_ARGV = ['npm', 'test', '--', '--runInBand'];
const INTEGRATION_PATHS = ['cli/src/**', 'cli/tests/**'];

interface Harness {
    repo: string;
    tick(): Promise<string>;
    tickUntil(predicate: () => boolean, maxTicks?: number): Promise<string>;
    markMerged(trackId: string): string;
    allMerged(): string;
    reportQaPass(): string;
    nextAction(): JournalState['cycle']['nextAction'];
    requestedJobs(): Array<{ argv: string[]; paths: string[]; cwd: string; satisfies: string[] }>;
    integrationWrapperCalls(): number;
    crashAndRestart(): void;
    interlock(): GateResult;
    moveHeadUnrelated(): string;
    cleanup(): void;
}

/** Repo real con dos tracks 'a'/'b' YA declarados en la cohorte (fase inicial
 *  ACTIVE — jamás FROZEN_OR_LATER — para que `nextProtocolEffect` no intente
 *  ningún efecto de freeze/merge mientras el harness los marca MERGED_UNVERIFIED
 *  directamente: Task 12 empieza DESPUÉS de que Task 10/11 ya mergearon,
 *  reproducir ESE camino no es responsabilidad de esta suite). El contrato
 *  canónico de integración (`trackIntegration`) se registra desde el arranque
 *  (Step 6) — sin él, `runRequestFinalIntegration` jamás pide el job. */
function finalizerHarness(trackIds: string[]): Harness {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-finalize-'));
    git(repo, 'init', '-q', '-b', 'main');
    // `true` ignora cualquier argumento extra (`npm test -- --runInBand` pasa
    // `--runInBand` al script) y siempre sale 0 — a diferencia de `node -e`,
    // que interpreta `--runInBand` como flag de node y falla con exit 9.
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'true' } }));
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'seed');
    fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), '{}');
    initWatch(repo, 'main');   // gitignora .awm, detecta requiredVerifiers (test+sensors, R3.6)
    git(repo, 'add', '.gitignore'); git(repo, 'commit', '-qm', 'gitignore .awm');
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    const stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-finalize-stub-'));
    fs.writeFileSync(path.join(stubBin, 'codex'), '#!/bin/sh\nwhile true; do sleep 1; done\n', { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${stubBin}:${process.env.PATH}`;

    let integrationCalls = 0;
    const spawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
        if (job.satisfies?.some((id) => id.startsWith('track-integration:'))) integrationCalls++;
        void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: job.cwd, repoRoot }).catch(() => {});
    };

    const s0 = readJournal(repo, 'main').state!;
    // 'test'/'sensors' (R1/R3.6, pre-existente): el repo YA los exige
    // (`requiredVerifiers`, detectados arriba) — sin ALGÚN item de esos kinds
    // en algún plan, `computeGate` jamás certifica por ausencia, sin importar
    // qa/interlock/track-integration. En un cohorte real viven en el journal
    // de CADA track; acá, fuera de ese alcance, se modelan a nivel de ciclo.
    s0.cycleVerificationPlan = [
        { id: 'qa', kind: 'qa' }, { id: 'interlock', kind: 'interlock' },
        { id: 'test', kind: 'test' }, { id: 'sensors', kind: 'sensors' },
    ];
    s0.tracks = trackIds.map((id) => trackRef(id, 'ACTIVE'));
    s0.cohortPhase = 'JOINING';
    s0.cohortBaseSha = baseSha;
    s0.cohortPlanHeadSha = baseSha;
    // Mismo efecto que `track-prepare-request` produce en producción (R7.3) —
    // el harness declara los tracks directamente (sin pasar por el protocolo
    // completo de bootstrap P1/P2, fuera de alcance de esta suite) pero SÍ
    // necesita el mismo resultado: los items `track-integration:*` deben
    // existir en el plan ANTES de que cualquier job pueda enlazarse a ellos.
    registerTrackIntegrationItems(s0);
    writeJournal(repo, 'main', s0);
    emitRequest(repo, 'main', {
        kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'ti-contract',
        payload: { entity: 'track-integration', argv: INTEGRATION_ARGV, paths: INTEGRATION_PATHS, planDigest: 'plan-1' },
    });

    const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10, provider: 'codex' };
    let sup = new Supervisor(repo, 'main', cfg, spawner);

    const realFingerprintNow = (argv: string[], paths: string[], cwd: string): string | null => {
        try { return computeFingerprint(repo, argv, paths, cwd).fingerprint; } catch { return null; }
    };

    return {
        repo,
        async tick() { return sup.tick(); },
        async tickUntil(predicate, maxTicks = 400) {
            let outcome = 'continue';
            for (let i = 0; i < maxTicks && !predicate(); i++) {
                outcome = await sup.tick();
                if (predicate()) break;
                await new Promise((r) => setTimeout(r, 15));
            }
            return outcome;
        },
        markMerged(trackId) {
            const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
            const s = readJournal(repo, 'main').state!;
            s.tracks = (s.tracks ?? []).map((t) => (t.trackId === trackId
                ? { ...t, phase: 'MERGED_UNVERIFIED' as const, frozenHeadSha: sha, joinedCommitSha: sha }
                : t));
            writeJournal(repo, 'main', s);
            return sha;
        },
        allMerged() {
            const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
            const s = readJournal(repo, 'main').state!;
            s.tracks = (s.tracks ?? []).map((t) => ({ ...t, phase: 'MERGED_UNVERIFIED' as const, frozenHeadSha: sha, joinedCommitSha: sha }));
            s.cohortPlanHeadSha = sha;
            writeJournal(repo, 'main', s);
            return sha;
        },
        reportQaPass() {
            // El "controller" corrige hallazgos y comitea (Step 7.2) — acá,
            // sintéticamente, un archivo nuevo representa ese fix.
            fs.writeFileSync(path.join(repo, 'qa-fix.txt'), 'fix');
            git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'post-implementation-qa fixes');
            const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
            // 'qa'/'interlock'/'test'/'sensors' del ciclo (R1, pre-existente):
            // satisfechos EN ESTE MISMO HEAD — ningún commit posterior los
            // invalida antes del interlock final (el job canónico de
            // integración no comitea).
            for (const itemId of ['qa', 'interlock', 'test', 'sensors']) {
                const argv = ['node', '-e', 'process.exit(0)'];
                const fp = computeFingerprint(repo, argv, [], '.');
                const s = readJournal(repo, 'main').state!;
                const jobId = `job-${itemId}`;
                const job: Job = {
                    id: jobId, fingerprint: fp.fingerprint, commandDigest: fp.commandDigest, argv, cwd: '.',
                    paths: [], expandedPaths: fp.expandedPaths, executionState: 'exited', observationState: 'progressing',
                    verdict: 'pass', phaseTimestamps: {}, satisfies: [itemId],
                };
                s.jobs[jobId] = job;
                const item = s.cycleVerificationPlan.find((x) => x.id === itemId)!;
                item.satisfiedBy = jobId;
                writeJournal(repo, 'main', s);
            }
            emitRequest(repo, 'main', {
                kind: 'track-finalize-request', generationToken: 'g0', idempotencyKey: `finalize-${sha}`,
                payload: { qaHeadSha: sha },
            });
            return sha;
        },
        nextAction() { return readJournal(repo, 'main').state!.cycle.nextAction; },
        requestedJobs() {
            return Object.values(readJournal(repo, 'main').state!.jobs)
                .filter((j) => j.satisfies?.some((id) => id.startsWith('track-integration:')))
                .map((j) => ({ argv: j.argv, paths: j.paths, cwd: j.cwd, satisfies: [...(j.satisfies ?? [])].sort() }));
        },
        integrationWrapperCalls() { return integrationCalls; },
        crashAndRestart() { sup = new Supervisor(repo, 'main', cfg, spawner); },
        interlock() {
            const s = readJournal(repo, 'main').state!;
            return computeGate(s, false, realFingerprintNow);
        },
        moveHeadUnrelated() {
            fs.writeFileSync(path.join(repo, 'unrelated.txt'), String(Date.now()));
            git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'unrelated change');
            return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
        },
        cleanup() {
            process.env.PATH = oldPath;
            fs.rmSync(repo, { recursive: true, force: true });
            fs.rmSync(stubBin, { recursive: true, force: true });
        },
    };
}

describe('finalizer end-to-end (R7.1-R7.7, C3/C4, Task 12)', () => {
    jest.setTimeout(60000);

    let h: Harness;
    afterEach(() => h?.cleanup());

    test('solo el HEAD final recibe QA e integración (R7.7, C3): un merge aislado no dispara nada', async () => {
        h = finalizerHarness(['a', 'b']);
        h.markMerged('a');
        await h.tick();
        expect(h.requestedJobs()).toEqual([]);
        expect(h.nextAction()?.type).not.toBe('run-global-qa');

        h.allMerged();   // ahora AMBOS están MERGED_UNVERIFIED
        await h.tick();
        expect(h.nextAction()).toMatchObject({ type: 'run-global-qa', target: 'cycle' });
    });

    test('QA con fixes culmina en commit limpio antes del job canónico (C3/C4): un único job con TODOS los satisfiers', async () => {
        h = finalizerHarness(['a', 'b']);
        h.allMerged();
        await h.tick();   // persiste nextAction run-global-qa
        expect(h.nextAction()?.type).toBe('run-global-qa');

        const qaHead = h.reportQaPass();
        // converge: aceptar el autoreporte -> (pausar controller si hace
        // falta) -> pedir el job canónico -> el job se ejecuta y pasa.
        await h.tickUntil(() => h.requestedJobs().length > 0 && h.requestedJobs()[0].argv.length > 0);
        await h.tickUntil(() => {
            const jobs = h.requestedJobs();
            return jobs.length === 1;   // nunca más de uno
        });

        const jobs = h.requestedJobs();
        expect(jobs).toEqual([{
            argv: INTEGRATION_ARGV, paths: INTEGRATION_PATHS, cwd: '.',
            satisfies: ['track-integration:a', 'track-integration:b'],
        }]);
        void qaHead;
    });

    test('el finalizer nunca pide un subconjunto de satisfiers, ni siquiera tras un crash/restart (C4, R7.6)', async () => {
        h = finalizerHarness(['a', 'b']);
        h.allMerged();
        await h.tick();
        h.reportQaPass();
        await h.tickUntil(() => h.requestedJobs().length === 1);

        h.crashAndRestart();
        // varios ticks más, ya con un proceso "nuevo": el mismo job se
        // reconoce por idempotencyKey (fingerprint+commandDigest+satisfies) —
        // jamás se pide un segundo job con un subconjunto.
        for (let i = 0; i < 5; i++) await h.tick();

        const jobs = h.requestedJobs();
        expect(jobs).toHaveLength(1);
        expect(jobs[0].satisfies).toEqual(['track-integration:a', 'track-integration:b']);
    });

    test('el job canónico se ejecuta UNA sola vez (contador del wrapper) a través de un crash/restart', async () => {
        h = finalizerHarness(['a', 'b']);
        h.allMerged();
        await h.tick();
        h.reportQaPass();
        await h.tickUntil(() => {
            const jobs = Object.values(readJournal(h.repo, 'main').state!.jobs)
                .filter((j) => j.satisfies?.some((id) => id.startsWith('track-integration:')));
            return jobs.length === 1 && jobs[0].executionState === 'exited';
        });
        expect(h.integrationWrapperCalls()).toBe(1);

        h.crashAndRestart();
        for (let i = 0; i < 5; i++) await h.tick();
        expect(h.integrationWrapperCalls()).toBe(1);   // jamás una segunda ejecución real
    });

    test('al pasar el job canónico, el interlock global (computeGate) certifica y no antes', async () => {
        h = finalizerHarness(['a', 'b']);
        h.allMerged();
        await h.tick();
        h.reportQaPass();
        await h.tickUntil(() => {
            const jobs = Object.values(readJournal(h.repo, 'main').state!.jobs)
                .filter((j) => j.satisfies?.some((id) => id.startsWith('track-integration:')));
            return jobs.length === 1 && jobs[0].executionState === 'exited';
        });
        // El interlock certifica UNA VEZ que la evidencia (qa, interlock,
        // track-integration:* de ambos tracks) está completa y vigente.
        expect(h.interlock().pass).toBe(true);

        await h.tickUntil(() => readJournal(h.repo, 'main').state!.cohortPhase === 'COMPLETE');
        const final = readJournal(h.repo, 'main').state!;
        expect(final.cohortPhase).toBe('COMPLETE');
        expect(final.tracks!.every((t) => t.phase === 'JOINED')).toBe(true);
        // R7.5: integration.lock liberado al cerrar la cohorte.
        expect(fs.existsSync(integrationLockPath(h.repo))).toBe(false);
    });

    test('mutación DESPUÉS de que el job canónico pasó vuelve stale el cierre (R7.7)', async () => {
        h = finalizerHarness(['a', 'b']);
        h.allMerged();
        await h.tick();
        h.reportQaPass();
        await h.tickUntil(() => {
            const jobs = Object.values(readJournal(h.repo, 'main').state!.jobs)
                .filter((j) => j.satisfies?.some((id) => id.startsWith('track-integration:')));
            return jobs.length === 1 && jobs[0].executionState === 'exited';
        });
        expect(h.interlock().pass).toBe(true);

        h.moveHeadUnrelated();   // el árbol mutó DESPUÉS de que la evidencia se fijó
        const stale = h.interlock();
        expect(stale.pass).toBe(false);
        expect(stale.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'stale-fingerprint' })]));
    });
});
