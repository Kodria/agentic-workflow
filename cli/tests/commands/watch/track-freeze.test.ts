// Task 10 (R5.2/R5.7/R5.8/R5.9/R6.3/R6.4/R6.5/C5): freeze del track,
// quiescencia del plan y precondiciones de join. Dos frentes, cada uno con
// git REAL (mismo criterio que `track-bootstrap-crash.test.ts`/
// `track-runtime-git.test.ts` — la única forma honesta de probar C5/R6.4 es
// mirar el repo real, no solo eventos):
//   1. `runFreezeTrack` (driver del PLAN, en `reconcileTracks`): emite la
//      request cross-journal, observa (read-only) el journal del track, y
//      solo acepta FROZEN cuando los 6 hechos son demostrables — incluida la
//      comparación de ownership post-hoc (Step 6/C5).
//   2. `Supervisor.tick()` de un track individual: ejecuta las 6
//      observaciones reales (drenar, gate local, worktree limpio, terminar
//      su propia generación) y persiste `frozen` — nunca antes de que todo
//      sea demostrable.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { reconcileTracks, defaultTrackRuntime, TrackRuntime, SupervisorObservation } from '../../../src/commands/watch/tracks';
import { Supervisor, DEFAULT_SUPERVISOR_CONFIG } from '../../../src/commands/watch/supervisor';
import { WrapperSpawner } from '../../../src/commands/watch/runner';
import { runExecWrapper } from '../../../src/commands/job/exec-wrapper';
import { initWatch } from '../../../src/commands/watch/init';
import { requestJob } from '../../../src/commands/job/request';
import { emitRequest, listPendingRequests } from '../../../src/core/journal/requests';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import type { JournalState, TrackRef } from '../../../src/core/journal/types';

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });
}

// --- Parte 1: runFreezeTrack (driver del PLAN) ------------------------------

describe('runFreezeTrack — driver del PLAN (R5.2/R5.7/R5.8/R5.9/C5)', () => {
    const PLAN_BRANCH = 'main';
    const TRACK_BRANCH = 'awm-track/a';
    let planRoot: string;
    let trackWorktree: string;
    let baseSha: string;

    beforeEach(() => {
        planRoot = initRepo();
        commitFile(planRoot, '.gitignore', '.awm/\n');
        baseSha = commitFile(planRoot, 'seed.txt', 'seed');
        // Worktree real del track — un `git worktree add` de verdad, para que
        // `mergeBase`/`changedPaths` (llamados contra `planRoot`) vean
        // commits reales del track (mismo object store). El journal propio
        // del track se inicializa EN SU PROPIA rama (`TRACK_BRANCH`) — igual
        // que `defaultTrackRuntime.initTrackJournal` haría en producción.
        trackWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-freeze-wt-'));
        fs.rmdirSync(trackWorktree);
        git(planRoot, 'worktree', 'add', '-b', TRACK_BRANCH, trackWorktree, baseSha);
        initJournal(trackWorktree, TRACK_BRANCH);
    });

    afterEach(() => {
        try { execFileSync('git', ['worktree', 'remove', '--force', trackWorktree], { cwd: planRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
        try { execFileSync('git', ['worktree', 'prune'], { cwd: planRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(trackWorktree, { recursive: true, force: true });
    });

    function trackJournal(): JournalState { return readJournal(trackWorktree, TRACK_BRANCH).state!; }

    function declarePlan(ownership: string[] = []): JournalState {
        initJournal(planRoot, PLAN_BRANCH);
        const s0 = readJournal(planRoot, PLAN_BRANCH).state!;
        s0.cohortPhase = 'ACTIVE';
        s0.cohortBaseSha = baseSha;
        s0.tracks = [
            {
                trackId: 'a', worktreePath: trackWorktree, branch: TRACK_BRANCH,
                ownership, sharedResources: [], dependsOn: [],
                fencingToken: 'fence-a'.padEnd(32, '0'), phase: 'JOIN_REQUESTED', readinessNonce: 'ready-a'.padEnd(32, '0'),
            },
            {
                // Segundo track: satisface el mínimo de 2 de `initialCohort`
                // y se mantiene ACTIVE — no participa de este freeze.
                trackId: 'b', worktreePath: path.join(planRoot, 'nope-b'), branch: 'awm-track/b',
                ownership: [], sharedResources: [], dependsOn: [],
                fencingToken: 'fence-b'.padEnd(32, '0'), phase: 'ACTIVE', readinessNonce: 'ready-b'.padEnd(32, '0'),
            },
        ] satisfies TrackRef[];
        writeJournal(planRoot, PLAN_BRANCH, s0);
        return readJournal(planRoot, PLAN_BRANCH).state!;
    }

    function fakeRuntime(overrides: Partial<TrackRuntime> = {}): TrackRuntime {
        const real = defaultTrackRuntime(planRoot, PLAN_BRANCH);
        return {
            addWorktree: () => { throw new Error('no debería llamarse'); },
            initTrackJournal: () => { throw new Error('no debería llamarse'); },
            spawnSupervisor: () => { throw new Error('no debería llamarse'); },
            observeSupervisor: (): SupervisorObservation => ({ kind: 'absent' }),
            async teardownOwned() { throw new Error('no debería llamarse'); },
            emitFreezeRequest: real.emitFreezeRequest,
            ...overrides,
        };
    }

    test('emite track-freeze-request al journal PROPIO del track (cross-worktree) y jamás escribe ese journal directamente', async () => {
        const s = declarePlan();
        const runtime = fakeRuntime();
        const result = await reconcileTracks(planRoot, PLAN_BRANCH, s, runtime, 2);

        // El plan NO mutó nada del lado del track ni de sí mismo (todavía en
        // JOIN_REQUESTED — este call solo emitió la request).
        const a = result.state.tracks!.find((t) => t.trackId === 'a')!;
        expect(a.phase).toBe('JOIN_REQUESTED');
        expect(a.frozenHeadSha).toBeUndefined();

        // La request llegó de verdad al requestsDir del TRACK.
        const pending = listPendingRequests(trackWorktree, TRACK_BRANCH);
        expect(pending).toHaveLength(1);
        expect(pending[0].envelope.kind).toBe('track-freeze-request');

        // El journal del track sigue sin `freezeRequested` — nadie lo
        // consumió todavía (eso es responsabilidad exclusiva del propio
        // `Supervisor.tick()` del track, no de este driver).
        expect(trackJournal().freezeRequested).toBeUndefined();
    });

    test('no duplica la request mientras la primera sigue sin consumir (read-only antes de tocar runtime)', async () => {
        const s = declarePlan();
        let emitCalls = 0;
        const runtime = fakeRuntime({
            emitFreezeRequest: (ref, token) => { emitCalls++; defaultTrackRuntime(planRoot, PLAN_BRANCH).emitFreezeRequest(ref, token); },
        });
        await reconcileTracks(planRoot, PLAN_BRANCH, s, runtime, 2);
        await reconcileTracks(planRoot, PLAN_BRANCH, s, runtime, 2);
        await reconcileTracks(planRoot, PLAN_BRANCH, s, runtime, 2);
        expect(emitCalls).toBe(1);
        expect(listPendingRequests(trackWorktree, TRACK_BRANCH)).toHaveLength(1);
    });

    test('acepta FROZEN solo cuando supervisor muerto Y lock libre confirman el autoreporte del track (R6.4)', async () => {
        const s = declarePlan();
        // Simula que el propio track YA completó sus 6 pasos internos
        // (`Supervisor.tick()` de Parte 2 hace esto de verdad) — acá se
        // fuerza directamente para aislar la lógica del lado del PLAN.
        const frozenHeadSha = commitFile(trackWorktree, 'work.ts', 'work');
        const ts = trackJournal();
        ts.frozen = { headSha: frozenHeadSha, at: new Date().toISOString() };
        writeJournal(trackWorktree, TRACK_BRANCH, ts);

        // `ref.supervisorProcessRef` ausente => `supervisorAlive` falso por
        // definición; ningún `supervisor.lock` real en `trackWorktree`.
        const runtime = fakeRuntime();
        const result = await reconcileTracks(planRoot, PLAN_BRANCH, s, runtime, 2);

        const a = result.state.tracks!.find((t) => t.trackId === 'a')!;
        expect(a.phase).toBe('FROZEN');
        expect(a.frozenHeadSha).toBe(frozenHeadSha);
        expect(result.state.cohortPhase).toBe('JOINING');
    });

    test('supervisor vivo (identidad viva) o lock retenido: NO acepta FROZEN aunque el track ya se autoreportó (R6.4)', async () => {
        const s = declarePlan();
        const frozenHeadSha = commitFile(trackWorktree, 'work.ts', 'work');
        const ts = trackJournal();
        ts.frozen = { headSha: frozenHeadSha, at: new Date().toISOString() };
        writeJournal(trackWorktree, TRACK_BRANCH, ts);

        // Simular lock retenido: archivo real en la ruta esperada.
        fs.mkdirSync(path.join(trackWorktree, '.awm', 'journal'), { recursive: true });
        fs.writeFileSync(path.join(trackWorktree, '.awm', 'journal', 'supervisor.lock'), '{}');

        const runtime = fakeRuntime();
        const result = await reconcileTracks(planRoot, PLAN_BRANCH, s, runtime, 2);
        const a = result.state.tracks!.find((t) => t.trackId === 'a')!;
        expect(a.phase).toBe('JOIN_REQUESTED');   // sin mover: lock todavía retenido
        expect(a.frozenHeadSha).toBeUndefined();
    });

    test('ownership real fuera de declaración serializa (violación nombrada) sin revertir el freeze (R5.8/R5.9)', async () => {
        const s = declarePlan(['src/']);   // el track declara ownership de src/ solamente
        fs.mkdirSync(path.join(trackWorktree, 'src'), { recursive: true });
        commitFile(trackWorktree, 'src/a.ts', 'in-scope');
        const frozenHeadSha = commitFile(trackWorktree, 'outside.txt', 'fuera de ownership');
        const ts = trackJournal();
        ts.frozen = { headSha: frozenHeadSha, at: new Date().toISOString() };
        writeJournal(trackWorktree, TRACK_BRANCH, ts);

        const runtime = fakeRuntime();
        const result = await reconcileTracks(planRoot, PLAN_BRANCH, s, runtime, 2);
        const a = result.state.tracks!.find((t) => t.trackId === 'a')!;
        expect(a.phase).toBe('FROZEN');   // el freeze en sí NUNCA se revierte
        expect(result.state.cohortParallelInvalidatedBy ?? []).toEqual([]);   // outside.txt no es una clase global
    });

    test('una clase global tocada de verdad invalida el paralelismo de la cohorte y se persiste para futuros awm watch (R5.7/C5)', async () => {
        const s = declarePlan(['src/']);
        const frozenHeadSha = commitFile(trackWorktree, 'package-lock.json', '{}');
        const ts = trackJournal();
        ts.frozen = { headSha: frozenHeadSha, at: new Date().toISOString() };
        writeJournal(trackWorktree, TRACK_BRANCH, ts);

        const runtime = fakeRuntime();
        const result = await reconcileTracks(planRoot, PLAN_BRANCH, s, runtime, 2);
        const a = result.state.tracks!.find((t) => t.trackId === 'a')!;
        expect(a.phase).toBe('FROZEN');
        expect(result.state.cohortParallelInvalidatedBy).toEqual(['a:lockfile:package-lock.json']);
    });
});

// --- Parte 2: Supervisor.tick() de un track individual ----------------------

describe('Supervisor.tick() — freeze de un track individual (R5.2/R6.3)', () => {
    jest.setTimeout(60000);

    const BRANCH = 'main';

    const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
        void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: job.cwd, repoRoot }).catch(() => {});
    };

    let repo: string;
    let stubBin: string;
    let oldPath: string | undefined;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-freeze-sup-'));
        git(repo, 'init', '-q', '-b', BRANCH);
        fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
        fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), '{}');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'config');

        stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-stub-'));
        fs.writeFileSync(path.join(stubBin, 'codex'), '#!/bin/sh\nwhile true; do sleep 1; done\n', { mode: 0o755 });
        oldPath = process.env.PATH;
        process.env.PATH = `${stubBin}:${process.env.PATH}`;
    });
    afterEach(() => {
        process.env.PATH = oldPath;
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(stubBin, { recursive: true, force: true });
    });

    function emitVerdict(obligationId: string, verdictId: string): void {
        const argv = ['awm-review', obligationId];
        const fp = computeFingerprint(repo, argv, [], '.').fingerprint;
        emitRequest(repo, BRANCH, { kind: 'verdict', generationToken: 'g0', idempotencyKey: verdictId,
            payload: { verdictId, obligationId, result: 'pass', detail: 'ok', fingerprint: fp, argv, paths: [], cwd: '.' } });
    }

    function setUpGreenTrack(): void {
        initWatch(repo, BRANCH);
        // `initWatch` ESCRIBE `.gitignore` (`.awm/`) pero no lo commitea — un
        // `.gitignore` sin trackear es en sí mismo un path "untracked" para
        // `git status --porcelain` (R6.4's chequeo de limpieza no distingue
        // "sucio de verdad" de "el propio bootstrap del journal"). Sin este
        // commit, `isWorktreeClean` nunca sería `true` y el freeze jamás
        // convergería — no por un bug del driver, sino por un repo de test
        // que nunca terminó su propio setup.
        git(repo, 'add', '.gitignore'); git(repo, 'commit', '-qm', 'gitignore .awm');
        const s = readJournal(repo, BRANCH).state!;
        s.trackContext = { trackId: 'a', taskIds: ['T1'], planDigest: '', baseSha: 'seed', planJournalId: 'j-plan' };
        writeJournal(repo, BRANCH, s);
        emitRequest(repo, BRANCH, { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }, { id: 'v-sensors', kind: 'sensors' }], reviewObligations: [{ id: 'o-spec', kind: 'spec' }, { id: 'o-quality', kind: 'quality' }] } });
        // argv DISTINTOS a propósito: mismo argv/paths/cwd => mismo
        // fingerprint => `apply.ts` colapsa el segundo `job-request` en el
        // mismo job del primero (RNF-T.7, "un mismo resultado satisface más
        // de un item") — acá se quieren DOS jobs reales y vivos para
        // ejercitar el drenaje del freeze (paso 2), no una sola ejecución
        // compartida.
        requestJob(repo, BRANCH, 'g0', ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'v1' });
        requestJob(repo, BRANCH, 'g0', ['node', '-e', '0; process.exit(0)'], [], '.', { satisfies: 'v-sensors' });
        emitVerdict('o-spec', 'verd-spec');
        emitVerdict('o-quality', 'verd-quality');
        emitRequest(repo, BRANCH, { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e3',
            payload: { entity: 'task-status', taskId: 'T1', status: 'done' } });
    }

    function requestFreeze(): void {
        emitRequest(repo, BRANCH, { kind: 'track-freeze-request', generationToken: 'no-active-generation', idempotencyKey: 'freeze-a',
            payload: { trackId: 'a', fencingToken: 'fa' } });
    }

    async function tickUntil(sup: Supervisor, predicate: () => boolean, maxTicks = 400): Promise<string> {
        let outcome = 'continue';
        for (let i = 0; i < maxTicks && !predicate(); i++) {
            outcome = await sup.tick();
            if (predicate()) break;
            await new Promise((r) => setTimeout(r, 15));
        }
        return outcome;
    }

    test('freeze completo: drena jobs vivos, exige gate local + worktree limpio, termina la generación propia, persiste frozen (R5.2/R6.3)', async () => {
        setUpGreenTrack();   // sin freeze todavía: el track hace su trabajo real primero, como en el mundo real
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10, provider: 'codex' };
        const sup = new Supervisor(repo, BRANCH, cfg, fakeSpawner);

        // Drenar el trabajo real (2 jobs) ANTES de que el plan pida el
        // freeze — mismo orden que el mundo real (freeze llega cuando el
        // track ya terminó su verificación).
        await tickUntil(sup, () => {
            const s = readJournal(repo, BRANCH).state!;
            return Object.values(s.jobs).length === 2 && Object.values(s.jobs).every((j) => j.executionState === 'exited' && j.verdict === 'pass');
        });

        requestFreeze();
        const outcome = await tickUntil(sup, () => readJournal(repo, BRANCH).state!.frozen !== undefined);

        expect(outcome).toBe('frozen');
        const final = readJournal(repo, BRANCH).state!;
        expect(final.freezeRequested).toBe(true);
        expect(final.frozen).toBeDefined();
        expect(final.frozen!.headSha).toBe(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim());
        expect(final.generations.every((g) => g.state === 'terminated' || g.state === 'superseded')).toBe(true);

        // Restart-safety: un tick más, ya con `frozen` persistido, jamás
        // relanza nada — reafirma el mismo resultado terminal.
        expect(await sup.tick()).toBe('frozen');
    });

    test('deja de despachar trabajo NUEVO mientras el freeze está pendiente: un job-request llega pero no se spawnea (paso 1)', async () => {
        initWatch(repo, BRANCH);
        const s = readJournal(repo, BRANCH).state!;
        s.trackContext = { trackId: 'a', taskIds: [], planDigest: '', baseSha: 'seed', planJournalId: 'j-plan' };
        writeJournal(repo, BRANCH, s);
        requestFreeze();

        let spawnCalls = 0;
        const countingSpawner: WrapperSpawner = () => { spawnCalls++; };
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10, provider: 'codex' };
        const sup = new Supervisor(repo, BRANCH, cfg, countingSpawner);
        await sup.tick();   // consume el freeze-request => freezeRequested:true
        requestJob(repo, BRANCH, 'g0', ['node', '-e', 'process.exit(0)'], [], '.');
        await sup.tick();
        await sup.tick();
        expect(spawnCalls).toBe(0);
        const after = readJournal(repo, BRANCH).state!;
        expect(after.freezeRequested).toBe(true);
        expect(Object.values(after.jobs)[0].executionState).toBe('received');   // nunca avanzó a spawn-intent
    });

    test('worktree sucio bloquea la finalización del freeze hasta que se commitea (paso 4)', async () => {
        setUpGreenTrack();
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10, provider: 'codex' };
        const sup = new Supervisor(repo, BRANCH, cfg, fakeSpawner);
        await tickUntil(sup, () => {
            const s = readJournal(repo, BRANCH).state!;
            return Object.values(s.jobs).length === 2 && Object.values(s.jobs).every((j) => j.executionState === 'exited' && j.verdict === 'pass');
        });

        requestFreeze();
        fs.writeFileSync(path.join(repo, 'dirty.txt'), 'sin commitear');   // untracked: worktree sucio

        let sawFrozenWhileDirty = false;
        for (let i = 0; i < 20; i++) {
            const outcome = await sup.tick();
            if (outcome === 'frozen') sawFrozenWhileDirty = true;
            await new Promise((r) => setTimeout(r, 15));
        }
        expect(sawFrozenWhileDirty).toBe(false);
        expect(readJournal(repo, BRANCH).state!.frozen).toBeUndefined();

        // Se resuelve lo pendiente QUITANDO el archivo sin commitear (en vez
        // de commitearlo): commitear un archivo NUEVO cambia el árbol que
        // las evidencias ya persistidas (`v1`/`v-sensors`) fingerprintearon,
        // invalidándolas de verdad (`stale-fingerprint`) — comportamiento
        // CORRECTO del gate, pero un concern DISTINTO al que este test
        // ejercita (paso 4, limpieza — no re-vigencia de evidencia, ya
        // cubierta en `gate.test.ts`). Quitar el archivo deja el árbol
        // BYTE A BYTE igual al que las evidencias ya certificaron.
        fs.rmSync(path.join(repo, 'dirty.txt'));
        const outcome = await tickUntil(sup, () => readJournal(repo, BRANCH).state!.frozen !== undefined);
        expect(outcome).toBe('frozen');
    });
});
