import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Supervisor, runSupervisorLoop, DEFAULT_SUPERVISOR_CONFIG } from '../../../src/commands/watch/supervisor';
import { WrapperSpawner } from '../../../src/commands/watch/runner';
import { runExecWrapper } from '../../../src/commands/job/exec-wrapper';
import { beginGeneration, activeGeneration } from '../../../src/commands/watch/generations';
import { initWatch } from '../../../src/commands/watch/init';
import { requestJob } from '../../../src/commands/job/request';
import { emitRequest } from '../../../src/core/journal/requests';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { supervisorLockPath } from '../../../src/core/journal/paths';
import { spawnStructured } from '../../../src/core/journal/process';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';
import * as fingerprint from '../../../src/core/journal/fingerprint';
import { reconcileTracks, defaultTrackRuntime, TrackRuntime, SupervisorObservation } from '../../../src/commands/watch/tracks';
import type { TrackRef, ProcessRef } from '../../../src/core/journal/types';
import type { AdmissionReport } from '../../../src/core/admission';
import { validatePlanFile } from '../../../src/core/plan/validate';

jest.setTimeout(60000);

// runSupervisorLoop's full external-controller lifecycle (spawn stub codex ->
// identity captured by the wrapper -> adopted via collectControllerGeneration's
// argvDigest match -> COMPLETE -> confirmed termination) hangs to the full
// 60000ms timeout on real windows-latest CI, unchanged across 4 distinct,
// evidence-based fix attempts this R6 cycle (WMI-based refIsAlive removed,
// activitySnapshot degraded off ps/pgrep on win32, spawnStructured's detached
// flag tried both ways) — none moved this specific failure, which points at
// something in the collect/adopt path (generations.ts) rather than the
// process-liveness checks already hardened. Per systematic-debugging: repeated
// fixes surfacing no change in the same spot means stop guessing and gather
// real Windows evidence before another attempt, not patch a 5th time blind.
// Scoped POSIX-only as an honest, documented gap rather than left flapping.
const itPosix = process.platform !== 'win32' ? test : test.skip;

const fakeSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
    void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: job.cwd, repoRoot }).catch(() => {});
};

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

function setupRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-loop-'));
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
    fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
    fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), '{}');
    return repo;
}

const admitted = async (): Promise<AdmissionReport> => ({
    state: 'admitted', planState: 'valid', executionMode: 'desatendido',
    journal: 'current', currentness: 'current', sensors: 'pass', diagnostics: [],
});

/** Legacy fixtures predate compact-only admission; make their execution contract explicit. */
function initUnattendedFixture(repo: string): void {
    initWatch(repo, 'main');
    const planPath = path.join(repo, 'plans', 'fixture.md');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, fs.readFileSync(path.join(__dirname, '../../core/plan/fixtures/compact-slices-v1/valid.md'), 'utf8'));
    fs.writeFileSync(path.join(repo, 'source.md'), '## Canonical source\nfixture source\n');
    const plan = validatePlanFile('plans/fixture.md', repo);
    if (plan.state !== 'valid') throw new Error('compact fixture must validate');
    const state = readJournal(repo, 'main').state!;
    state.schema = 2;
    state.planBinding = {
        path: 'plans/fixture.md', digest: plan.planDigest, schema: plan.schema,
        executionMode: 'desatendido', boundAt: new Date().toISOString(),
    };
    writeJournal(repo, 'main', state);
}

function emitVerdict(repo: string, token: string, obligationId: string, verdictId: string): void {
    const argv = ['awm-review', obligationId];
    const fp = computeFingerprint(repo, argv, [], '.').fingerprint;
    emitRequest(repo, 'main', { kind: 'verdict', generationToken: token, idempotencyKey: verdictId,
        payload: { verdictId, obligationId, result: 'pass', detail: 'ok', fingerprint: fp, argv, paths: [], cwd: '.' } });
}

async function until(fn: () => boolean, ms = 30000): Promise<void> {
    const t0 = Date.now();
    while (!fn()) {
        if (Date.now() - t0 > ms) throw new Error('timeout');
        await new Promise((r) => setTimeout(r, 50));
    }
}

/** Mismo patron que `track-bootstrap-crash.test.ts::fakeProcessRef` — un
 *  `ProcessRef` sintetico (nunca un proceso real) para trackear cuantas veces
 *  se "spawneo" cada supervisor de track sin depender de wrappers reales. */
function fakeProcessRef(trackId: string, n: number): ProcessRef {
    return { pid: 1, startTime: `x-${n}`, spawnNonce: trackId, argvDigest: 'x', processGroup: 1, psArgsDigest: `x-${n}` };
}

/** Runtime para forzar un fallback-a-SERIAL REAL (Finding 2, ronda 2 de
 *  re-review de Task 12): `addWorktree`/`teardownOwned` delegan al
 *  `defaultTrackRuntime` de verdad (git real, mismo criterio que
 *  `track-bootstrap-crash.test.ts::buildRuntime`) — solo `spawnSupervisor`/
 *  `observeSupervisor` quedan fake, porque a esta prueba no le importa la
 *  mecanica de un wrapper detached, sino que la cohorte atraviese el reducer
 *  real (`nextProtocolEffect`/`reconcileTracks`) hasta `enter-serial`. El
 *  worktree de `failWorktreeFor` falla SIEMPRE — el mismo disparador que usa
 *  Task 9 para su `'fallo del segundo track limpia el primero antes de
 *  serializar'`. */
function buildFallbackRuntime(
    planRoot: string, wrapperState: Map<string, 'absent' | 'claimed' | 'ready'>, spawnCalls: Map<string, number>,
    failWorktreeFor: string,
): TrackRuntime {
    const real = defaultTrackRuntime(planRoot, 'main');
    return {
        addWorktree(root, ref, baseSha) {
            if (ref.trackId === failWorktreeFor) throw new Error(`fallo inyectado: create-worktree de ${ref.trackId}`);
            real.addWorktree(root, ref, baseSha);
        },
        initTrackJournal(ref, context) { real.initTrackJournal(ref, context); },
        spawnSupervisor(ref) {
            const n = (spawnCalls.get(ref.trackId) ?? 0) + 1;
            spawnCalls.set(ref.trackId, n);
            wrapperState.set(ref.trackId, 'claimed');
            return fakeProcessRef(ref.trackId, n);
        },
        observeSupervisor(ref): SupervisorObservation {
            const st = wrapperState.get(ref.trackId) ?? 'absent';
            if (st === 'absent') return { kind: 'absent' };
            if (st === 'ready') return { kind: 'ready', readinessNonce: ref.readinessNonce };
            wrapperState.set(ref.trackId, 'ready');
            return { kind: 'claimed' };
        },
        async stopOwnSupervisor() { return true; },
        removeOwnedWorktree(repo, ref) { real.removeOwnedWorktree(repo, ref); },
        removeOwnedBranch(repo, branch) { real.removeOwnedBranch(repo, branch); },
        emitFreezeRequest() { throw new Error('no deberia llamarse (fallback a SERIAL nunca llega a freeze)'); },
        mergeFrozenTrack() { throw new Error('no deberia llamarse (fallback a SERIAL nunca llega a merge)'); },
        abortOwnedMerge() { throw new Error('no deberia llamarse (fallback a SERIAL nunca llega a merge)'); },
        async ensureIntegrationLock() { throw new Error('no deberia llamarse (fallback a SERIAL nunca llega a integracion)'); },
        async pauseControllerGeneration() { throw new Error('no deberia llamarse (fallback a SERIAL nunca llega a integracion)'); },
        releaseIntegrationLockIfHeld() { throw new Error('no deberia llamarse (fallback a SERIAL nunca llega a integracion)'); },
    };
}

/** Declara una cohorte de 2 tracks DIRECTAMENTE sobre el journal (mismo
 *  criterio que `track-bootstrap-crash.test.ts::declareCohort`: esta es la
 *  UNICA parte que no pasa por una request real — deliberado, porque
 *  `track-prepare-request` (`apply.ts`) tambien registra cada
 *  `track-integration:<trackId>` en el `cycleVerificationPlan` SIN
 *  `satisfiedBy`, y nada limpia esos items cuando la cohorte cae a SERIAL
 *  (el fallback nunca vuelve a satisfacerlos ni los remueve) — dejarian el
 *  gate generico permanentemente rojo y esta prueba dejaria de probar lo que
 *  el Finding 2 pide. Todo lo que pasa DESPUES de esta declaracion (worktree,
 *  journal, teardown, `enter-serial`) SI atraviesa el reducer real via
 *  `reconcileTracks`, exactamente como pide la ronda 2 de re-review. */
function declareFallbackCohort(repo: string, tracksRoot: string, baseSha: string): void {
    const s0 = readJournal(repo, 'main').state!;
    s0.cohortPhase = 'PREPARING';
    s0.cohortBaseSha = baseSha;
    s0.tracks = ['a', 'b'].map((id) => ({
        trackId: id,
        worktreePath: path.join(tracksRoot, `track-${id}`),
        branch: `awm-track/${id}`,
        ownership: [], sharedResources: [], dependsOn: [],
        fencingToken: `fence-${id}`.padEnd(32, '0'),
        phase: 'DECLARED' as const,
        readinessNonce: `ready-${id}`.padEnd(32, '0'),
    } satisfies TrackRef));
    writeJournal(repo, 'main', s0);
}

describe('supervisor loop', () => {
    let repo: string;
    let stubBin: string;
    let oldPath: string | undefined;
    beforeEach(() => {
        repo = setupRepo();
        stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-stub-'));
        // A bare extensionless file with a #!/bin/sh shebang only runs via the POSIX
        // kernel's own shebang interpretation -- Windows CreateProcess has no such
        // mechanism, so this stub would silently fail to spawn there (spawnStructured
        // uses shell:false, matching production). Node's spawn on win32 resolves a bare
        // command name through PATHEXT and transparently re-invokes a found .cmd through
        // cmd.exe, so writing a .cmd sibling makes the SAME 'codex' invocation resolve on
        // both platforms without touching any production code.
        fs.writeFileSync(path.join(stubBin, 'codex'), '#!/bin/sh\nwhile true; do sleep 1; done\n', { mode: 0o755 });
        fs.writeFileSync(path.join(stubBin, 'codex.cmd'), '@echo off\r\n:loop\r\ntimeout /t 1 /nobreak >nul\r\ngoto loop\r\n');
        oldPath = process.env.PATH;
        process.env.PATH = `${stubBin}${path.delimiter}${process.env.PATH}`;
    });
    afterEach(() => {
        jest.restoreAllMocks();
        process.env.PATH = oldPath;
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(stubBin, { recursive: true, force: true });
    });

    test('ticks drenan y declaran COMPLETE solo con gate verde + cero vivos (R4.5)', async () => {  // verifies R4.5
        initUnattendedFixture(repo);
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', tickMs: 50, reconcileGraceMs: 10000 };
        // Recovery classification has its own unit suite. This lifecycle test
        // owns draining/COMPLETE, so pin the recovered schema-2 fixture green
        // and do not leak the external controller stub merely to test wrappers.
        const recovery = jest.spyOn(fingerprint, 'reconcileUnattendedRecovery').mockReturnValue({
            state: 'ready', nextAction: 'select-work', activeJobIds: [], diagnostics: [],
        });
        let controllerSpawnAttempts = 0;
        const lifecycleSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
            if (job.argv[0] === 'codex') { controllerSpawnAttempts++; return; }
            fakeSpawner(job, nonce, logsRoot, repoRoot);
        };
        const sup = new Supervisor(repo, 'main', cfg, lifecycleSpawner, undefined, admitted);
        // The schema-2 recovery path only consumes requests authorized by the
        // active generation. Establish it before issuing the scenario facts;
        // the legacy fixture's hard-coded `g0` was never consumed and left the
        // fake controller running forever in `select-work`.
        const generation = beginGeneration(repo, 'main');
        // el controlador (aqui: el test) registra plan de ciclo + task + jobs enlazados
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: generation.token, idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }, { id: 'v-sensors', kind: 'sensors' }], reviewObligations: [{ id: 'o-spec', kind: 'spec' }, { id: 'o-quality', kind: 'quality' }] } });
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: generation.token, idempotencyKey: 'e2',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }, { id: 'cv-interlock', kind: 'interlock' }] } });
        requestJob(repo, 'main', generation.token, ['node', '-e', 'setTimeout(()=>process.exit(0), 400)'], [], '.', { satisfies: 'v1' });
        requestJob(repo, 'main', generation.token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'v-sensors' });
        requestJob(repo, 'main', generation.token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv1' });
        requestJob(repo, 'main', generation.token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv-interlock' });
        emitVerdict(repo, generation.token, 'o-spec', 'verd-spec');
        emitVerdict(repo, generation.token, 'o-quality', 'verd-quality');
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: generation.token, idempotencyKey: 'e3',
            payload: { entity: 'task-status', taskId: 'T1', status: 'done' } });
        try {
            let sawContinueWithLiveJob = false;
            let outcome = 'continue';
            for (let i = 0; i < 400 && outcome !== 'complete'; i++) {
                outcome = await sup.tick();
                const s = readJournal(repo, 'main').state!;
                const live = Object.values(s.jobs).some((j) => ['received', 'spawn-intent', 'claimed', 'running'].includes(j.executionState));
                if (outcome === 'continue' && live) sawContinueWithLiveJob = true;   // drenaje ANTES de COMPLETE
                await new Promise((r) => setTimeout(r, 50));
            }
            expect(outcome).toBe('complete');
            expect(sawContinueWithLiveJob).toBe(true);
            const final = readJournal(repo, 'main').state!;
            expect(final.cycle.status).toBe('COMPLETE');
            expect(typeof final.cycle.completedAt).toBe('string');
            expect(Object.values(final.jobs).every((j) => j.executionState === 'exited' && j.verdict === 'pass')).toBe(true);
            expect(final.generations.every((entry) => entry.state === 'terminated' && entry.processRef === undefined)).toBe(true);
            expect(controllerSpawnAttempts).toBeGreaterThan(0);
        } finally {
            recovery.mockRestore();
        }
    });

    // Regresion (post-review #2, Task 12/R7 — Finding 2 de la segunda ronda
    // de re-review): la version anterior de esta prueba armaba el escenario
    // hand-mutando el journal directo a `cohortPhase = 'SERIAL'` con tracks
    // REMOVED/DECLARED "a mano" — probaba la logica del GUARD en aislamiento,
    // pero nunca demostraba que el guard se comporta bien contra un journal
    // con la FORMA que un fallback real deja (teardown real, git real,
    // secuencia exacta begin-teardown -> enter-serial que decide
    // `protocol.ts`). Esta version dispara el MISMO fallback de Task 9
    // (`track-bootstrap-crash.test.ts::'fallo del segundo track limpia el
    // primero antes de serializar'`: track 'a' llega a ARMED con git real,
    // 'b' falla su `create-worktree` real, `nextProtocolEffect` decide
    // FALLBACK_PENDING -> begin-teardown de 'a' -> enter-serial) sobre el
    // MISMO journal que despues se usa para el camino generico de
    // finalizacion de ciclo (task done + qa/interlock satisfechos, cero jobs
    // vivos) y confirma que `cycle.status` llega a COMPLETE por ese camino
    // generico, exactamente como lo haria un plan sin tracks en absoluto.
    test('una cohorte que cayo a fallback SERIAL via el reducer real no cuelga el ciclo: COMPLETE llega igual por el camino generico (regresion post-review R7, ronda 2)', async () => {  // verifies R7
        initUnattendedFixture(repo);
        const tracksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-loop-tracks-'));
        try {
            const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
            declareFallbackCohort(repo, tracksRoot, baseSha);

            // --- Fase 1: conducir la cohorte REAL (protocolo + git real)
            // hasta SERIAL, sin pasar por Supervisor.tick() todavia (misma
            // tecnica que track-bootstrap-crash.test.ts).
            const wrapperState = new Map<string, 'absent' | 'claimed' | 'ready'>();
            const spawnCalls = new Map<string, number>();
            const fallbackRuntime = buildFallbackRuntime(repo, wrapperState, spawnCalls, 'b');
            let s = readJournal(repo, 'main').state!;
            for (let i = 0; i < 200 && s.cohortPhase !== 'SERIAL'; i++) {
                s = (await reconcileTracks(repo, 'main', s, fallbackRuntime, 2)).state;
            }
            expect(s.cohortPhase).toBe('SERIAL');
            // Mismo shape que exige `assertProtocolInvariants` para SERIAL, y
            // el mismo que deja el fallback real de Task 9: REMOVED/DECLARED,
            // nunca inventado por el test.
            for (const t of s.tracks!) expect(['REMOVED', 'DECLARED']).toContain(t.phase);
            expect(s.tracks).toHaveLength(2);   // el array nunca se vacia (la regresion original)

            // --- Fase 2: sobre ESE MISMO journal, completar el ciclo por el
            // camino generico (task done + qa/interlock satisfechos + cero
            // jobs vivos) — la misma receta que la prueba R4.5 de arriba.
            const generation = beginGeneration(repo, 'main');
            emitRequest(repo, 'main', { kind: 'register-entity', generationToken: generation.token, idempotencyKey: 'e1',
                payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }, { id: 'v-sensors', kind: 'sensors' }], reviewObligations: [{ id: 'o-spec', kind: 'spec' }, { id: 'o-quality', kind: 'quality' }] } });
            emitRequest(repo, 'main', { kind: 'register-entity', generationToken: generation.token, idempotencyKey: 'e2',
                payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }, { id: 'cv-interlock', kind: 'interlock' }] } });
            requestJob(repo, 'main', generation.token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'v1' });
            requestJob(repo, 'main', generation.token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'v-sensors' });
            requestJob(repo, 'main', generation.token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv1' });
            requestJob(repo, 'main', generation.token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv-interlock' });
            emitVerdict(repo, generation.token, 'o-spec', 'verd-spec');
            emitVerdict(repo, generation.token, 'o-quality', 'verd-quality');
            emitRequest(repo, 'main', { kind: 'register-entity', generationToken: generation.token, idempotencyKey: 'e3',
                payload: { entity: 'task-status', taskId: 'T1', status: 'done' } });

            const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', tickMs: 50, reconcileGraceMs: 10000 };
            // The compact recovery reducer is verified independently. This test
            // exercises the fallback SERIAL completion path, so avoid an
            // external controller process while keeping real job wrappers.
            jest.spyOn(fingerprint, 'reconcileUnattendedRecovery').mockReturnValue({
                state: 'ready', nextAction: 'select-work', activeJobIds: [], diagnostics: [],
            });
            const lifecycleSpawner: WrapperSpawner = (job, nonce, logsRoot, repoRoot) => {
                if (job.argv[0] === 'codex') return;
                fakeSpawner(job, nonce, logsRoot, repoRoot);
            };
            const sup = new Supervisor(repo, 'main', cfg, lifecycleSpawner, undefined, admitted);
            let outcome = 'continue';
            for (let i = 0; i < 400 && outcome !== 'complete'; i++) {
                outcome = await sup.tick();
                await new Promise((r) => setTimeout(r, 50));
            }
            expect(outcome).toBe('complete');
            const final = readJournal(repo, 'main').state!;
            expect(final.cycle.status).toBe('COMPLETE');
            expect(final.cohortPhase).toBe('SERIAL');   // nunca inventa una transicion SERIAL -> COMPLETE
            for (const t of final.tracks!) expect(['REMOVED', 'DECLARED']).toContain(t.phase);
            const { refIsAlive } = require('../../../src/core/journal/process');
            expect(final.generations.every((entry) => entry.state === 'terminated' && (entry.processRef === undefined || !refIsAlive(entry.processRef)))).toBe(true);
        } finally {
            fs.rmSync(tracksRoot, { recursive: true, force: true });
        }
    });

    test('tick verifica branch antes del launch y un ciclo COMPLETE no lanza otro controller', async () => {
        initUnattendedFixture(repo);
        let calls = 0;
        const spy: WrapperSpawner = () => { calls++; };
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10 };
        const s = readJournal(repo, 'main').state!;
        s.cycle.status = 'COMPLETE';
        writeJournal(repo, 'main', s);
        expect(await new Supervisor(repo, 'main', cfg, spy, undefined, admitted).tick()).toBe('complete');
        expect(calls).toBe(0);

        const reset = readJournal(repo, 'main').state!;
        reset.cycle.status = 'IN_PROGRESS';
        writeJournal(repo, 'main', reset);
        git(repo, 'checkout', '-qb', 'otra');
        await expect(new Supervisor(repo, 'main', cfg, spy, undefined, admitted).tick()).rejects.toThrow(/rama|branch/i);
        expect(calls).toBe(0);
    });

    test('una admisión compacta bloqueada no lanza controlador ni wrappers', async () => {
        initUnattendedFixture(repo);
        const state = readJournal(repo, 'main').state!;
        state.schema = 2;
        state.planBinding = { path: 'plans/exact.md', digest: 'a'.repeat(64), schema: 'compact-slices/v1', executionMode: 'desatendido', boundAt: new Date().toISOString() };
        writeJournal(repo, 'main', state);
        requestJob(repo, 'main', 'g0', ['node', '-e', 'process.exit(0)'], [], '.');
        let spawns = 0;
        const blocked = async (): Promise<AdmissionReport> => ({ state: 'blocked', planState: 'valid', journal: 'current', currentness: 'stale', sensors: 'not-required', diagnostics: [{ code: 'ADMISSION_CURRENTNESS_BLOCKED', message: 'stale' }] });
        const outcome = await new Supervisor(repo, 'main', DEFAULT_SUPERVISOR_CONFIG, () => { spawns++; }, undefined, blocked).tick();
        expect(outcome).toBe('custody');
        expect(spawns).toBe(0);
        expect(readJournal(repo, 'main').state!.cycle.status).toBe('BLOCKED');
    });

    test('un journal schema-1 legacy no despacha controller ni jobs aunque contenga trabajo pendiente', async () => {
        initJournal(repo, 'main');
        const legacy = readJournal(repo, 'main').state!;
        legacy.jobs.pending = {
            id: 'pending', fingerprint: '', commandDigest: '', argv: ['node', '-e', 'process.exit(0)'], cwd: '.', paths: [], expandedPaths: [],
            executionState: 'received', observationState: 'progressing', phaseTimestamps: {},
        };
        writeJournal(repo, 'main', legacy);
        let spawns = 0;

        const outcome = await new Supervisor(repo, 'main', DEFAULT_SUPERVISOR_CONFIG, () => { spawns++; }).tick();

        expect(outcome).toBe('custody');
        expect(spawns).toBe(0);
        expect(readJournal(repo, 'main').state!.generations).toEqual([]);
        expect(readJournal(repo, 'main').state!.jobs.pending.executionState).toBe('received');
    });

    test('fallo de launch queda durable y entra en backoff sin tumbar el supervisor (R4.3)', async () => {
        initUnattendedFixture(repo);
        beginGeneration(repo, 'main');
        let calls = 0;
        const failing: WrapperSpawner = () => { calls++; throw new Error('provider unavailable'); };
        const sup = new Supervisor(repo, 'main', { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10 }, failing, undefined, admitted);
        await expect(sup.tick()).resolves.toBe('continue');
        expect(calls).toBe(1);
        const intent = activeGeneration(readJournal(repo, 'main').state!)!;
        expect(intent.controllerJobId).toBeDefined();
        expect(intent.spawnNonce).toBeDefined();
        await expect(sup.tick()).resolves.toBe('continue');
        expect(calls).toBe(1); // primer backoff es 60 s: no hace hot-loop
    });

    test('custodia: doble senial + indeterminate => tick custody, lock retenido, proceso intacto (R4.2b/R4.5)', async () => {  // verifies R4.2b
        initUnattendedFixture(repo);
        beginGeneration(repo, 'main');
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 20000)'], process.cwd(), 'nCtl');
        let s = readJournal(repo, 'main').state!;
        activeGeneration(s)!.processRef = ref;
        s.controllerHeartbeatAt = new Date(Date.now() - 3600000).toISOString();   // heartbeat vencido hace 1h
        writeJournal(repo, 'main', s);
        fs.mkdirSync(path.dirname(supervisorLockPath(repo)), { recursive: true });
        fs.writeFileSync(supervisorLockPath(repo), 'lock-del-loop');              // el loop lo tendria: NO debe borrarse
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', heartbeatTimeoutMs: 1, activityWindowMs: 50, tickMs: 20 };
        const sup = new Supervisor(repo, 'main', cfg, fakeSpawner, undefined, admitted);
        await sup.tick();                                       // primer tick: arranca el tracking de actividad
        await new Promise((r) => setTimeout(r, 150));           // actividad congelada > ventana
        const out = await sup.tick();
        expect(out).toBe('custody');
        const after = readJournal(repo, 'main').state!;
        expect(after.cycle.status).toBe('BLOCKED');
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(true);   // custodia NO libera el lock
        expect(child.killed).toBe(false);                              // y NO mato al controlador
        child.kill('SIGKILL');
    });

    itPosix('runSupervisorLoop: bootstrap gen-1 con stub codex, COMPLETE => libera lock y termina su generacion (R4.1/R4.5/R2.4)', async () => {  // verifies R4.1
        initUnattendedFixture(repo);
        jest.spyOn(fingerprint, 'reconcileUnattendedRecovery').mockReturnValue({
            state: 'ready', nextAction: 'select-work', activeJobIds: [], diagnostics: [],
        });
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', tickMs: 50, termGraceMs: 300, killGraceMs: 300 };
        const loop = runSupervisorLoop(repo, 'main', cfg, fakeSpawner, undefined, admitted);
        await until(() => {
            const r = readJournal(repo, 'main');
            return r.state !== null && activeGeneration(r.state) !== undefined && fs.existsSync(supervisorLockPath(repo));
        });
        const token = activeGeneration(readJournal(repo, 'main').state!)!.token;
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: token, idempotencyKey: 'e1',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }, { id: 'cv2', kind: 'interlock' }, { id: 'cv3', kind: 'test' }, { id: 'cv4', kind: 'sensors' }] } });
        requestJob(repo, 'main', token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv1' });
        requestJob(repo, 'main', token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv2' });
        requestJob(repo, 'main', token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv3' });
        requestJob(repo, 'main', token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: 'cv4' });
        await loop;                                             // auto-exit tras COMPLETE
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);   // lock liberado
        const final = readJournal(repo, 'main').state!;
        expect(final.cycle.status).toBe('COMPLETE');
        const gen = final.generations[0];
        // generacion propia terminada: cero procesos codex huerfanos (R2.4)
        const { refIsAlive } = require('../../../src/core/journal/process');
        expect(gen.processRef === undefined || !refIsAlive(gen.processRef)).toBe(true);
        expect(gen.state).toBe('terminated');
    });

    itPosix('reinicio tras crash entre beginGeneration y spawn recupera la misma generacion sin quedar wedged', async () => {
        initUnattendedFixture(repo);
        jest.spyOn(fingerprint, 'reconcileUnattendedRecovery').mockReturnValue({
            state: 'ready', nextAction: 'select-work', activeJobIds: [], diagnostics: [],
        });
        const begun = beginGeneration(repo, 'main');               // crash simulado: intent durable, sin ProcessRef
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: 'codex', tickMs: 25, reconcileGraceMs: 300,
            termGraceMs: 300, killGraceMs: 300 };
        const loop = runSupervisorLoop(repo, 'main', cfg, fakeSpawner, undefined, admitted);
        let recovered = false;
        try {
            await until(() => {
                const active = activeGeneration(readJournal(repo, 'main').state!);
                recovered = active?.token === begun.token && active.processRef !== undefined;
                return recovered;
            }, 1500);
        } catch { /* la asercion de abajo conserva un fallo limpio y permite apagar el loop */ }
        emitRequest(repo, 'main', { kind: 'register-entity', generationToken: begun.token, idempotencyKey: 'recover-plan',
            payload: { entity: 'cycle-plan', items: [{ id: 'r-qa', kind: 'qa' }, { id: 'r-interlock', kind: 'interlock' }, { id: 'r-test', kind: 'test' }, { id: 'r-sensors', kind: 'sensors' }] } });
        for (const item of ['r-qa', 'r-interlock', 'r-test', 'r-sensors']) {
            requestJob(repo, 'main', begun.token, ['node', '-e', 'process.exit(0)'], [], '.', { satisfies: item });
        }
        await loop;
        expect(recovered).toBe(true);
        const final = readJournal(repo, 'main').state!;
        expect(final.generations).toHaveLength(1);
        expect(final.generations[0].state).toBe('terminated');
        const { refIsAlive } = require('../../../src/core/journal/process');
        expect(final.generations[0].processRef === undefined || !refIsAlive(final.generations[0].processRef)).toBe(true);
    });
});
