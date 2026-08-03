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
import { canCompleteCohort, reconcileTracks, defaultTrackRuntime } from '../../../src/commands/watch/tracks';
import { WrapperSpawner } from '../../../src/commands/watch/runner';
import { runExecWrapper } from '../../../src/commands/job/exec-wrapper';
import { initWatch } from '../../../src/commands/watch/init';
import { emitRequest, listPendingRequests } from '../../../src/core/journal/requests';
import { registerTrackIntegrationItems, consumePendingRequests } from '../../../src/commands/watch/apply';
import { activeGeneration } from '../../../src/commands/watch/generations';
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
    hasPendingCanonicalRequest(): boolean;
    applyPendingRequestsOnly(): void;
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
        // Finding 4 (ronda 2 de re-review): `runnerTick` (runner.ts) despacha
        // TODO job en `received` (`spawnPendingWrappers`) en la MISMA llamada
        // que lo colecciona/reconcilia — y esa llamada corre dentro del MISMO
        // `Supervisor.tick()` que, antes, ya aplicó (`consumePendingRequests`)
        // cualquier `job-request` pendiente escrito por un tick ANTERIOR. Por
        // eso, vía la API pública `tick()`, jamás hay un tick completo que
        // deje un job en `received` observable desde afuera — request
        // (aplicación) y despacho colapsan en el mismo tick. La única forma
        // honesta de reproducir ese punto exacto (el mismo que un crash real
        // SIN puntos de `await` de por medio podría alcanzar) es llamar,
        // directo, a la MISMA función que `tick()` invoca primero —
        // `consumePendingRequests` — sin llegar a `runnerTick`.
        hasPendingCanonicalRequest() {
            return listPendingRequests(repo, 'main').some((p) => !p.corrupt && p.envelope.kind === 'job-request'
                && Array.isArray((p.envelope.payload as { satisfies?: unknown }).satisfies)
                && ((p.envelope.payload as { satisfies: unknown[] }).satisfies).some((id) => typeof id === 'string' && id.startsWith('track-integration:')));
        },
        applyPendingRequestsOnly() {
            const gen = activeGeneration(readJournal(repo, 'main').state!);
            consumePendingRequests(repo, 'main', gen?.token ?? null);
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

    // Matriz de crash del Step 8 (R7.1-R7.7, C3/C4): reusabilidad idempotente
    // del job canónico probada en los CUATRO puntos que el plan nombra —
    // "después de QA" (autoreporte aceptado, NINGÚN job pedido todavía),
    // "después del request" (job pedido, aún sin correr/completar), "después
    // del pass" (job pasó, interlock todavía no corrió) y "antes de COMPLETE"
    // (interlock YA pasó — `cohortPhase` ya es `COMPLETE` — pero el chequeo
    // genérico de `Supervisor.tick()` que fija `cycle.status = 'COMPLETE'`
    // todavía no corrió sobre ese resultado). Las cuatro comparten el mismo
    // rigor: git real, un contador REAL de invocaciones del wrapper (nunca
    // solo una lectura del journal), y una assertion final de
    // `integrationWrapperCalls() === 1` — el job canónico jamás corre dos
    // veces sin importar en qué punto exacto "muere" el proceso.

    test('crash "después de QA": el autoreporte ya fue ACEPTADO (HEAD/árbol re-verificados, cohortPhase ya en FINAL_INTEGRATION) pero NINGÚN job se pidió todavía — el restart converge a un único job con todos los satisfiers (C4, R7.3)', async () => {
        h = finalizerHarness(['a', 'b']);
        h.allMerged();
        await h.tick();
        expect(h.nextAction()?.type).toBe('run-global-qa');

        h.reportQaPass();   // emite el request `track-finalize-request`
        // Post-review (Finding 3, ronda 2 de re-review): la version anterior
        // crasheaba ACA MISMO, sin tickear — es decir, ANTES de que
        // `consumePendingRequests` siquiera aplicara el autoreporte. Eso
        // probaba un escenario distinto (y ya cubierto por el resto de la
        // matriz vía el mismo idempotencyKey). El punto que el Step 8 pide
        // ("el autoreporte YA se aceptó, ningún job pedido todavía") exige
        // avanzar hasta que `reconcileTracks` haya corrido de verdad
        // `runRequestGlobalQa`: aplica `track-finalize-request`
        // (`s.qaFinalizeRequested`), RE-VERIFICA `qaHeadSha === HEAD real` y
        // árbol limpio (no confía ciegamente en el autoreporte, ver
        // `apply.ts`), y solo entonces observa `global-qa-pass` — el efecto
        // OBSERVABLE de esa aceptación es `cohortPhase` pasando a
        // `FINAL_INTEGRATION` (`protocol.ts::reconcileProtocol`, rama
        // `global-qa-pass`, fija `globalQaHeadSha` Y `cohortPhase` en LA
        // MISMA transición). Un solo tick real basta — probado
        // empíricamente: el mismo `reconcileTracks` que aplica el request
        // también ejecuta `request-global-qa` en esa misma llamada — pero
        // `tickUntil` en vez de `tick()` fijo documenta la condición real en
        // vez de un conteo de ticks frágil.
        await h.tickUntil(() => readJournal(h.repo, 'main').state!.cohortPhase === 'FINAL_INTEGRATION', 20);
        expect(readJournal(h.repo, 'main').state!.cohortPhase).toBe('FINAL_INTEGRATION');
        expect(readJournal(h.repo, 'main').state!.qaFinalizeRequested).toBeDefined();
        // El punto de crash exacto: el autoreporte ya fue aceptado Y
        // re-verificado, pero el job canónico todavía no se pidió (el
        // próximo efecto, `request-final-integration`, corre recién en un
        // tick DISTINTO — `runRequestFinalIntegration` ni siquiera se
        // invocó todavía).
        expect(h.requestedJobs()).toEqual([]);
        expect(h.integrationWrapperCalls()).toBe(0);

        h.crashAndRestart();   // "restart": un proceso nuevo retoma desde el journal ya persistido
        await h.tickUntil(() => h.requestedJobs().length === 1);
        await h.tickUntil(() => {
            const jobs = Object.values(readJournal(h.repo, 'main').state!.jobs)
                .filter((j) => j.satisfies?.some((id) => id.startsWith('track-integration:')));
            return jobs.length === 1 && jobs[0].executionState === 'exited';
        });

        const jobs = h.requestedJobs();
        expect(jobs).toHaveLength(1);   // nunca un subconjunto, ni siquiera arrancando de cero tras el crash
        expect(jobs[0].satisfies).toEqual(['track-integration:a', 'track-integration:b']);
        expect(h.integrationWrapperCalls()).toBe(1);   // exactamente una vez: ni cero (atascado), ni dos (duplicado)
    });

    test('crash "después del request": el job ya fue CREADO en el journal (`received`) pero AÚN no se despachó — el restart nunca pide un subconjunto ni duplica la ejecución (C4, R7.6)', async () => {
        h = finalizerHarness(['a', 'b']);
        h.allMerged();
        await h.tick();
        h.reportQaPass();

        // Post-review (Finding 4, ronda 2 de re-review): la version anterior
        // usaba `tickUntil(() => h.requestedJobs().length === 1)` como punto
        // de crash — pero `runner.ts::spawnPendingWrappers` despacha TODO job
        // `received` (invoca el wrapper) en la MISMA llamada de
        // `runnerTick` que ya corrió DENTRO del mismo tick que lo creó (ver
        // `runnerTick`/`spawnPendingWrappers`, runner.ts): para cuando el job
        // aparece en `requestedJobs()`, `integrationWrapperCalls()` YA es 1
        // — es decir, ese punto de crash colapsaba con "después del pass",
        // nunca representó "pedido pero sin despachar" (confirmado
        // empíricamente: en este mismo harness, el job nace directo en
        // `spawn-intent` con el wrapper ya invocado). La ÚNICA ventana real
        // de "recibido, aún sin despachar" es la que un crash SIN puntos de
        // `await` de por medio podría alcanzar dentro de un tick — entre que
        // `consumePendingRequests` persiste el job en `received` y que
        // `runnerTick` (más adelante en el MISMO `Supervisor.tick()`) lo
        // despacha. Se reproduce llamando esa MISMA función (la primera
        // mitad de ese tick) directo, sin completar el tick — mismo criterio
        // que la prueba "antes de COMPLETE" de abajo usa con `reconcileTracks`.
        for (let i = 0; i < 20 && !h.hasPendingCanonicalRequest(); i++) await h.tick();
        expect(h.hasPendingCanonicalRequest()).toBe(true);   // el pedido ya esta en disco...
        expect(h.requestedJobs()).toEqual([]);               // ...pero AUN no es un Job del journal

        h.applyPendingRequestsOnly();   // == la primera mitad exacta del proximo tick
        const created = Object.values(readJournal(h.repo, 'main').state!.jobs)
            .filter((j) => j.satisfies?.some((id) => id.startsWith('track-integration:')));
        expect(created).toHaveLength(1);
        expect(created[0].executionState).toBe('received');   // pedido y CREADO, pero SIN despachar
        expect(h.integrationWrapperCalls()).toBe(0);           // el wrapper jamas se invoco todavia

        h.crashAndRestart();
        // varios ticks más, ya con un proceso "nuevo": el mismo job se
        // reconoce por idempotencyKey (fingerprint+commandDigest+satisfies) —
        // jamás se pide un segundo job con un subconjunto, ni corre una
        // segunda vez de verdad (contador del wrapper, no solo el journal).
        await h.tickUntil(() => {
            const jobs = Object.values(readJournal(h.repo, 'main').state!.jobs)
                .filter((j) => j.satisfies?.some((id) => id.startsWith('track-integration:')));
            return jobs.length === 1 && jobs[0].executionState === 'exited';
        });

        const jobs = h.requestedJobs();
        expect(jobs).toHaveLength(1);
        expect(jobs[0].satisfies).toEqual(['track-integration:a', 'track-integration:b']);
        expect(h.integrationWrapperCalls()).toBe(1);   // exactamente una vez: nunca corrio dos veces por el crash
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

    test('crash "antes de COMPLETE": el interlock YA pasó (cohortPhase COMPLETE persistido) pero cycle.status todavía no flipeó — el restart converge sin repetir el job canónico (R7.4/R7.5)', async () => {
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
        // Deja que los ticks normales lleven la cohorte hasta FINAL_INTERLOCK
        // (integration-pass ya observado, `finalIntegrationJobId` fijado) —
        // el único efecto que falta es `run-final-interlock` en sí.
        await h.tickUntil(() => readJournal(h.repo, 'main').state!.cohortPhase === 'FINAL_INTERLOCK');
        expect(readJournal(h.repo, 'main').state!.cycle.status).toBe('IN_PROGRESS');

        // Punto de crash EXACTO que el Step 8 exige probar: `reconcileTracks`
        // (la MISMA función que `Supervisor.tick()` invoca internamente,
        // llamada acá directamente para poder detenernos a mitad de tick, algo
        // que la API pública de `tick()` — atómica de punta a punta — no deja
        // observar) corre el efecto `run-final-interlock` y persiste
        // `cohortPhase = 'COMPLETE'` — pero el chequeo genérico de
        // `Supervisor.tick()` (el ÚNICO lugar del código que fija
        // `cycle.status = 'COMPLETE'`) todavía no se ejecutó sobre ese
        // resultado. Un crash real (SIGKILL, sin puntos de `await` de por
        // medio entre las dos escrituras) puede caer exactamente acá.
        const before = readJournal(h.repo, 'main').state!;
        const runtime = defaultTrackRuntime(h.repo, 'main');
        const { state: afterInterlock, effectExecuted } = await reconcileTracks(
            h.repo, 'main', before, runtime, DEFAULT_SUPERVISOR_CONFIG.maxParallelTracks,
        );
        expect(effectExecuted).toBe('run-final-interlock');
        expect(afterInterlock.cohortPhase).toBe('COMPLETE');
        expect(afterInterlock.cycle.status).toBe('IN_PROGRESS');   // la ventana exacta del crash: todavía no flipeó
        expect(afterInterlock.tracks!.every((t) => t.phase === 'JOINED')).toBe(true);
        expect(h.integrationWrapperCalls()).toBe(1);   // el freeze de arriba no re-ejecuta el job canónico

        h.crashAndRestart();   // "restart": un Supervisor nuevo retoma sobre el journal ya persistido
        await h.tickUntil(() => readJournal(h.repo, 'main').state!.cycle.status === 'COMPLETE');

        const final = readJournal(h.repo, 'main').state!;
        expect(final.cycle.status).toBe('COMPLETE');
        expect(final.cohortPhase).toBe('COMPLETE');   // reconcileTracks no-opea (protocol.ts: null tras COMPLETE) — nunca retrocede
        expect(final.tracks!.every((t) => t.phase === 'JOINED')).toBe(true);
        expect(h.integrationWrapperCalls()).toBe(1);   // jamás una segunda ejecución real del job canónico
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
