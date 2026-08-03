// Task 8 (R5-T8): P1 bootstrap durable + barrera ARMED. Estos tests conducen
// `reconcileTracks` tick a tick contra un `TrackRuntime` FAKE — ningún git ni
// proceso real corre acá (eso es Task 9's `realGitHarness`). El único I/O
// real es el propio journal del plan (tmpdir) y los directorios que
// representan cada worktree (para poder probar la detección de "ajeno" con
// `fs` real, tal como lo hace `foreignPathExists` en producción).
import fs from 'fs';
import path from 'path';
import os from 'os';
import { reconcileTracks, TrackRuntime, SupervisorObservation, ReconcileTracksResult } from '../../../src/commands/watch/tracks';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { eventsPath } from '../../../src/core/journal/paths';
import type { JournalState, TrackRef, ProcessRef } from '../../../src/core/journal/types';

const BRANCH = 'main';

/** `reconcileTracks` decide spawn-vs-observar mirando `ref.supervisorProcessRef`
 *  (post-review fix) — un fake que devolviera `undefined` desde `spawnSupervisor`
 *  jamás dejaría ese campo seteado y el driver reintentaría el spawn para
 *  siempre. Un `ProcessRef` real de mentira alcanza; nada de esto se usa para
 *  identidad real en estos tests (esa es responsabilidad de `defaultTrackRuntime`). */
function fakeProcessRef(trackId: string): ProcessRef {
    return { pid: 1, startTime: 'x', spawnNonce: trackId, argvDigest: 'x', processGroup: 1, psArgsDigest: 'x' };
}

function harness(trackIds: string[], opts: { maxParallelTracks?: number } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-bootstrap-'));
    const planRoot = path.join(root, 'plan');
    fs.mkdirSync(planRoot, { recursive: true });
    initJournal(planRoot, BRANCH);

    const s0 = readJournal(planRoot, BRANCH).state!;
    s0.cohortPhase = 'PREPARING';
    s0.cohortBaseSha = 'base-sha';
    s0.tracks = trackIds.map((id) => ({
        trackId: id,
        worktreePath: path.join(root, `track-${id}`),
        branch: `awm-track/${id}`,
        ownership: [], sharedResources: [], dependsOn: [],
        fencingToken: `fence-${id}`.padEnd(32, '0'),
        phase: 'DECLARED',
        readinessNonce: `ready-${id}`.padEnd(32, '0'),
    } satisfies TrackRef));
    writeJournal(planRoot, BRANCH, s0);

    const dispatches: string[] = [];
    const spawned = new Set<string>();
    const readinessOverrides = new Map<string, string>();

    const runtime: TrackRuntime = {
        addWorktree(_planRootArg, ref) {
            fs.mkdirSync(ref.worktreePath, { recursive: true });
            fs.writeFileSync(path.join(ref.worktreePath, '.git'), 'gitdir: fake\n');
        },
        initTrackJournal(ref) {
            fs.mkdirSync(path.join(ref.worktreePath, '.awm'), { recursive: true });
        },
        spawnSupervisor(ref) {
            spawned.add(ref.trackId);
            return fakeProcessRef(ref.trackId);
        },
        observeSupervisor(ref): SupervisorObservation {
            if (!spawned.has(ref.trackId)) return { kind: 'absent' };
            const override = readinessOverrides.get(ref.trackId);
            return { kind: 'ready', readinessNonce: override ?? ref.readinessNonce };
        },
        async teardownOwned() { return 'ok'; },
        emitFreezeRequest() { throw new Error('no debería llamarse (Task 10, sin cobertura en esta suite)'); },
    };

    const maxParallelTracks = opts.maxParallelTracks ?? 2;

    function state(): JournalState { return readJournal(planRoot, BRANCH).state!; }
    function track(id: string): TrackRef { return state().tracks!.find((t) => t.trackId === id)!; }

    // `reconcileTracks` ya escribe cada frontera a `events.jsonl` vía
    // `appendEvent` (mismo canal de auditoría que el resto del supervisor) —
    // leemos DE AHÍ en vez de inferir eventos por diffing de estado, para no
    // acoplar el test a cuántas veces `reconcileTracks` loopeó internamente.
    function readRawEvents(): Array<Record<string, unknown>> {
        let raw = '';
        try { raw = fs.readFileSync(eventsPath(planRoot, BRANCH), 'utf8'); } catch { return []; }
        return raw.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    }

    function formatEvent(e: Record<string, unknown>): string | null {
        if (e.kind === 'track-protocol-persist') {
            return e.trackId !== undefined ? `persist:${String(e.phase)}:${String(e.trackId)}` : `persist:cohort:${String(e.phase)}`;
        }
        if (e.kind === 'track-supervisor-intent') return `persist:SUPERVISOR_STARTING:${String(e.trackId)}`;
        if (e.kind === 'track-effect') return `effect:${String(e.effect)}:${String(e.trackId)}`;
        if (e.kind === 'track-effect-failed') return `effect-failed:${String(e.effect)}:${String(e.trackId)}`;
        if (e.kind === 'track-blocked') return `blocked:${String(e.trackId)}`;
        if (e.kind === 'track-armed-or-blocked') return `observed:${String(e.trackId)}`;
        return null;
    }

    return {
        config: { maxParallelTracks },
        events: (): string[] => readRawEvents().map(formatEvent).filter((x): x is string => x !== null),
        dispatches: () => [...dispatches],
        state,
        track,
        async tick(): Promise<ReconcileTracksResult> {
            return reconcileTracks(planRoot, BRANCH, state(), runtime, maxParallelTracks);
        },
        async runUntil(predicate: (s: JournalState) => boolean, maxTicks = 100): Promise<void> {
            for (let i = 0; i < maxTicks; i++) {
                if (predicate(state())) return;
                await this.tick();
            }
            throw new Error('runUntil: la condición nunca se cumplió');
        },
        observeReadiness(trackId: string, nonce: string): void {
            const s = state();
            const ref = s.tracks!.find((t) => t.trackId === trackId)!;
            ref.phase = 'SUPERVISOR_STARTING';
            ref.supervisorIntent = {
                nonce: 'fake-intent-nonce', argv: [],
                claimPath: path.join(ref.worktreePath, '.awm', 'supervisor.claim'),
            };
            // Fast-forward a "ya spawneamos, ahora solo observamos" — sin esto
            // el driver (post-review fix) vería `supervisorProcessRef`
            // ausente y volvería a intentar spawnear en vez de consultar
            // `observeSupervisor` directamente, que es lo que este test
            // necesita ejercitar.
            ref.supervisorProcessRef = fakeProcessRef(trackId);
            writeJournal(planRoot, BRANCH, s);
            spawned.add(trackId);
            readinessOverrides.set(trackId, nonce);
        },
        placeForeignJournal(trackId: string): void {
            const ref = track(trackId);
            fs.mkdirSync(ref.worktreePath, { recursive: true });
            fs.writeFileSync(path.join(ref.worktreePath, 'foreign.marker'), 'ajeno\n');
        },
        foreignJournalExists(trackId: string): boolean {
            const ref = track(trackId);
            return fs.existsSync(path.join(ref.worktreePath, 'foreign.marker'));
        },
        cleanup(): void { fs.rmSync(root, { recursive: true, force: true }); },
    };
}

type Harness = ReturnType<typeof harness>;

describe('reconcileTracks — P1 bootstrap durable + barrera ARMED (R4.1-R4.10, C1, C2, C8, C11)', () => {
    let h: Harness | null = null;
    afterEach(() => { h?.cleanup(); h = null; });

    test('P1 persiste cada fase antes del side effect y activa solo con todos ARMED (R4.1, R4.4, C1)', async () => {
        h = harness(['a', 'b']);
        await h.tick();
        expect(h.events()).toEqual([
            'persist:PREPARE_INTENT:a', 'effect:create-worktree:a',
        ]);
        await h.runUntil((s) => s.tracks?.every((t) => t.phase === 'ARMED') ?? false);
        expect(h.state().cohortPhase).toBe('PREPARING');   // C1: ARMED por sí solo NUNCA activa la cohorte
        expect(h.dispatches()).toEqual([]);
        await h.tick();
        expect(h.state().cohortPhase).toBe('ACTIVE');
        expect(h.state().tracks?.filter((t) => t.phase === 'ACTIVE')).toHaveLength(h.config.maxParallelTracks);
    });

    test('readiness con nonce diferente bloquea sin despachar (R4.9, C8)', async () => {
        h = harness(['a', 'b']);
        h.observeReadiness('a', 'wrong');
        await h.tick();
        expect(h.track('a')).toMatchObject({ phase: 'BLOCKED', blockedReason: expect.stringContaining('readinessNonce') });
        expect(h.dispatches()).toEqual([]);
    });

    test('worktree/lock ajeno nunca se borra (R4.3, R4.6)', async () => {
        h = harness(['a', 'b']);
        h.placeForeignJournal('a');
        await h.tick();
        expect(h.foreignJournalExists('a')).toBe(true);
        expect(h.track('a').phase).toBe('BLOCKED');
    });

    test('Repro 1 (post-review fix, revisado en Task 9): persistir supervisorIntent es su propia frontera; observar y spawnear pueden compartir call (una lectura + a lo sumo una escritura), pero nunca hay dos escrituras en un mismo call', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-repro1-'));
        try {
            initJournal(dir, BRANCH);
            const s = readJournal(dir, BRANCH).state!;
            s.cohortPhase = 'PREPARING';
            s.cohortBaseSha = 'base-sha';
            s.tracks = [
                {
                    trackId: 'a', worktreePath: path.join(dir, 'wt-a'), branch: 'awm-track/a',
                    ownership: [], sharedResources: [], dependsOn: [],
                    fencingToken: 'fa'.padEnd(32, '0'), phase: 'JOURNAL_CREATED', readinessNonce: 'ra'.padEnd(32, '0'),
                },
                {
                    trackId: 'b', worktreePath: path.join(dir, 'wt-b'), branch: 'awm-track/b',
                    ownership: [], sharedResources: [], dependsOn: [],
                    fencingToken: 'fb'.padEnd(32, '0'), phase: 'ARMED', readinessNonce: 'rb'.padEnd(32, '0'),
                },
            ] satisfies TrackRef[];
            writeJournal(dir, BRANCH, s);

            let observeCalls = 0;
            let spawnCalls = 0;
            const runtime: TrackRuntime = {
                addWorktree: () => { throw new Error('no debería llamarse'); },
                initTrackJournal: () => { throw new Error('no debería llamarse'); },
                spawnSupervisor: (ref) => { spawnCalls++; return fakeProcessRef(ref.trackId); },
                // Simula el mundo real: 'absent' hasta que el (único) spawn
                // ocurra, 'claimed' después — igual progresión que el wrapper
                // real (claim se escribe recién tras el spawn).
                observeSupervisor: () => { observeCalls++; return spawnCalls > 0 ? { kind: 'claimed' } : { kind: 'absent' }; },
                async teardownOwned() { return 'ok'; },
                emitFreezeRequest() { throw new Error('no debería llamarse (Task 10, sin cobertura en esta suite)'); },
            };

            // Call 1: solo persiste el supervisorIntent — CERO llamadas a runtime.
            const afterIntent = await reconcileTracks(dir, BRANCH, readJournal(dir, BRANCH).state!, runtime, 2);
            expect(observeCalls).toBe(0);
            expect(spawnCalls).toBe(0);
            const trackA1 = afterIntent.state.tracks!.find((t) => t.trackId === 'a')!;
            expect(trackA1.phase).toBe('SUPERVISOR_STARTING');
            expect(trackA1.supervisorIntent).toBeDefined();
            expect(trackA1.supervisorProcessRef).toBeUndefined();

            // Call 2: supervisorIntent ya existe, supervisorProcessRef todavía
            // no — Task 9 SIEMPRE observa antes de decidir (read-only, no
            // cuenta como el side effect del tick, mismo criterio que
            // `foreignPathExists` en `runCreateWorktree`): la observación
            // confirma 'absent' y RECIÉN AHÍ se spawnea, exactamente una vez,
            // dentro del MISMO call — una lectura + a lo sumo UNA escritura,
            // nunca dos escrituras (eso seguiría siendo el bug original).
            const afterSpawn = await reconcileTracks(dir, BRANCH, afterIntent.state, runtime, 2);
            expect(observeCalls).toBe(1);
            expect(spawnCalls).toBe(1);
            const trackA2 = afterSpawn.state.tracks!.find((t) => t.trackId === 'a')!;
            expect(trackA2.supervisorProcessRef).toBeDefined();

            // Call 3: supervisorProcessRef ya persistido — se vuelve a
            // observar (ahora 'claimed') y NUNCA se vuelve a spawnear.
            await reconcileTracks(dir, BRANCH, afterSpawn.state, runtime, 2);
            expect(observeCalls).toBe(2);
            expect(spawnCalls).toBe(1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('Repro 2 (post-review fix): bloquear un track ajeno nunca se combina, en el mismo call, con el create-worktree de otro track', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-repro2-'));
        try {
            initJournal(dir, BRANCH);
            const s = readJournal(dir, BRANCH).state!;
            s.cohortPhase = 'PREPARING';
            s.cohortBaseSha = 'base-sha';
            const worktreeA = path.join(dir, 'wt-a');
            const worktreeB = path.join(dir, 'wt-b');
            fs.mkdirSync(worktreeA, { recursive: true });
            fs.writeFileSync(path.join(worktreeA, 'foreign.marker'), 'ajeno\n');
            s.tracks = [
                {
                    trackId: 'a', worktreePath: worktreeA, branch: 'awm-track/a',
                    ownership: [], sharedResources: [], dependsOn: [],
                    fencingToken: 'fa'.padEnd(32, '0'), phase: 'PREPARE_INTENT', readinessNonce: 'ra'.padEnd(32, '0'),
                },
                {
                    trackId: 'b', worktreePath: worktreeB, branch: 'awm-track/b',
                    ownership: [], sharedResources: [], dependsOn: [],
                    fencingToken: 'fb'.padEnd(32, '0'), phase: 'DECLARED', readinessNonce: 'rb'.padEnd(32, '0'),
                },
            ] satisfies TrackRef[];
            writeJournal(dir, BRANCH, s);

            let addWorktreeCalls = 0;
            const runtime: TrackRuntime = {
                addWorktree: () => { addWorktreeCalls++; },
                initTrackJournal: () => { throw new Error('no debería llamarse'); },
                spawnSupervisor: () => { throw new Error('no debería llamarse'); },
                observeSupervisor: () => ({ kind: 'absent' }),
                async teardownOwned() { return 'ok'; },
                emitFreezeRequest() { throw new Error('no debería llamarse (Task 10, sin cobertura en esta suite)'); },
            };

            const result = await reconcileTracks(dir, BRANCH, readJournal(dir, BRANCH).state!, runtime, 2);
            // 'a' se bloquea por ajeno; 'b' NO se toca en absoluto en este call
            // (ni siquiera su persist-prepare-intent, puramente en memoria).
            expect(addWorktreeCalls).toBe(0);
            const a = result.state.tracks!.find((t) => t.trackId === 'a')!;
            const b = result.state.tracks!.find((t) => t.trackId === 'b')!;
            expect(a.phase).toBe('BLOCKED');
            expect(b.phase).toBe('DECLARED');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('reconcileTracks es no-op mientras la cohorte no está declarada (< 2 tracks o sin cohortPhase)', async () => {
        h = harness(['a', 'b']);
        // Journal recién creado sin tracks/cohortPhase: reconcileTracks jamás
        // debe invocar `nextProtocolEffect` (que exigiría >= 2 tracks) sobre
        // un estado que todavía no declaró la cohorte completa.
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-bare-'));
        try {
            initJournal(bare, BRANCH);
            const bareState = readJournal(bare, BRANCH).state!;
            const fakeRuntime: TrackRuntime = {
                addWorktree: () => { throw new Error('no debería llamarse'); },
                initTrackJournal: () => { throw new Error('no debería llamarse'); },
                spawnSupervisor: () => { throw new Error('no debería llamarse'); },
                observeSupervisor: () => ({ kind: 'absent' }),
                async teardownOwned() { throw new Error('no debería llamarse'); },
                emitFreezeRequest() { throw new Error('no debería llamarse (Task 10, sin cobertura en esta suite)'); },
            };
            const result = await reconcileTracks(bare, BRANCH, bareState, fakeRuntime, 1);
            expect(result.effectExecuted).toBeNull();
            expect(result.state).toEqual(bareState);
        } finally {
            fs.rmSync(bare, { recursive: true, force: true });
        }
    });

    test('activate-track respeta maxParallelTracks: un tercer track ARMED espera su turno (R10.2/R10.3)', async () => {
        h = harness(['a', 'b', 'c'], { maxParallelTracks: 2 });
        await h.runUntil((s) => s.tracks?.every((t) => t.phase === 'ARMED') ?? false, 200);
        await h.tick();
        const tracks = h.state().tracks!;
        expect(tracks.filter((t) => t.phase === 'ACTIVE')).toHaveLength(2);
        expect(tracks.filter((t) => t.phase === 'ARMED')).toHaveLength(1);
        expect(h.state().cohortPhase).toBe('ACTIVE');
    });
});
