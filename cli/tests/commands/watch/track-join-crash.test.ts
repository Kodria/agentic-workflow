// Task 11 (R6.2/R6.3/R6.6-R6.9/C7): crash/restart de P2 (join durable) contra
// git REAL — mismo criterio que `track-bootstrap-crash.test.ts` (Task 9):
// probar "sin doble merge" (C11-adjacent) solo tiene sentido mirando el
// repo real, no eventos. Se reutiliza la MISMA instancia de `TrackRuntime`
// (`defaultTrackRuntime`) a lo largo de "antes" y "después" del crash — el
// "crash" se simula deteniendo los ticks y, cuando el efecto real ya ocurrió
// pero no se persistió, reproduciéndolo a mano con las MISMAS funciones
// reales (`mergeFrozenTrack`), exactamente como `buildRuntime`/`stopWhen` de
// Task 9 reconstruyen el mundo tras un crash sin volver a levantar un
// proceso nuevo (dentro de un mismo proceso Jest, un "proceso nuevo" real
// para `integration.lock` reclamaría identidad viva-por-definición del pid
// del test runner — no es lo que este archivo necesita probar; eso ya lo
// cubre `join.test.ts`/Task 10 con `ProcessRef`s fabricados).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { reconcileTracks, defaultTrackRuntime, TrackRuntime } from '../../../src/commands/watch/tracks';
import { mergeFrozenTrack, readMergeHead, dirtyPaths } from '../../../src/core/tracks/git';
import { integrationLockPath, eventsPath } from '../../../src/core/journal/paths';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import type { JournalState, TrackRef } from '../../../src/core/journal/types';
import type { JoinIntent } from '../../../src/core/tracks/types';

const BRANCH = 'main';

function gitLocal(repo: string, args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' });
}

function trackRef(id: string, overrides: Partial<TrackRef> = {}): TrackRef {
    return {
        trackId: id, worktreePath: `/nonexistent/${id}`, branch: `awm-track/${id}`,
        ownership: [], sharedResources: [], dependsOn: [],
        fencingToken: `fence-${id}`.padEnd(32, '0'), phase: 'FROZEN', readinessNonce: `ready-${id}`.padEnd(32, '0'),
        ...overrides,
    };
}

function mergeCommitCountFor(repo: string, trackHeadSha: string): number {
    let out: string;
    try {
        out = gitLocal(repo, ['log', '--all', '--format=%H %P']);
    } catch {
        return 0;
    }
    return out.split('\n').filter((line) => line.trim().length > 0 && line.split(' ').slice(1).includes(trackHeadSha)).length;
}

describe('reconcileTracks — crash/restart de P2 (join) con git real (Task 11, R6.2/R6.3/R6.6-R6.9/C7)', () => {
    let planRoot: string;
    let root: string;
    let baseSha: string;

    beforeEach(() => {
        planRoot = initRepo();
        gitLocal(planRoot, ['config', 'user.email', 't@t.t']);
        gitLocal(planRoot, ['config', 'user.name', 't']);
        gitLocal(planRoot, ['config', 'commit.gpgsign', 'false']);
        commitFile(planRoot, '.gitignore', '.awm/\n');
        baseSha = commitFile(planRoot, 'seed.txt', 'seed');
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-join-crash-root-'));
    });

    afterEach(() => {
        try { execFileSync('git', ['worktree', 'prune'], { cwd: planRoot, stdio: 'pipe' }); } catch { /* best-effort */ }
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** Worktree REAL para un track — comparte el object store del repo del
     *  plan (mismo `.git`), así que el SHA congelado queda alcanzable sin
     *  fetch, exactamente como lo dejaría `addOwnedWorktree` en producción. */
    function makeTrackHead(id: string, filename: string, content: string): string {
        const wt = path.join(root, `wt-${id}`);
        gitLocal(planRoot, ['worktree', 'add', '-b', `awm-track/${id}`, wt, baseSha]);
        fs.writeFileSync(path.join(wt, filename), content);
        gitLocal(wt, ['add', '--', filename]);
        gitLocal(wt, ['commit', '-qm', `track ${id}`]);
        return gitLocal(wt, ['rev-parse', 'HEAD']).trim();
    }

    function declareCohort(refs: TrackRef[]): JournalState {
        initJournal(planRoot, BRANCH);
        const s0 = readJournal(planRoot, BRANCH).state!;
        s0.cohortPhase = 'JOINING';
        s0.cohortBaseSha = baseSha;
        s0.tracks = refs;
        writeJournal(planRoot, BRANCH, s0);
        return readJournal(planRoot, BRANCH).state!;
    }

    async function driveToConvergence(runtime: TrackRuntime, maxTicks = 20): Promise<JournalState> {
        let s = readJournal(planRoot, BRANCH).state!;
        for (let i = 0; i < maxTicks; i++) {
            if (s.tracks!.every((t) => t.phase === 'MERGED_UNVERIFIED')) break;
            s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        }
        return s;
    }

    // --- Los 5 puntos de crash "en línea recta" (sin conflicto real): -------
    // 'after-merge-effect' y 'after-merge-observation' colapsan a la MISMA
    // frontera observable en esta implementación síncrona (`runMergeTrack`
    // lee-decide-ejecuta-relee-persiste dentro de UNA sola invocación, sin
    // punto async intermedio entre "el merge real ya ocurrió" y "se
    // observó/persistió") — mismo criterio que `track-bootstrap-crash.test.ts`
    // documenta para sus propios puntos no alcanzables como boundary externo
    // (`after-prepare-intent`/`after-worktree-effect`). Ambos se prueban acá
    // con la MISMA construcción manual: el merge real ya corrió (vía
    // `mergeFrozenTrack` invocado directamente, fuera de `reconcileTracks`,
    // igual que `buildRuntime` de Task 9 llama a `defaultTrackRuntime(...)
    // .addWorktree(...)` a mano) pero el journal todavía muestra `JOIN_INTENT`.
    const crashPoints = [
        'after-join-request', 'after-join-intent', 'after-merge-effect', 'after-merge-observation', 'after-merged-result',
    ] as const;

    test.each(crashPoints)('join converge desde %s sin doble merge (R6.2, R6.8)', async (point) => {
        const aHead = makeTrackHead('a', 'a.txt', 'A content\n');
        const bHead = makeTrackHead('b', 'b.txt', 'B content\n');
        const refA = trackRef('a', { frozenHeadSha: aHead });
        const refB = trackRef('b', { frozenHeadSha: bHead });
        const intentA: JoinIntent = { expectedPlanHeadSha: baseSha, expectedTrackHeadSha: aHead, strategy: 'no-ff' };

        if (point === 'after-join-request') {
            declareCohort([refA, refB]);
        } else if (point === 'after-join-intent') {
            declareCohort([{ ...refA, phase: 'JOIN_INTENT', joinIntent: intentA }, refB]);
        } else if (point === 'after-merge-effect' || point === 'after-merge-observation') {
            declareCohort([{ ...refA, phase: 'JOIN_INTENT', joinIntent: intentA }, refB]);
            // El merge real YA corrió (crash entre el efecto git y su
            // observación/persistencia) — reproducido a mano con la MISMA
            // función real que usaría `runMergeTrack`.
            mergeFrozenTrack(planRoot, intentA);
        } else {
            // 'after-merged-result': A ya quedó completamente persistido como
            // MERGED_UNVERIFIED en un ciclo anterior — el merge real también
            // ya corrió.
            mergeFrozenTrack(planRoot, intentA);
            const mergedHead = gitLocal(planRoot, ['rev-parse', 'HEAD']).trim();
            const s0 = declareCohort([
                { ...refA, phase: 'MERGED_UNVERIFIED', joinIntent: intentA, joinedCommitSha: mergedHead },
                refB,
            ]);
            s0.cohortPlanHeadSha = mergedHead;
            writeJournal(planRoot, BRANCH, s0);
        }

        const runtime = defaultTrackRuntime(planRoot, BRANCH);
        const finalState = await driveToConvergence(runtime);

        // C11-adjacent: ni un merge de más por track, sin importar desde qué
        // frontera arrancó el "restart".
        expect(mergeCommitCountFor(planRoot, aHead)).toBe(1);
        expect(mergeCommitCountFor(planRoot, bHead)).toBe(1);
        expect(readMergeHead(planRoot)).toBeNull();
        expect(dirtyPaths(planRoot)).toEqual([]);
        const a = finalState.tracks!.find((t) => t.trackId === 'a')!;
        const b = finalState.tracks!.find((t) => t.trackId === 'b')!;
        expect(a.phase).toBe('MERGED_UNVERIFIED');
        expect(b.phase).toBe('MERGED_UNVERIFIED');
        // C7: `integration.lock` adquirido antes del primer join y RETENIDO
        // (Task 12 lo libera recién tras el interlock final — esta task
        // nunca lo suelta).
        expect(fs.existsSync(integrationLockPath(planRoot))).toBe(true);
    });

    // --- 'during-conflict': fixture con conflicto REAL (misma línea en el
    // merge de A ya aplicado y en el frozenHeadSha de B), no incluido en la
    // tabla de arriba porque su convergencia NO es "ambos MERGED_UNVERIFIED"
    // — es "el merge propio se abortó y queda reintentable, con índice
    // limpio" (texto explícito del plan). -----------------------------------
    test('join converge desde during-conflict abortando solo el merge propio, con índice limpio (R6.2, R6.8)', async () => {
        // A y B editan la MISMA línea de `shared.txt`: al mergear A primero
        // (limpio, contra `baseSha`) y a B después (contra el merge de A),
        // git produce un conflicto REAL de contenido — no una carrera de
        // HEAD ni un `assertPlanHead` fallido.
        const aHead = makeTrackHead('a', 'shared.txt', 'A-version\n');
        const bHead = makeTrackHead('b', 'shared.txt', 'B-version\n');
        const refA = trackRef('a', { frozenHeadSha: aHead });
        const refB = trackRef('b', { frozenHeadSha: bHead });
        declareCohort([refA, refB]);

        const runtime = defaultTrackRuntime(planRoot, BRANCH);

        // Fase 1: converger A por el camino normal (limpio) hasta que quede
        // MERGED_UNVERIFIED y B tenga su propio JOIN_INTENT persistido —
        // ambos pasos vía el driver real, sin inyectar nada todavía.
        let s = readJournal(planRoot, BRANCH).state!;
        for (let i = 0; i < 20; i++) {
            const a = s.tracks!.find((t) => t.trackId === 'a')!;
            const b = s.tracks!.find((t) => t.trackId === 'b')!;
            if (a.phase === 'MERGED_UNVERIFIED' && b.phase === 'JOIN_INTENT' && b.joinIntent !== undefined) break;
            s = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        }
        const aAfter = s.tracks!.find((t) => t.trackId === 'a')!;
        const bAfter = s.tracks!.find((t) => t.trackId === 'b')!;
        expect(aAfter.phase).toBe('MERGED_UNVERIFIED');
        expect(bAfter.phase).toBe('JOIN_INTENT');
        const intentB = bAfter.joinIntent!;

        // --- Simular el crash: el merge de B YA se intentó de verdad (fuera
        // de `reconcileTracks`, misma técnica que los otros puntos) y
        // produjo un conflicto REAL — el proceso murió antes de observarlo.
        expect(() => mergeFrozenTrack(planRoot, intentB)).toThrow();
        expect(readMergeHead(planRoot)).toBe(bHead);
        expect(dirtyPaths(planRoot).length).toBeGreaterThan(0);

        // --- "Restart": UN tick real debe abortar el merge propio (mergeHead
        // coincide con nuestro propio `expectedTrackHeadSha`) y dejar el
        // índice limpio — B queda reintentable (JOIN_INTENT), NUNCA se marca
        // MERGED_UNVERIFIED con un conflicto sin resolver.
        const afterAbort = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;
        expect(readMergeHead(planRoot)).toBeNull();
        expect(dirtyPaths(planRoot)).toEqual([]);
        const bFinal = afterAbort.tracks!.find((t) => t.trackId === 'b')!;
        expect(['JOIN_INTENT', 'BLOCKED']).toContain(bFinal.phase);
        expect(mergeCommitCountFor(planRoot, bHead)).toBe(0);   // jamás se aplicó
        expect(mergeCommitCountFor(planRoot, aHead)).toBe(1);   // A no se re-tocó

        // Un segundo ciclo completo (reintento -> conflicto de nuevo -> abort
        // de nuevo) tampoco corrompe nada ni duplica el merge de A: la
        // convergencia real de B requeriría resolución humana del conflicto,
        // pero el mecanismo nunca dobla-mergea ni deja basura.
        const afterRetryConflict = (await reconcileTracks(planRoot, BRANCH, afterAbort, runtime, 2)).state;
        const afterSecondAbort = (await reconcileTracks(planRoot, BRANCH, afterRetryConflict, runtime, 2)).state;
        expect(readMergeHead(planRoot)).toBeNull();
        expect(dirtyPaths(planRoot)).toEqual([]);
        expect(mergeCommitCountFor(planRoot, bHead)).toBe(0);
        expect(mergeCommitCountFor(planRoot, aHead)).toBe(1);
        const bSecond = afterSecondAbort.tracks!.find((t) => t.trackId === 'b')!;
        expect(['JOIN_INTENT', 'BLOCKED']).toContain(bSecond.phase);
    });

    // --- Post-review fix (Finding 1, revisión de Task 11): `ensureIntegrationLock`
    // y el intento de merge/abort son DOS fronteras `reconcileTracks()`
    // distintas — antes, un `ensureIntegrationLock` que hacía trabajo real
    // (primer tick de un proceso vivo) seguía, en el MISMO call, a intentar
    // el merge/abort (dos mutaciones reales en una sola invocación). Estos
    // tests usan un `TrackRuntime` fake para `ensureIntegrationLock`
    // (controlando directamente 'acquired'/'already-held') pero delegan
    // `mergeFrozenTrack`/`abortOwnedMerge` al `defaultTrackRuntime` REAL —
    // mismo criterio de mezcla real/fake que `buildRuntime` en
    // `track-bootstrap-crash.test.ts`. No se reimplementa la reclamación de
    // identidad muerta acá (eso ya lo prueba `join.test.ts`/Task 10 en
    // aislamiento, con `ProcessRef`s fabricados) — lo que se prueba es la
    // consecuencia en `runMergeTrack`: NUNCA fundir "lock recién adquirido"
    // con "intento de merge" en un mismo call, sin importar cuántas veces un
    // restart real haya tenido que re-adquirir de verdad.
    describe('runMergeTrack — adquisición del lock y merge son fronteras separadas (Finding 1)', () => {
        function fakeMergeRuntime(
            lockResult: 'acquired' | 'already-held',
            calls: { lock: number; merge: string[]; abort: string[] },
        ): TrackRuntime {
            const real = defaultTrackRuntime(planRoot, BRANCH);
            const unexpected = (what: string) => (): never => {
                throw new Error(`no debería llamarse: ${what} (fixture ya en JOIN_INTENT, solo merge-track en juego)`);
            };
            return {
                addWorktree: unexpected('addWorktree'),
                initTrackJournal: unexpected('initTrackJournal'),
                spawnSupervisor: unexpected('spawnSupervisor'),
                observeSupervisor: unexpected('observeSupervisor'),
                teardownOwned: async () => unexpected('teardownOwned')(),
                emitFreezeRequest: unexpected('emitFreezeRequest'),
                mergeFrozenTrack(repo, intent) {
                    calls.merge.push(intent.expectedTrackHeadSha);
                    real.mergeFrozenTrack(repo, intent);
                },
                abortOwnedMerge(repo, intent) {
                    calls.abort.push(intent.expectedTrackHeadSha);
                    real.abortOwnedMerge(repo, intent);
                },
                async ensureIntegrationLock() {
                    calls.lock += 1;
                    return lockResult;
                },
            };
        }

        function declareJoinIntentCohort(aHead: string, bHead: string): { s0: JournalState; intentA: JoinIntent } {
            const refA = trackRef('a', { frozenHeadSha: aHead });
            const refB = trackRef('b', { frozenHeadSha: bHead });
            const intentA: JoinIntent = { expectedPlanHeadSha: baseSha, expectedTrackHeadSha: aHead, strategy: 'no-ff' };
            const s0 = declareCohort([{ ...refA, phase: 'JOIN_INTENT', joinIntent: intentA }, refB]);
            return { s0, intentA };
        }

        test('un call que adquiere el lock por primera vez NO intenta el merge en ese mismo call (R6.2/C7)', async () => {
            const aHead = makeTrackHead('a', 'a.txt', 'A content\n');
            const bHead = makeTrackHead('b', 'b.txt', 'B content\n');
            const { s0 } = declareJoinIntentCohort(aHead, bHead);

            const calls = { lock: 0, merge: [] as string[], abort: [] as string[] };
            const runtime = fakeMergeRuntime('acquired', calls);
            const result = await reconcileTracks(planRoot, BRANCH, s0, runtime, 2);

            expect(calls.lock).toBe(1);
            expect(calls.merge).toEqual([]);
            expect(calls.abort).toEqual([]);
            expect(readMergeHead(planRoot)).toBeNull();
            expect(mergeCommitCountFor(planRoot, aHead)).toBe(0);
            const a = result.state.tracks!.find((t) => t.trackId === 'a')!;
            expect(a.phase).toBe('JOIN_INTENT'); // sin cambios: el intento de merge queda para el PRÓXIMO call
        });

        test('una vez el lock está confirmado held ("already-held"), el PRÓXIMO call sí intenta el merge (R6.2/C7)', async () => {
            const aHead = makeTrackHead('a', 'a.txt', 'A content\n');
            const bHead = makeTrackHead('b', 'b.txt', 'B content\n');
            const { s0 } = declareJoinIntentCohort(aHead, bHead);

            const calls = { lock: 0, merge: [] as string[], abort: [] as string[] };
            const runtime = fakeMergeRuntime('already-held', calls);
            const result = await reconcileTracks(planRoot, BRANCH, s0, runtime, 2);

            expect(calls.lock).toBe(1);
            expect(calls.merge).toEqual([aHead]);
            const a = result.state.tracks!.find((t) => t.trackId === 'a')!;
            expect(a.phase).toBe('MERGED_UNVERIFIED');
        });

        test('crash justo tras adquirir el lock + restart: el proceso nuevo tampoco funde adquisición y merge, y converge sin re-adquirir de más una vez confirmado held (Finding 1)', async () => {
            const aHead = makeTrackHead('a', 'a.txt', 'A content\n');
            const bHead = makeTrackHead('b', 'b.txt', 'B content\n');
            const { s0 } = declareJoinIntentCohort(aHead, bHead);
            let s = s0;

            // "Proceso 1" (antes del crash): primer tick de un proceso vivo —
            // `ensureIntegrationLock` hace trabajo real y devuelve 'acquired'.
            // El "crash" ocurre justo acá: cero merges intentados todavía.
            const callsP1 = { lock: 0, merge: [] as string[], abort: [] as string[] };
            s = (await reconcileTracks(planRoot, BRANCH, s, fakeMergeRuntime('acquired', callsP1), 2)).state;
            expect(callsP1.merge).toEqual([]);
            expect(s.tracks!.find((t) => t.trackId === 'a')!.phase).toBe('JOIN_INTENT');

            // "Proceso 2" (restart): closure de runtime NUEVA — el journal
            // sigue mostrando JOIN_INTENT (nada se persiste sobre el lock en
            // sí, por diseño: es un primitivo de filesystem ajeno al
            // journal). Su PROPIO primer tick también adquiere de verdad
            // (reclamo de identidad muerta del proceso 1 — esa lógica en
            // aislamiento ya la prueba `join.test.ts`/Task 10) y por eso
            // TAMBIÉN corta acá — nunca funde su propia adquisición con un
            // intento de merge en el mismo call.
            const callsP2a = { lock: 0, merge: [] as string[], abort: [] as string[] };
            s = (await reconcileTracks(planRoot, BRANCH, s, fakeMergeRuntime('acquired', callsP2a), 2)).state;
            expect(callsP2a.merge).toEqual([]);
            expect(readMergeHead(planRoot)).toBeNull();
            expect(mergeCommitCountFor(planRoot, aHead)).toBe(0);
            expect(s.tracks!.find((t) => t.trackId === 'a')!.phase).toBe('JOIN_INTENT');

            // Recién ahora, con el lock confirmado held DENTRO del proceso 2
            // (misma memoización por closure que la implementación real), el
            // SIGUIENTE call avanza al intento de merge — una única vez, sin
            // re-adquirir ni doble-adquirir.
            const callsP2b = { lock: 0, merge: [] as string[], abort: [] as string[] };
            s = (await reconcileTracks(planRoot, BRANCH, s, fakeMergeRuntime('already-held', callsP2b), 2)).state;
            expect(callsP2b.lock).toBe(1);
            expect(callsP2b.merge).toEqual([aHead]);
            expect(mergeCommitCountFor(planRoot, aHead)).toBe(1);
            expect(s.tracks!.find((t) => t.trackId === 'a')!.phase).toBe('MERGED_UNVERIFIED');
        });
    });

    // --- Post-review fix (Finding 2, revisión de Task 11): el mensaje de una
    // excepción capturada de `mergeFrozenTrack`/`abortOwnedMerge` JAMÁS decide
    // nada (la relectura vía `gatherJoinObservation` sigue siendo la única
    // fuente de verdad, R6.8) — pero ahora SÍ queda como `detail` diagnóstico
    // en el evento correspondiente, para que un operador pueda distinguir un
    // conflicto benigno de un repo estructuralmente roto.
    describe('runMergeTrack — el mensaje de una excepción capturada queda como detail diagnóstico, nunca decide (Finding 2)', () => {
        function readEvents(): Array<Record<string, unknown>> {
            let raw = '';
            try { raw = fs.readFileSync(eventsPath(planRoot, BRANCH), 'utf8'); } catch { return []; }
            return raw.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
        }

        function runtimeWithThrowingMerge(errorMessage: string): TrackRuntime {
            const real = defaultTrackRuntime(planRoot, BRANCH);
            return {
                addWorktree: real.addWorktree, initTrackJournal: real.initTrackJournal,
                spawnSupervisor: real.spawnSupervisor, observeSupervisor: real.observeSupervisor,
                teardownOwned: real.teardownOwned, emitFreezeRequest: real.emitFreezeRequest,
                // Deliberadamente NUNCA llama a `real.mergeFrozenTrack`: el repo
                // real queda intacto, así la relectura post-catch ve EXACTAMENTE
                // lo mismo que `before` — la única forma honesta de probar que
                // el mensaje de la excepción no cambia la decisión.
                mergeFrozenTrack() { throw new Error(errorMessage); },
                abortOwnedMerge() { throw new Error(errorMessage); },
                async ensureIntegrationLock() { return 'already-held'; },
            };
        }

        test('retry-merge: fallo simulado ("disco lleno") queda como detail en track-merge-attempted, decisión sigue siendo retry (R6.8)', async () => {
            const aHead = makeTrackHead('a', 'a.txt', 'A content\n');
            const bHead = makeTrackHead('b', 'b.txt', 'B content\n');
            const refA = trackRef('a', { frozenHeadSha: aHead });
            const refB = trackRef('b', { frozenHeadSha: bHead });
            const intentA: JoinIntent = { expectedPlanHeadSha: baseSha, expectedTrackHeadSha: aHead, strategy: 'no-ff' };
            const s0 = declareCohort([{ ...refA, phase: 'JOIN_INTENT', joinIntent: intentA }, refB]);

            const runtime = runtimeWithThrowingMerge('fallo simulado: disco lleno');
            const result = await reconcileTracks(planRoot, BRANCH, s0, runtime, 2);

            // Fail-safe: NUNCA se marca fundido por confiar en la excepción —
            // el repo real nunca se tocó, así que la relectura post-catch
            // sigue viendo "no fundido todavía" y el track queda reintentable.
            expect(result.state.tracks!.find((t) => t.trackId === 'a')!.phase).toBe('JOIN_INTENT');
            expect(mergeCommitCountFor(planRoot, aHead)).toBe(0);

            // Fail-LOUD: el mensaje SÍ quedó como rastro diagnóstico del evento.
            const attempted = readEvents().filter((e) => e.kind === 'track-merge-attempted');
            expect(attempted).toHaveLength(1);
            expect(attempted[0]!.detail).toBe('fallo simulado: disco lleno');
        });

        test('abort-own-merge: fallo simulado queda como detail en track-merge-aborted, decisión sigue siendo abort-own-merge (R6.8)', async () => {
            // Conflicto REAL (misma técnica que 'during-conflict' arriba):
            // necesitamos un MERGE_HEAD real apuntando a nuestro propio
            // `expectedTrackHeadSha` para que `decideJoinReconciliation`
            // devuelva 'abort-own-merge'.
            const aHead = makeTrackHead('a', 'shared.txt', 'A-version\n');
            const bHead = makeTrackHead('b', 'shared.txt', 'B-version\n');
            const refA = trackRef('a', { frozenHeadSha: aHead });
            const refB = trackRef('b', { frozenHeadSha: bHead });
            declareCohort([refA, refB]);

            const realRuntime = defaultTrackRuntime(planRoot, BRANCH);
            let s = readJournal(planRoot, BRANCH).state!;
            for (let i = 0; i < 20; i++) {
                const a = s.tracks!.find((t) => t.trackId === 'a')!;
                const b = s.tracks!.find((t) => t.trackId === 'b')!;
                if (a.phase === 'MERGED_UNVERIFIED' && b.phase === 'JOIN_INTENT' && b.joinIntent !== undefined) break;
                s = (await reconcileTracks(planRoot, BRANCH, s, realRuntime, 2)).state;
            }
            const intentB = s.tracks!.find((t) => t.trackId === 'b')!.joinIntent!;
            expect(() => mergeFrozenTrack(planRoot, intentB)).toThrow();
            expect(readMergeHead(planRoot)).toBe(bHead);

            const runtime = runtimeWithThrowingMerge('fallo simulado: git binario roto');
            const afterAbortAttempt = (await reconcileTracks(planRoot, BRANCH, s, runtime, 2)).state;

            // Fail-safe: el fake NUNCA corrió `git merge --abort` de verdad
            // (el MERGE_HEAD sigue siendo nuestro), así que la relectura
            // post-catch decide 'abort-own-merge' de nuevo — el track sigue
            // en JOIN_INTENT, jamás se asume abortado por la excepción sola.
            expect(readMergeHead(planRoot)).toBe(bHead);
            expect(afterAbortAttempt.tracks!.find((t) => t.trackId === 'b')!.phase).toBe('JOIN_INTENT');

            // Fail-LOUD: el mensaje quedó como detail diagnóstico.
            const aborted = readEvents().filter((e) => e.kind === 'track-merge-aborted');
            expect(aborted).toHaveLength(1);
            expect(aborted[0]!.detail).toBe('fallo simulado: git binario roto');

            // Limpieza real: el índice sigue con el conflicto real dejado por
            // el `mergeFrozenTrack` de arriba — un abort real (fuera del
            // driver, mismo patrón que el resto de este archivo) lo deja
            // limpio para no ensuciar los tests siguientes.
            execFileSync('git', ['merge', '--abort'], { cwd: planRoot, stdio: 'pipe' });
        });
    });
});
