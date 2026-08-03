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
import { eventsPath } from '../../../src/core/journal/paths';
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

    // Mismo canal de auditoria que el resto del supervisor (`appendEvent`) —
    // leemos DE AHI en vez de inferir eventos por diffing de estado (mismo
    // patron que `track-bootstrap.test.ts`).
    function readRawEvents(): Array<Record<string, unknown>> {
        let raw = '';
        try { raw = fs.readFileSync(eventsPath(planRoot, PLAN_BRANCH), 'utf8'); } catch { return []; }
        return raw.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    }

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

        // Consumidor `track-ownership-violation` (Step 6/R5.8/R5.9):
        // `assessActualOwnership` reporta `outside.txt` como fuera de
        // ownership declarada (`src/`), y ese hallazgo SI debe emitirse
        // nombrando el path exacto — sin esto, una regresion en el wiring
        // `mergeBase`/`changedPaths`/`assessActualOwnership` pasaria
        // desapercibida (nadie mas lee este campo del evento).
        const violation = readRawEvents().find((e) => e.kind === 'track-ownership-violation');
        expect(violation).toEqual({ at: expect.any(String), kind: 'track-ownership-violation', trackId: 'a', paths: ['outside.txt'] });
        // Efecto observable en el ordenamiento de join: una violacion de
        // ownership NO bloquea ni reordena nada por si sola — el track
        // sigue avanzando a FROZEN/JOINING exactamente igual que sin
        // violacion (Step 6 solo la deja NOMBRADA en el log de eventos para
        // revision humana, jamas revierte un freeze ya consumado).
        expect(a.blockedReason).toBeUndefined();
        expect(result.state.cohortPhase).toBe('JOINING');
        // Ninguna clase global fue tocada: el consumidor `parallel-invalidated`
        // (probado en el test siguiente) permanece silencioso acá.
        expect(readRawEvents().some((e) => e.kind === 'parallel-invalidated')).toBe(false);
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

        // Consumidor `parallel-invalidated` (Step 6/R5.7/C5): el evento
        // nombra la(s) clase(s) global(es) realmente tocadas, y
        // `cohortParallelInvalidatedBy` — la marca DURABLE que futuros
        // `awm watch` deben leer para no volver a paralelizar esta cohorte
        // — usa el formato `<trackId>:<clase>:<path>` que produce
        // `assessActualOwnership`, no un formato inventado por el test.
        const invalidated = readRawEvents().find((e) => e.kind === 'parallel-invalidated');
        expect(invalidated).toEqual({ at: expect.any(String), kind: 'parallel-invalidated', trackId: 'a', classes: ['lockfile:package-lock.json'] });
        // `package-lock.json` tambien esta fuera de la ownership declarada
        // (`src/`) — ambos consumidores del mismo commit se ejercitan acá.
        const violation = readRawEvents().find((e) => e.kind === 'track-ownership-violation');
        expect(violation).toEqual({ at: expect.any(String), kind: 'track-ownership-violation', trackId: 'a', paths: ['package-lock.json'] });
        // La invalidacion de paralelismo tampoco bloquea/reordena el join
        // de ESTE track — persiste como marca para cohortes FUTURAS.
        expect(a.blockedReason).toBeUndefined();
        expect(result.state.cohortPhase).toBe('JOINING');
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

    test('job varado en spawn-intent con refs muertas justo al pedirse el freeze SI se reintenta y drena — el freeze converge en vez de quedar en `continue` para siempre (regresión R6.3: `dispatch:false` no debe suprimir retry-same-intent)', async () => {
        setUpGreenTrack();
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10, provider: 'codex' };
        const sup = new Supervisor(repo, BRANCH, cfg, fakeSpawner);
        await tickUntil(sup, () => {
            const s = readJournal(repo, BRANCH).state!;
            return Object.values(s.jobs).length === 2 && Object.values(s.jobs).every((j) => j.executionState === 'exited' && j.verdict === 'pass');
        });

        // Simular un wrapper que crasheo EXACTAMENTE cuando se pidio el
        // freeze: el job queda en `spawn-intent` con refs de PID que no
        // existen y SIN ningun sidecar (`claim`/`identity`/`result`) en
        // disco — `reconcileJobs` lo clasifica `never-started` =>
        // `retry-same-intent`. Este job NO participa de ningun
        // `verificationPlan` (el gate ya certifica con los 2 jobs de
        // `setUpGreenTrack`) — lo unico que debe bloquear la convergencia
        // del freeze es que siga contando como LIVE en `attemptFreeze`.
        const dead = { pid: 999999, startTime: 'gone', spawnNonce: 'stuck-nonce', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        const s1 = readJournal(repo, BRANCH).state!;
        s1.jobs['stuck-job'] = {
            id: 'stuck-job', fingerprint: 'fp', commandDigest: 'cd', argv: ['node', '-e', 'process.exit(0)'], cwd: '.',
            paths: [], expandedPaths: [], executionState: 'spawn-intent', observationState: 'progressing',
            spawnNonce: 'stuck-nonce', processRef: dead, wrapperRef: dead,
            phaseTimestamps: { received: new Date(Date.now() - 120000).toISOString(), 'spawn-intent': new Date(Date.now() - 120000).toISOString() },
        };
        writeJournal(repo, BRANCH, s1);

        requestFreeze();

        // Con el bug original, `dispatch:false` tambien suprimia el retry
        // de `stuck-job`: jamas saldria de `spawn-intent`, `liveJobs` jamas
        // llegaria a 0 en `attemptFreeze` y el freeze quedaria varado en
        // `'continue'` para siempre (deadlock). Con el fix, el retry corre
        // igual (drenaje de trabajo YA en vuelo, no arranque de trabajo
        // nuevo) y el job converge a un estado terminal.
        const outcome = await tickUntil(sup, () => readJournal(repo, BRANCH).state!.frozen !== undefined);

        expect(outcome).toBe('frozen');
        const final = readJournal(repo, BRANCH).state!;
        expect(final.jobs['stuck-job'].executionState).toBe('exited');
        expect(final.jobs['stuck-job'].verdict).toBe('pass');
        expect(final.frozen).toBeDefined();
        expect(final.frozen!.headSha).toBe(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim());
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

// --- Parte 3: loop end-to-end de DOS Supervisors reales ---------------------
//
// Las Partes 1 y 2 prueban, cada una con git real, solo UNA mitad del loop
// completo: Parte 1 fuerza `frozen` directamente en el journal del track
// (nunca deja que un `Supervisor` de track real lo produzca) y Parte 2
// inyecta la request via `emitRequest` crudo (nunca deja que un driver real
// del lado del PLAN, `reconcileTracks`, la emita). Este describe cierra esa
// brecha: DOS worktrees reales (uno para el plan, uno para el track, mismo
// object store via `git worktree add`), un `Supervisor` de track REAL cuyo
// `.tick()` se llama en loop hasta drenar/gatear/limpiar/terminar/persistir
// `frozen` por si mismo, y `reconcileTracks` (el mismo driver que
// `Supervisor.tick()` del PLAN llama en producción) llamado en loop del lado
// del plan hasta que observa y acepta ese `frozen` — probando que las dos
// mitades, cada una ya cubierta por separado arriba, cierran el loop de
// verdad cuando corren juntas.
describe('loop end-to-end: plan (reconcileTracks) + track (Supervisor.tick) cierran el freeze juntos', () => {
    jest.setTimeout(60000);

    const PLAN_BRANCH = 'main';
    const TRACK_BRANCH = 'awm-track/a';

    const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
        void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: job.cwd, repoRoot }).catch(() => {});
    };

    let planRoot: string;
    let trackWorktree: string;
    let baseSha: string;
    let stubBin: string;
    let oldPath: string | undefined;

    beforeEach(() => {
        planRoot = initRepo();
        commitFile(planRoot, '.gitignore', '.awm/\n');   // `.awm` ya ignorado ANTES de crear el worktree del track
        baseSha = commitFile(planRoot, 'seed.txt', 'seed');

        trackWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-e2e-freeze-wt-'));
        fs.rmdirSync(trackWorktree);
        git(planRoot, 'worktree', 'add', '-b', TRACK_BRANCH, trackWorktree, baseSha);

        // El track necesita sus propios verificadores REALES (mismo criterio
        // que `setUpGreenTrack` de la Parte 2): `package.json` con script
        // `test` (rastreado — coincide con la clase global `manifest`, a
        // proposito: no es el foco de ESTE test, solo confirma que ese
        // consumidor no interfiere con el loop) y `.awm/sensors.json`
        // (ignorado por el `.gitignore` heredado de `baseSha`, no necesita
        // commit — `detectRequiredVerifiers` lee el filesystem, no git).
        fs.writeFileSync(path.join(trackWorktree, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
        git(trackWorktree, 'add', 'package.json'); git(trackWorktree, 'commit', '-qm', 'package.json');
        fs.mkdirSync(path.join(trackWorktree, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(trackWorktree, '.awm', 'sensors.json'), '{}');

        stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-e2e-stub-'));
        fs.writeFileSync(path.join(stubBin, 'codex'), '#!/bin/sh\nwhile true; do sleep 1; done\n', { mode: 0o755 });
        oldPath = process.env.PATH;
        process.env.PATH = `${stubBin}:${process.env.PATH}`;
    });

    afterEach(() => {
        process.env.PATH = oldPath;
        try { execFileSync('git', ['worktree', 'remove', '--force', trackWorktree], { cwd: planRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
        try { execFileSync('git', ['worktree', 'prune'], { cwd: planRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(trackWorktree, { recursive: true, force: true });
        fs.rmSync(stubBin, { recursive: true, force: true });
    });

    function emitVerdict(obligationId: string, verdictId: string): void {
        const argv = ['awm-review', obligationId];
        const fp = computeFingerprint(trackWorktree, argv, [], '.').fingerprint;
        emitRequest(trackWorktree, TRACK_BRANCH, { kind: 'verdict', generationToken: 'g0', idempotencyKey: verdictId,
            payload: { verdictId, obligationId, result: 'pass', detail: 'ok', fingerprint: fp, argv, paths: [], cwd: '.' } });
    }

    test('reconcileTracks real (plan) + Supervisor.tick real (track), en loop contra dos worktrees reales, cierran request -> drenaje -> persist -> observación -> FROZEN', async () => {
        // --- lado TRACK: registrar el trabajo y drenarlo con un Supervisor REAL ---
        initWatch(trackWorktree, TRACK_BRANCH);
        const ts0 = readJournal(trackWorktree, TRACK_BRANCH).state!;
        ts0.trackContext = { trackId: 'a', taskIds: ['T1'], planDigest: '', baseSha, planJournalId: 'j-plan' };
        writeJournal(trackWorktree, TRACK_BRANCH, ts0);
        emitRequest(trackWorktree, TRACK_BRANCH, { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }, { id: 'v-sensors', kind: 'sensors' }], reviewObligations: [{ id: 'o-spec', kind: 'spec' }, { id: 'o-quality', kind: 'quality' }] } });
        requestJob(trackWorktree, TRACK_BRANCH, 'g0', ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'v1' });
        requestJob(trackWorktree, TRACK_BRANCH, 'g0', ['node', '-e', '0; process.exit(0)'], [], '.', { satisfies: 'v-sensors' });
        emitVerdict('o-spec', 'verd-spec');
        emitVerdict('o-quality', 'verd-quality');
        emitRequest(trackWorktree, TRACK_BRANCH, { kind: 'register-entity', generationToken: 'g0', idempotencyKey: 'e3',
            payload: { entity: 'task-status', taskId: 'T1', status: 'done' } });

        const trackCfg = { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10, provider: 'codex' };
        const trackSup = new Supervisor(trackWorktree, TRACK_BRANCH, trackCfg, fakeSpawner);
        for (let i = 0; i < 400; i++) {
            const s = readJournal(trackWorktree, TRACK_BRANCH).state!;
            if (Object.values(s.jobs).length === 2 && Object.values(s.jobs).every((j) => j.executionState === 'exited' && j.verdict === 'pass')) break;
            await trackSup.tick();
            await new Promise((r) => setTimeout(r, 15));
        }
        const drained = readJournal(trackWorktree, TRACK_BRANCH).state!;
        expect(Object.values(drained.jobs)).toHaveLength(2);
        expect(Object.values(drained.jobs).every((j) => j.executionState === 'exited' && j.verdict === 'pass')).toBe(true);

        // --- lado PLAN: journal real, cohorte ACTIVE con track 'a' en JOIN_REQUESTED ---
        initJournal(planRoot, PLAN_BRANCH);
        let planState = readJournal(planRoot, PLAN_BRANCH).state!;
        planState.cohortPhase = 'ACTIVE';
        planState.cohortBaseSha = baseSha;
        planState.tracks = [
            {
                trackId: 'a', worktreePath: trackWorktree, branch: TRACK_BRANCH,
                ownership: [], sharedResources: [], dependsOn: [],
                fencingToken: 'fence-a'.padEnd(32, '0'), phase: 'JOIN_REQUESTED', readinessNonce: 'ready-a'.padEnd(32, '0'),
            },
            {
                // Segundo track: satisface el minimo de 2 de `initialCohort`
                // y se mantiene ACTIVE — no participa de este freeze.
                trackId: 'b', worktreePath: path.join(planRoot, 'nope-b'), branch: 'awm-track/b',
                ownership: [], sharedResources: [], dependsOn: [],
                fencingToken: 'fence-b'.padEnd(32, '0'), phase: 'ACTIVE', readinessNonce: 'ready-b'.padEnd(32, '0'),
            },
        ] satisfies TrackRef[];
        writeJournal(planRoot, PLAN_BRANCH, planState);
        planState = readJournal(planRoot, PLAN_BRANCH).state!;

        // Runtime REAL (no un fake): `emitFreezeRequest` es el unico touch
        // real que este loop necesita — el mismo `defaultTrackRuntime` que
        // `Supervisor` del plan inyecta en producción.
        const runtime = defaultTrackRuntime(planRoot, PLAN_BRANCH);

        // --- el loop en si: plan emite/observa, track real drena/gatea/termina ---
        let reachedFrozen = false;
        for (let i = 0; i < 400 && !reachedFrozen; i++) {
            const result = await reconcileTracks(planRoot, PLAN_BRANCH, planState, runtime, 2);
            planState = result.state;
            await trackSup.tick();
            const a = planState.tracks!.find((t) => t.trackId === 'a')!;
            if (a.phase === 'FROZEN' && a.frozenHeadSha !== undefined) reachedFrozen = true;
            await new Promise((r) => setTimeout(r, 15));
        }

        expect(reachedFrozen).toBe(true);
        const trackHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: trackWorktree, encoding: 'utf8' }).trim();

        const finalPlan = readJournal(planRoot, PLAN_BRANCH).state!;
        const a = finalPlan.tracks!.find((t) => t.trackId === 'a')!;
        expect(a.phase).toBe('FROZEN');
        expect(a.frozenHeadSha).toBe(trackHead);
        expect(finalPlan.cohortPhase).toBe('JOINING');

        // El track propio confirma el mismo hecho, INDEPENDIENTEMENTE — dos
        // journals distintos, ambos de acuerdo (el plan jamás escribió el
        // journal del track: solo la request cross-worktree y su propia
        // observación read-only).
        const trackFinal = readJournal(trackWorktree, TRACK_BRANCH).state!;
        expect(trackFinal.frozen).toBeDefined();
        expect(trackFinal.frozen!.headSha).toBe(trackHead);
        expect(trackFinal.freezeRequested).toBe(true);
    });
});
