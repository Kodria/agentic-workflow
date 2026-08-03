// Task 9 (R4.2, R4.3, R4.5, R4.6, R4.8, R4.9, R4.10, C1, C2, C11): crash/
// restart de P1 (bootstrap de tracks) y fallback serial tras bootstrap
// parcial. A diferencia de `track-bootstrap.test.ts` (Task 8, `TrackRuntime`
// completamente fake), esta suite usa git REAL para `addWorktree`/
// `initTrackJournal`/teardown de worktree+branch (`defaultTrackRuntime`,
// mismo patrón que `track-runtime-git.test.ts`) — la única forma honesta de
// probar C11 ("sin duplicar recursos") es mirar el repo real, no solo los
// eventos. `spawnSupervisor`/`observeSupervisor` quedan fake (nada de
// procesos reales): lo que importa acá es que `tracks.ts` nunca vuelva a
// invocarlos de más tras un crash, no la mecánica real de un wrapper
// detached (eso ya lo cubre `supervisor-wrapper.test.ts`).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { reconcileTracks, defaultTrackRuntime, TrackRuntime, SupervisorObservation } from '../../../src/commands/watch/tracks';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import type { JournalState, TrackRef, ProcessRef } from '../../../src/core/journal/types';

const BRANCH = 'main';

function fakeProcessRef(trackId: string, n: number): ProcessRef {
    return { pid: 1, startTime: `x-${n}`, spawnNonce: trackId, argvDigest: 'x', processGroup: 1, psArgsDigest: `x-${n}` };
}

/** Estado simulado (persistente entre "crash" y "restart", igual que un
 *  archivo real sobreviviría a que el proceso que lo escribió muera) del
 *  wrapper de CADA track: qué tan lejos llegó su bootstrap real. */
type WrapperState = 'absent' | 'claimed' | 'identified' | 'ready';

interface RuntimeInstrumentation {
    spawnCalls: Map<string, number>;
    wrapperState: Map<string, WrapperState>;
    teardownEvents: string[];
}

/** Runtime combinado: `addWorktree`/`initTrackJournal`/teardown de worktree y
 *  branch delegan al `defaultTrackRuntime` REAL (git de verdad) — el paso
 *  `supervisor` del teardown y el spawn/observe del supervisor quedan fake,
 *  respaldados por `instr` (que el test puede mutar directamente para
 *  simular "esto ya pasó antes del crash"). */
function buildRuntime(planRoot: string, instr: RuntimeInstrumentation, opts: { failWorktreeFor?: string } = {}): TrackRuntime {
    const real = defaultTrackRuntime(planRoot, BRANCH);
    return {
        addWorktree(root, ref, baseSha) {
            if (ref.trackId === opts.failWorktreeFor) throw new Error(`fallo inyectado: create-worktree de ${ref.trackId}`);
            real.addWorktree(root, ref, baseSha);
        },
        initTrackJournal(ref, context) {
            real.initTrackJournal(ref, context);
        },
        spawnSupervisor(ref) {
            const n = (instr.spawnCalls.get(ref.trackId) ?? 0) + 1;
            instr.spawnCalls.set(ref.trackId, n);
            // El "wrapper" real, al arrancar, escribe su claim antes que nada
            // (mismo contrato que `supervisor-wrapper.ts`): simulamos eso acá.
            instr.wrapperState.set(ref.trackId, 'claimed');
            return fakeProcessRef(ref.trackId, n);
        },
        observeSupervisor(ref): SupervisorObservation {
            const st = instr.wrapperState.get(ref.trackId) ?? 'absent';
            if (st === 'absent') return { kind: 'absent' };
            if (st === 'ready') return { kind: 'ready', readinessNonce: ref.readinessNonce };
            // 'claimed'/'identified' colapsan al mismo `SupervisorObservation`
            // que produce el `observeSupervisorFromDisk` real cuando el claim
            // ya existe pero `ready.json` todavía no (ver su código: ambos
            // casos devuelven 'claimed') — la recuperación de Task 9 no
            // necesita distinguirlos, solo saber que YA hay evidencia real.
            // El wrapper real sigue vivo (es un proceso aparte, ajeno a que
            // el supervisor del PLAN haya crasheado) y termina su propio
            // bootstrap poco después: la SIGUIENTE observación ya lo ve listo.
            instr.wrapperState.set(ref.trackId, 'ready');
            return { kind: 'claimed' };
        },
        async teardownOwned(ref, step) {
            if (step === 'supervisor') {
                instr.teardownEvents.push(`supervisor-stopped:${ref.trackId}`);
                return 'ok';
            }
            const result = await real.teardownOwned(ref, step);
            instr.teardownEvents.push(`${step === 'worktree' ? 'worktree-removed' : 'branch-removed'}:${ref.trackId}`);
            return result;
        },
        emitFreezeRequest() { throw new Error('no debería llamarse (Task 10, sin cobertura en esta suite)'); },
    };
}

function declareCohort(planRoot: string, root: string, baseSha: string, trackIds: string[]): JournalState {
    initJournal(planRoot, BRANCH);
    const s0 = readJournal(planRoot, BRANCH).state!;
    s0.cohortPhase = 'PREPARING';
    s0.cohortBaseSha = baseSha;
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
    return readJournal(planRoot, BRANCH).state!;
}

/** Fija la fase de `trackId` directamente en el journal persistido, SIN pasar
 *  por `reconcileTracks` — necesario para 'after-prepare-intent' y
 *  'after-worktree-effect': `persist-prepare-intent` es una transición
 *  puramente en memoria que `reconcileTracks` drena en el MISMO call que ya
 *  intenta `create-worktree` a continuación (ver el comentario grande sobre
 *  `reconcileTracks` en `tracks.ts`), así que "recién persistido
 *  PREPARE_INTENT, todavía nada más" no es un boundary EXTERNO alcanzable
 *  con un tick — hay que construirlo a mano para representar fielmente ese
 *  instante exacto de un crash real. */
function setPhase(planRoot: string, branch: string, trackId: string, phase: TrackRef['phase']): JournalState {
    const s = readJournal(planRoot, branch).state!;
    s.tracks = s.tracks!.map((t) => (t.trackId === trackId ? { ...t, phase } : t));
    writeJournal(planRoot, branch, s);
    return readJournal(planRoot, branch).state!;
}

function realWorktreeBranches(planRoot: string): string[] {
    let out: string;
    try {
        out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: planRoot, encoding: 'utf8' });
    } catch {
        return [];
    }
    const branches: string[] = [];
    for (const line of out.split('\n')) {
        if (line.startsWith('branch ')) branches.push(line.slice('branch '.length).replace('refs/heads/', ''));
    }
    return branches;
}

describe('reconcileTracks — crash/restart de P1 con git real (Task 9, R4.2/R4.3/R4.6/R4.8/R4.9/C1/C2/C11)', () => {
    let root: string;
    let planRoot: string;
    let baseSha: string;

    beforeEach(() => {
        planRoot = initRepo();
        commitFile(planRoot, '.gitignore', '.awm/\n');
        baseSha = commitFile(planRoot, 'seed.txt', 'seed');
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-track-crash-root-'));
    });

    afterEach(() => {
        try { execFileSync('git', ['worktree', 'prune'], { cwd: planRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
    });

    const crashPoints = [
        'after-prepare-intent', 'after-worktree-effect', 'after-worktree-result',
        'after-journal-effect', 'after-journal-result', 'after-supervisor-intent',
        'after-supervisor-claim', 'after-supervisor-identity', 'after-readiness',
    ] as const;

    test.each(crashPoints)('restart converge desde %s sin duplicar recursos (R4.2, C11)', async (point) => {
        const instr: RuntimeInstrumentation = { spawnCalls: new Map(), wrapperState: new Map(), teardownEvents: [] };
        const runtime = buildRuntime(planRoot, instr);
        let s = declareCohort(planRoot, root, baseSha, ['a', 'b']);

        // --- Fase 1: avanzar el track 'a' con ticks REALES hasta el punto
        // natural más cercano al crash pedido (todo boundary que
        // `reconcileTracks` ya persiste solo antes de tocar runtime de
        // nuevo). 'b' se queda en DECLARED: PREPARING procesa un track a la
        // vez, alfabéticamente, así que jamás arranca antes de que 'a' llegue
        // a ARMED.
        //
        // 'after-prepare-intent'/'after-worktree-effect' son la EXCEPCIÓN:
        // `persist-prepare-intent` es puramente en memoria y `reconcileTracks`
        // la drena en el MISMO call que ya intenta `create-worktree` a
        // continuación (ver el comentario grande sobre `reconcileTracks` en
        // `tracks.ts`) — "recién PREPARE_INTENT, todavía nada más" no es un
        // boundary externo alcanzable con un tick, así que se construye a
        // mano con `setPhase` en vez de tickear.
        const stopWhen: Record<string, (ref: TrackRef) => boolean> = {
            'after-worktree-result': (r) => r.phase === 'WORKTREE_CREATED',
            'after-journal-effect': (r) => r.phase === 'WORKTREE_CREATED',
            'after-journal-result': (r) => r.phase === 'JOURNAL_CREATED',
            'after-supervisor-intent': (r) => r.phase === 'SUPERVISOR_STARTING' && r.supervisorIntent !== undefined,
            'after-supervisor-claim': (r) => r.phase === 'SUPERVISOR_STARTING' && r.supervisorIntent !== undefined,
            'after-supervisor-identity': (r) => r.phase === 'SUPERVISOR_STARTING' && r.supervisorIntent !== undefined,
            'after-readiness': (r) => r.phase === 'ARMED',
        };
        if (point === 'after-prepare-intent' || point === 'after-worktree-effect') {
            s = setPhase(planRoot, BRANCH, 'a', 'PREPARE_INTENT');
        } else {
            for (let i = 0; i < 50; i++) {
                const a = s.tracks!.find((t) => t.trackId === 'a')!;
                if (stopWhen[point](a)) break;
                s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
            }
            const preCrashA = s.tracks!.find((t) => t.trackId === 'a')!;
            expect(stopWhen[point](preCrashA)).toBe(true);
        }

        // --- Simular el crash: para los 4 puntos donde el efecto real YA
        // corrió pero `tracks.ts` no llegó a persistir la observación, se
        // ejecuta la mutación real (mismas funciones que usaría
        // `runCreateWorktree`/`runSpawnTrackSupervisor`) SIN pasar por
        // `reconcileTracks` — así el journal queda exactamente como
        // quedaría tras un crash real justo ahí.
        const refA = () => s.tracks!.find((t) => t.trackId === 'a')!;
        if (point === 'after-worktree-effect') {
            defaultTrackRuntime(planRoot, BRANCH).addWorktree(planRoot, refA(), baseSha);
        }
        if (point === 'after-journal-effect') {
            defaultTrackRuntime(planRoot, BRANCH).initTrackJournal(refA(), {
                trackId: 'a', taskIds: [], planDigest: '', baseSha, planJournalId: s.journalId,
            });
        }
        if (point === 'after-supervisor-claim' || point === 'after-supervisor-identity') {
            // El spawn real ya ocurrió (proceso detached lanzado) y el
            // wrapper ya escribió su claim (y, en 'identity', también su
            // identity sidecar) — pero el supervisor del PLAN crasheó antes
            // de persistir `supervisorProcessRef`.
            runtime.spawnSupervisor(refA());
            instr.wrapperState.set('a', point === 'after-supervisor-claim' ? 'claimed' : 'identified');
        }

        // --- Fase 2 ("restart"): instrumentación fresca salvo lo que
        // sobreviviría de verdad a un crash (spawnCalls y wrapperState ya
        // acumulados arriba SÍ persisten — representan el mundo real, no
        // memoria de proceso). Reconciliar hasta que la cohorte quede ACTIVE.
        for (let i = 0; i < 100 && s.cohortPhase !== 'ACTIVE'; i++) {
            s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        }
        expect(s.cohortPhase).toBe('ACTIVE');
        for (const t of s.tracks!) expect(['ACTIVE', 'ARMED']).toContain(t.phase);

        // C11: ni un spawn de más, ni un worktree de más, por track.
        expect(Object.fromEntries(instr.spawnCalls)).toEqual({ a: 1, b: 1 });
        const branches = realWorktreeBranches(planRoot);
        expect(branches.filter((b) => b === 'awm-track/a')).toHaveLength(1);
        expect(branches.filter((b) => b === 'awm-track/b')).toHaveLength(1);
        // Ningún track quedó BLOCKED (el crash nunca debe leerse como ajeno).
        for (const t of s.tracks!) expect(t.blockedReason).toBeUndefined();
    });

    // No entra en `crashPoints`/`test.each` de arriba a propósito: esa matriz
    // asume que un restart converge SIN volver a llamar `spawnSupervisor`
    // (`spawnCalls === {a:1, b:1}`). Esta ventana es la excepción real —
    // documentada acá en vez de forzarla dentro de esa tabla compartida.
    test('crash entre el fork real del wrapper y su claim en disco: el restart re-spawnea de más; la exclusión de un segundo proceso VIVO la garantiza supervisor-wrapper.ts, no este driver (R4.2, C11)', async () => {
        // Ventana real que `observeSupervisor`/`decidePrepare` NO pueden
        // cerrar: entre que `runtime.spawnSupervisor` forkea el proceso
        // detached de verdad y que ESE proceso llega a
        // `fs.openSync(claimPath, 'wx', ...)` (`supervisor-wrapper.ts`), no
        // hay ningún artefacto en disco. Si el supervisor del PLAN crashea
        // justo ahí, el restart observa 'absent' (lo único honesto: no hay
        // evidencia todavía) y `decidePrepare` vuelve a pedir
        // 'retry-supervisor-same-intent' — `spawnSupervisor` se llama DE
        // NUEVO, un segundo fork real. Este test no simula al segundo
        // wrapper perdiendo la carrera de `wx`/`EEXIST` contra el primero
        // (el fake de este archivo no modela dos procesos wrapper
        // concurrentes) — esa exclusión, la que de verdad evita terminar con
        // dos supervisores VIVOS, ya tiene cobertura dedicada en
        // `cli/tests/commands/track/supervisor-wrapper.test.ts` ("un segundo
        // wrapper con el mismo claim detecta el claim existente y sale sin
        // lanzar otro supervisor (C11)"). Lo que se prueba acá es que la
        // segunda llamada a `spawnSupervisor` es el comportamiento ESPERADO
        // en esta ventana, no una regresión de C11.
        const instr: RuntimeInstrumentation = { spawnCalls: new Map(), wrapperState: new Map(), teardownEvents: [] };
        const runtime = buildRuntime(planRoot, instr);
        let s = declareCohort(planRoot, root, baseSha, ['a', 'b']);

        for (let i = 0; i < 50; i++) {
            const a = s.tracks!.find((t) => t.trackId === 'a')!;
            if (a.phase === 'SUPERVISOR_STARTING' && a.supervisorIntent !== undefined) break;
            s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        }
        const refA = () => s.tracks!.find((t) => t.trackId === 'a')!;
        expect(refA().phase).toBe('SUPERVISOR_STARTING');
        expect(refA().supervisorProcessRef).toBeUndefined();

        // Simular el fork real SIN claim en disco: a diferencia de
        // 'after-supervisor-claim'/'after-supervisor-identity' (que llaman a
        // `runtime.spawnSupervisor` y dejan que el fake avance
        // `wrapperState`), acá solo se incrementa el contador de forks —
        // `wrapperState` de 'a' queda 'absent' a propósito, representando la
        // instantánea exacta ANTES de que el wrapper real escriba su claim.
        instr.spawnCalls.set('a', 1);

        for (let i = 0; i < 100 && s.cohortPhase !== 'ACTIVE'; i++) {
            s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        }
        expect(s.cohortPhase).toBe('ACTIVE');

        // El driver no tiene forma de saber que ya había un fork en vuelo:
        // vuelve a spawnear. Dos llamadas reales a `spawnSupervisor` para
        // 'a' es el resultado ESPERADO en esta ventana — no un bug de C11 —
        // y por eso NO se afirma `spawnCalls === {a:1, b:1}` acá.
        expect(instr.spawnCalls.get('a')).toBe(2);
        expect(instr.spawnCalls.get('b')).toBe(1);
    });

    test('fallo del segundo track limpia el primero antes de serializar (R4.5, C2)', async () => {
        const instr: RuntimeInstrumentation = { spawnCalls: new Map(), wrapperState: new Map(), teardownEvents: [] };
        const runtime = buildRuntime(planRoot, instr, { failWorktreeFor: 'b' });
        let s = declareCohort(planRoot, root, baseSha, ['a', 'b']);

        for (let i = 0; i < 200 && s.cohortPhase !== 'SERIAL'; i++) {
            s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        }
        // Marcador propio del test (no de `runtime`): registra el momento en
        // que la cohorte se observa por primera vez en SERIAL, para poder
        // comparar su índice contra el de 'branch-removed:a' más abajo —
        // `nextProtocolEffect` solo emite 'enter-serial' una vez que TODOS
        // los tracks owned llegan a REMOVED (ver el branch `FALLBACK_PENDING`
        // en `protocol.ts`), así que este push siempre queda estrictamente
        // después de cualquier evento de teardown real.
        instr.teardownEvents.push('serial-entered');
        expect(s.cohortPhase).toBe('SERIAL');
        for (const t of s.tracks!) expect(['REMOVED', 'DECLARED']).toContain(t.phase);

        // 'a' (el sobreviviente hasta que 'b' falló) tuvo que desmantelarse
        // de verdad: supervisor "detenido", worktree y branch reales
        // removidos — en ese orden, y ANTES de entrar a SERIAL.
        expect(instr.teardownEvents).toEqual(expect.arrayContaining([
            'supervisor-stopped:a', 'worktree-removed:a', 'branch-removed:a',
        ]));
        expect(instr.teardownEvents.indexOf('branch-removed:a')).toBeLessThan(instr.teardownEvents.indexOf('serial-entered'));

        // Prueba REAL (no solo eventos): ni worktree ni branch de 'a' siguen vivos.
        const branches = realWorktreeBranches(planRoot);
        expect(branches).not.toContain('awm-track/a');
        expect(branches).not.toContain('awm-track/b');
        const worktreeA = path.join(root, 'track-a');
        expect(fs.existsSync(worktreeA)).toBe(false);
        const list = execFileSync('git', ['branch', '--list'], { cwd: planRoot, encoding: 'utf8' });
        expect(list).not.toContain('awm-track/a');
        expect(list).not.toContain('awm-track/b');
    });
});
