// Task 13 (R4.2/R4.3/R4.6/R4.10/C2/C9): crash/restart del teardown durable de
// UN track, con git REAL (mismo criterio que `track-bootstrap-crash.test.ts`,
// Task 9, y `track-join-crash.test.ts`, Task 11 — Tasks 8-12 establecieron el
// precedente de probar convergencia de crash contra un repo/worktree real,
// no fakes en memoria). `runBeginTeardown` garantiza, por construcción, "a lo
// sumo UN efecto real por invocación, persistido antes de seguir" (ver su
// comentario grande en `tracks.ts`) — así que cada uno de los 8 puntos del
// plan se representa fijando el journal EXACTAMENTE como quedaría tras un
// crash real justo ahí (mismo patrón que `setPhase`/las manipulaciones
// directas de `track-bootstrap-crash.test.ts` para los puntos "efecto real
// ya corrió, resultado todavía no persistido"), y verificando que un
// `reconcileTracks` fresco (runtime NUEVO, journal persistido intacto)
// converge a `REMOVED` con el worktree y la branch REALMENTE ausentes.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { reconcileTracks, defaultTrackRuntime, TrackRuntime } from '../../../src/commands/watch/tracks';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { addOwnedWorktree, removeOwnedWorktree as gitRemoveOwnedWorktree, removeOwnedBranch as gitRemoveOwnedBranch } from '../../../src/core/tracks/git';
import { writeDescriptor } from '../../../src/core/tracks/descriptor';
import type { JournalState, TrackRef, ProcessRef } from '../../../src/core/journal/types';

const BRANCH = 'main';

/** Identidad que `refIsAlive` (identity-verified, R4.8) SIEMPRE reporta como
 *  muerta: ningún proceso real jamás matchea estos campos fabricados — usada
 *  para representar "el supervisor propio ya está confirmado ausente"
 *  (idéntico efecto observable que si `stopOwnSupervisor` realmente hubiera
 *  corrido y confirmado, sin depender de matar un proceso real). */
function deadRef(): ProcessRef {
    return { pid: 999999, startTime: 'nunca-existió', spawnNonce: 'x', argvDigest: 'x', processGroup: 999999, psArgsDigest: 'dead' };
}

/** Runtime de producción para worktree/branch Y para `stopOwnSupervisor`
 *  (git real y `terminatePreviouslyOwnedGroup` real vía `defaultTrackRuntime`
 *  — post-review (hallazgo de revisión de Task 13): un fake que nunca llama
 *  al primitivo real no puede probar la propiedad de seguridad
 *  "ninguna señal alcanza un proceso ajeno" para el camino que de verdad
 *  corre en producción). Con `deadRef()` esto sigue resolviendo por el atajo
 *  de `groupIsGone` (pid 999999 no existe de verdad) — cero espera, mismo
 *  comportamiento observable que el fake anterior — pero ahora es el código
 *  real, no una simulación. Ningún otro método de `TrackRuntime` debería
 *  invocarse — esta suite solo ejercita `begin-teardown`. */
function buildRuntime(planRoot: string, events: string[]): TrackRuntime {
    const real = defaultTrackRuntime(planRoot, BRANCH);
    const unexpected = (what: string) => (): never => {
        throw new Error(`no debería llamarse: ${what} (esta suite solo ejercita begin-teardown)`);
    };
    return {
        addWorktree: unexpected('addWorktree'),
        initTrackJournal: unexpected('initTrackJournal'),
        spawnSupervisor: unexpected('spawnSupervisor'),
        observeSupervisor: unexpected('observeSupervisor'),
        async stopOwnSupervisor(ref) {
            const confirmed = await real.stopOwnSupervisor(ref);
            events.push(`stop-effect:${ref.trackId}`);
            return confirmed;
        },
        removeOwnedWorktree(repo, ref) {
            real.removeOwnedWorktree(repo, ref);
            events.push(`worktree-effect:${ref.trackId}`);
        },
        removeOwnedBranch(repo, branch) {
            real.removeOwnedBranch(repo, branch);
            events.push(`branch-effect:${branch}`);
        },
        emitFreezeRequest: unexpected('emitFreezeRequest'),
        mergeFrozenTrack: unexpected('mergeFrozenTrack'),
        abortOwnedMerge: unexpected('abortOwnedMerge'),
        async ensureIntegrationLock() { return unexpected('ensureIntegrationLock')(); },
        async pauseControllerGeneration() { return unexpected('pauseControllerGeneration')(); },
        releaseIntegrationLockIfHeld: unexpected('releaseIntegrationLockIfHeld'),
    };
}

function declareCohort(planRoot: string, root: string, baseSha: string): JournalState {
    initJournal(planRoot, BRANCH);
    const s0 = readJournal(planRoot, BRANCH).state!;
    s0.cohortPhase = 'FALLBACK_PENDING';
    s0.cohortBaseSha = baseSha;
    s0.tracks = [
        {
            trackId: 'a', worktreePath: path.join(root, 'track-a'), branch: 'awm-track/a',
            ownership: [], sharedResources: [], dependsOn: [],
            fencingToken: 'fa'.padEnd(32, '0'), phase: 'DECLARED', readinessNonce: 'ra'.padEnd(32, '0'),
        },
        // 'b' se queda en DECLARED siempre: `nextProtocolEffect` (FALLBACK_PENDING)
        // solo elige un track a la vez, alfabéticamente — jamás toca 'b'
        // mientras 'a' no llegue a REMOVED.
        {
            trackId: 'b', worktreePath: path.join(root, 'track-b'), branch: 'awm-track/b',
            ownership: [], sharedResources: [], dependsOn: [],
            fencingToken: 'fb'.padEnd(32, '0'), phase: 'DECLARED', readinessNonce: 'rb'.padEnd(32, '0'),
        },
    ] satisfies TrackRef[];
    writeJournal(planRoot, BRANCH, s0);
    return readJournal(planRoot, BRANCH).state!;
}

function setTrackA(planRoot: string, patch: Partial<TrackRef>): JournalState {
    const s = readJournal(planRoot, BRANCH).state!;
    s.tracks = s.tracks!.map((t) => (t.trackId === 'a' ? { ...t, ...patch } : t));
    writeJournal(planRoot, BRANCH, s);
    return readJournal(planRoot, BRANCH).state!;
}

function trackA(s: JournalState): TrackRef {
    return s.tracks!.find((t) => t.trackId === 'a')!;
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

function branchListed(planRoot: string, branch: string): boolean {
    const out = execFileSync('git', ['branch', '--list', branch], { cwd: planRoot, encoding: 'utf8' });
    return out.trim().length > 0;
}

describe('reconcileTracks — crash/restart de teardown con git real (Task 13, R4.2/R4.3/R4.6/R4.10/C2/C9)', () => {
    let root: string;
    let planRoot: string;
    let baseSha: string;

    beforeEach(() => {
        planRoot = initRepo();
        commitFile(planRoot, '.gitignore', '.awm/\n');
        baseSha = commitFile(planRoot, 'seed.txt', 'seed');
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-teardown-crash-root-'));
    });

    afterEach(() => {
        try { execFileSync('git', ['worktree', 'prune'], { cwd: planRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** Materializa el worktree+branch REALES de 'a' (git de verdad) y su
     *  descriptor `.awm/track.json` — la prueba de ownership que
     *  `worktreeOwnershipProven` exige antes de `remove-owned-worktree`. */
    function materializeTrackA(s: JournalState): void {
        const ref = trackA(s);
        addOwnedWorktree(planRoot, ref, baseSha);
        writeDescriptor(ref.worktreePath, {
            schema: 1, planRoot: fs.realpathSync(planRoot), planBranch: BRANCH,
            trackId: ref.trackId, planJournalId: s.journalId, fencingToken: ref.fencingToken,
        });
    }

    const teardownCrashPoints = [
        'after-teardown-request', 'after-teardown-intent', 'after-stop-effect',
        'after-supervisor-stopped', 'after-worktree-effect', 'after-worktree-removed',
        'after-branch-effect', 'after-branch-removed',
    ] as const;

    /** Deja el journal EXACTAMENTE como quedaría tras un crash real justo
     *  después del punto nombrado — mismo criterio que `setPhase` en
     *  `track-bootstrap-crash.test.ts`: para los puntos donde el efecto real
     *  YA corrió pero `tracks.ts` no llegó a persistir la observación
     *  (`after-stop-effect`, `after-worktree-effect`, `after-branch-effect`),
     *  se reproduce la mutación real fuera de `reconcileTracks` y se
     *  mantiene la fase ANTERIOR — el próximo tick debe volver a observar el
     *  mundo real (no confiar en memoria) para converger. */
    function setupAt(point: typeof teardownCrashPoints[number]): JournalState {
        let s = declareCohort(planRoot, root, baseSha);
        materializeTrackA(s);
        s = readJournal(planRoot, BRANCH).state!;
        const ref = trackA(s);

        if (point === 'after-teardown-request') {
            return setTrackA(planRoot, { phase: 'TEARDOWN_REQUESTED', supervisorProcessRef: deadRef() });
        }
        const teardownIntent = { worktreePath: ref.worktreePath, branch: ref.branch, supervisorNonce: undefined };
        if (point === 'after-teardown-intent') {
            return setTrackA(planRoot, { phase: 'TEARDOWN_INTENT', teardownIntent, supervisorProcessRef: deadRef() });
        }
        if (point === 'after-stop-effect') {
            // El efecto de stop YA corrió y el mundo real ya muestra al
            // supervisor confirmado ausente (`deadRef`) — pero la fase
            // TODAVÍA no avanzó a SUPERVISOR_STOPPED (crash justo ahí).
            return setTrackA(planRoot, { phase: 'TEARDOWN_INTENT', teardownIntent, supervisorProcessRef: deadRef() });
        }
        if (point === 'after-supervisor-stopped') {
            return setTrackA(planRoot, { phase: 'SUPERVISOR_STOPPED', teardownIntent, supervisorProcessRef: deadRef() });
        }
        if (point === 'after-worktree-effect') {
            // El worktree YA se removió de verdad (fuera de `reconcileTracks`,
            // mismo criterio que `after-worktree-effect` de Task 9), pero la
            // fase todavía dice SUPERVISOR_STOPPED.
            gitRemoveOwnedWorktree(planRoot, ref.worktreePath);
            return setTrackA(planRoot, { phase: 'SUPERVISOR_STOPPED', teardownIntent, supervisorProcessRef: deadRef() });
        }
        if (point === 'after-worktree-removed') {
            gitRemoveOwnedWorktree(planRoot, ref.worktreePath);
            return setTrackA(planRoot, { phase: 'WORKTREE_REMOVED', teardownIntent, supervisorProcessRef: deadRef() });
        }
        if (point === 'after-branch-effect') {
            gitRemoveOwnedWorktree(planRoot, ref.worktreePath);
            gitRemoveOwnedBranch(planRoot, ref.branch);
            return setTrackA(planRoot, { phase: 'WORKTREE_REMOVED', teardownIntent, supervisorProcessRef: deadRef() });
        }
        // 'after-branch-removed'
        gitRemoveOwnedWorktree(planRoot, ref.worktreePath);
        gitRemoveOwnedBranch(planRoot, ref.branch);
        return setTrackA(planRoot, { phase: 'BRANCH_REMOVED', teardownIntent, supervisorProcessRef: deadRef() });
    }

    test.each(teardownCrashPoints)('teardown converge desde %s (C9)', async (point) => {
        let s = setupAt(point);
        const events: string[] = [];

        // "Restart" tras el crash: runtime NUEVO (misma disciplina que
        // `track-bootstrap-crash.test.ts` — instrumentación fresca salvo lo
        // que sobreviviría de verdad a un crash real, que acá es el propio
        // repo git). Reconciliar hasta REMOVED o hasta agotar un límite
        // generoso de ticks (cada tick es a lo sumo UNA frontera real).
        const runtime = buildRuntime(planRoot, events);
        for (let i = 0; i < 20 && trackA(s).phase !== 'REMOVED'; i++) {
            s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        }

        expect(trackA(s).phase).toBe('REMOVED');
        expect(trackA(s).blockedReason).toBeUndefined();
        // Prueba REAL (no solo el journal): el worktree y la branch de 'a'
        // están genuinamente ausentes del repo.
        expect(fs.existsSync(path.join(root, 'track-a'))).toBe(false);
        expect(realWorktreeBranches(planRoot)).not.toContain('awm-track/a');
        expect(branchListed(planRoot, 'awm-track/a')).toBe(false);
        // 'b' (DECLARED, nunca tocado) permanece exactamente como se declaró.
        const b = s.tracks!.find((t) => t.trackId === 'b')!;
        expect(b.phase).toBe('DECLARED');
        expect(fs.existsSync(path.join(root, 'track-b'))).toBe(false);
    });

    // Step 4 del plan ("supervisor propio muerto confirmado Y lock ausente"):
    // un lock advisory que el supervisor dejó sin liberar (crash a mitad de
    // su propia salida) nunca debe atascar el teardown para siempre — una
    // vez que su grupo entero está confirmado ausente por identidad, el lock
    // es demostrablemente stale (vive en el worktree PROPIO del track) y se
    // reclama. Usa `defaultTrackRuntime` de PRODUCCIÓN (no el fake de esta
    // suite) para probar el efecto real de `stopOwnSupervisor`.
    test('lock advisory stale (supervisor muerto sin liberarlo) se reclama y el teardown converge (C9)', async () => {
        let s = declareCohort(planRoot, root, baseSha);
        materializeTrackA(s);
        s = readJournal(planRoot, BRANCH).state!;
        const ref = trackA(s);
        const lockPath = path.join(ref.worktreePath, '.awm', 'journal', 'supervisor.lock');
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        fs.writeFileSync(lockPath, 'lock stale de un supervisor que crasheó sin liberar\n');

        s = setTrackA(planRoot, {
            phase: 'TEARDOWN_INTENT',
            teardownIntent: { worktreePath: ref.worktreePath, branch: ref.branch, supervisorNonce: undefined },
            supervisorProcessRef: deadRef(), // proceso confirmado muerto: solo el lock lo retiene
        });

        const runtime = defaultTrackRuntime(planRoot, BRANCH);
        for (let i = 0; i < 20 && trackA(s).phase !== 'REMOVED'; i++) {
            s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        }

        expect(trackA(s).phase).toBe('REMOVED');
        expect(fs.existsSync(lockPath)).toBe(false);
        expect(fs.existsSync(path.join(root, 'track-a'))).toBe(false);
        expect(branchListed(planRoot, 'awm-track/a')).toBe(false);
    });

    // R4.6/R4.10/C9: un worktree cuyo ownership es indemostrable (descriptor
    // ausente/corrupto, o simplemente no es el que `teardownIntent` espera)
    // NUNCA se adopta ni se borra — el track se bloquea, y el contenido
    // "ajeno" permanece byte-idéntico. `BLOCKED` es un dead end automático
    // (ver `decideTeardown`): reconciliar de nuevo, cuantas veces sea, jamás
    // lo saca solo de ahí.
    test('worktree con ownership indemostrable bloquea SIN tocarlo — el fixture ajeno queda byte-idéntico (R4.6, R4.10, C9)', async () => {
        let s = declareCohort(planRoot, root, baseSha);
        const ref = trackA(s);
        // El path existe (registrado como worktree real por git, igual que
        // uno legítimamente propio) pero SIN el descriptor `.awm/track.json`
        // que probaría identidad — `worktreeOwnershipProven` debe fallar.
        addOwnedWorktree(planRoot, ref, baseSha);
        const marker = path.join(ref.worktreePath, 'foreign.marker');
        fs.writeFileSync(marker, 'contenido ajeno, nunca tocar\n');
        const markerBytesBefore = fs.readFileSync(marker);

        s = setTrackA(planRoot, {
            phase: 'SUPERVISOR_STOPPED',
            teardownIntent: { worktreePath: ref.worktreePath, branch: ref.branch, supervisorNonce: undefined },
            supervisorProcessRef: deadRef(),
        });

        const events: string[] = [];
        const runtime = buildRuntime(planRoot, events);
        for (let i = 0; i < 5; i++) {
            s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        }

        expect(trackA(s).phase).toBe('BLOCKED');
        expect(trackA(s).blockedReason).toBe('worktree preexistente ajeno');
        // Nunca se llamó al efecto real de remoción — ownership nunca se probó.
        expect(events).toEqual([]);
        // El worktree y su contenido siguen ahí, byte por byte.
        expect(fs.existsSync(ref.worktreePath)).toBe(true);
        expect(fs.readFileSync(marker)).toEqual(markerBytesBefore);
        expect(realWorktreeBranches(planRoot)).toContain('awm-track/a');

        // BLOCKED es un dead end AUTOMÁTICO: más reconciliaciones no lo mueven.
        const again = await reconcileTracks(planRoot, BRANCH, s, runtime, 2);
        expect(trackA(again.state).phase).toBe('BLOCKED');
        expect(fs.readFileSync(marker)).toEqual(markerBytesBefore);
    });

    // Post-review (hallazgo de revisión de Task 13): la prueba literal que el
    // sketch del plan (Step 5) pedía — `h.signalledForeignProcess()).toBe(false)`
    // — y que esta suite nunca ejercitaba porque `stopOwnSupervisor` era
    // 100% fake. `supervisorProcessRef` en el journal describe un supervisor
    // previo ya extinto cuyo pgid el SO recicló (simulado, mismo criterio que
    // el fixture R6 de `process.test.ts`) hacia `bystander`, un proceso REAL,
    // vivo y completamente ajeno.
    //
    // Con `defaultTrackRuntime` real, esta identidad-fabricada NUNCA llega a
    // `stopOwnSupervisor`/`terminatePreviouslyOwnedGroup`: `gatherTeardownObservation`
    // ya usa `refIsAlive` (identidad completa) para decidir `ownSupervisorAlive`
    // en la MISMA tick, así que un pgid reciclado con identidad distinta se
    // reporta como "nuestro supervisor ya está muerto" y el teardown avanza
    // por `accept-supervisor-stopped` — nunca por `stop-own-supervisor` — sin
    // jamás tocar al bystander (defensa en profundidad ya existente, ver el
    // comentario de `gatherTeardownObservation`). Esta prueba confirma esa
    // propiedad end-to-end (converge a REMOVED sin señal alguna al ajeno); la
    // prueba siguiente confirma la MISMA propiedad un nivel más abajo, en el
    // primitivo `defaultTrackRuntime(...).stopOwnSupervisor` en sí mismo (el
    // fix real de `groupLeaderReused` en `process.ts`), sin depender de esa
    // capa superior.
    test('supervisor propio con PGID reciclado por un proceso ajeno: el teardown converge sin jamás señalizarlo (R4.8, post-review)', async () => {
        let s = declareCohort(planRoot, root, baseSha);
        materializeTrackA(s);
        s = readJournal(planRoot, BRANCH).state!;
        const ref = trackA(s);

        // Vive hasta que el `finally` lo mate, NO 5 segundos. Estos dos tests son los
        // únicos de la suite que asertan que el proceso ajeno SIGUE VIVO al final, y un
        // tiempo fijo convierte esa aserción en una carrera contra la plataforma más lenta:
        // en Windows este archivo tarda ~22s, así que el bystander moría de viejo y el test
        // reportaba "lo matamos" cuando `signalledForeignProcess` probaba lo contrario.
        // Se elimina la carrera en vez de agrandarle el margen.
        const bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { detached: true, stdio: 'ignore' });
        if (bystander.pid === undefined) throw new Error('spawn de bystander falló');
        const bystanderPid = bystander.pid;
        await new Promise((resolve) => setTimeout(resolve, 150));   // dejar asentar identidad real vía ps

        const staleSupervisorRef: ProcessRef = {
            pid: bystanderPid,
            startTime: 'Mon Jan  1 00:00:00 2024',                       // supervisor anterior, ya extinto
            spawnNonce: 'nonce-de-un-supervisor-anterior-ya-muerto',
            argvDigest: 'deadbeefdeadbeef',
            processGroup: bystanderPid,                                  // MISMO número de pgid (reciclado)
            psArgsDigest: 'cafebabecafebabe',
        };

        s = setTrackA(planRoot, {
            phase: 'TEARDOWN_INTENT',
            teardownIntent: { worktreePath: ref.worktreePath, branch: ref.branch, supervisorNonce: undefined },
            supervisorProcessRef: staleSupervisorRef,
        });

        const killSpy = jest.spyOn(process, 'kill');
        try {
            const runtime = defaultTrackRuntime(planRoot, BRANCH, { termGraceMs: 100, killGraceMs: 100 });
            for (let i = 0; i < 20 && trackA(s).phase !== 'REMOVED'; i++) {
                s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
            }

            expect(trackA(s).phase).toBe('REMOVED');
            const signalledForeignProcess = killSpy.mock.calls.some(([target]) => Number(target) === -bystanderPid);
            expect(signalledForeignProcess).toBe(false);
            // El bystander sigue vivo: nunca fue tocado.
            expect(() => process.kill(bystanderPid, 0)).not.toThrow();
        } finally {
            killSpy.mockRestore();
            bystander.kill('SIGKILL');
        }
    });

    // Complemento de la prueba anterior, un nivel más abajo: llama
    // directamente a `defaultTrackRuntime(...).stopOwnSupervisor` (el mismo
    // primitivo que `runBeginTeardown` invoca en producción para la decisión
    // `stop-own-supervisor`), sin pasar por `gatherTeardownObservation`. Esto
    // prueba el fix de `groupLeaderReused` (`process.ts`) en sí mismo — que
    // el PRIMITIVO, no solo la capa de arriba, se niega a señalizar un pgid
    // reciclado por un proceso ajeno vivo.
    test('defaultTrackRuntime.stopOwnSupervisor jamás señaliza un pgid reciclado por un proceso ajeno, aunque se lo invoque directo (R4.8, post-review)', async () => {
        let s = declareCohort(planRoot, root, baseSha);
        materializeTrackA(s);
        s = readJournal(planRoot, BRANCH).state!;
        const ref = trackA(s);

        // Vive hasta que el `finally` lo mate, NO 5 segundos. Estos dos tests son los
        // únicos de la suite que asertan que el proceso ajeno SIGUE VIVO al final, y un
        // tiempo fijo convierte esa aserción en una carrera contra la plataforma más lenta:
        // en Windows este archivo tarda ~22s, así que el bystander moría de viejo y el test
        // reportaba "lo matamos" cuando `signalledForeignProcess` probaba lo contrario.
        // Se elimina la carrera en vez de agrandarle el margen.
        const bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { detached: true, stdio: 'ignore' });
        if (bystander.pid === undefined) throw new Error('spawn de bystander falló');
        const bystanderPid = bystander.pid;
        await new Promise((resolve) => setTimeout(resolve, 150));

        const staleSupervisorRef: ProcessRef = {
            pid: bystanderPid,
            startTime: 'Mon Jan  1 00:00:00 2024',
            spawnNonce: 'nonce-de-un-supervisor-anterior-ya-muerto',
            argvDigest: 'deadbeefdeadbeef',
            processGroup: bystanderPid,
            psArgsDigest: 'cafebabecafebabe',
        };

        const killSpy = jest.spyOn(process, 'kill');
        try {
            const runtime = defaultTrackRuntime(planRoot, BRANCH, { termGraceMs: 100, killGraceMs: 100 });
            const confirmed = await runtime.stopOwnSupervisor({ ...ref, supervisorProcessRef: staleSupervisorRef });

            expect(confirmed).toBe(false);   // fail-closed: nunca declara "confirmado ausente" arriesgando un ajeno
            const signalledForeignProcess = killSpy.mock.calls.some(([target]) => Number(target) === -bystanderPid);
            expect(signalledForeignProcess).toBe(false);
            expect(() => process.kill(bystanderPid, 0)).not.toThrow();
        } finally {
            killSpy.mockRestore();
            bystander.kill('SIGKILL');
        }
    });
});
