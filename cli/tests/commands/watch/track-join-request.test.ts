// El camino `awm track join` -> fase `JOIN_REQUESTED`, que NO EXISTÍA.
//
// `applyRequestToState` era una cadena de `if (env.kind === …) { …; return; }` sin rama para
// `track-join-request`: se caía por el final sin lanzar, el caller no veía excepción, hacía
// `applied++` y BORRABA el archivo. El comando salía 0 con su requestId, el journal contaba
// la request como aplicada, y el track se quedaba en `ACTIVE` para siempre — como C3 exige la
// cohorte entera congelada antes de mergear, jamás llegaba a `MERGED_UNVERIFIED` ni a
// `COMPLETE`. Confirmación cruzada en su momento: `join-requested` era la ÚNICA observación
// del protocolo con cero productores en todo `src/`.
//
// Estos tests cubren las tres propiedades del camino reparado:
//   1. un join sobre un track `ACTIVE` mueve la fase (vía el reducer, no acá);
//   2. un join que llega ANTES de la activación ESPERA en vez de perderse;
//   3. un join que ya no puede aplicarse nunca se limpia, sin girar en cada tick.
//
// (2) es un bug encontrado en la certificación con supervisor vivo, sobre la PRIMERA versión
// de este fix: con `maxParallel` chico la cohorte activa de a un track por vez, así que el
// controller termina su trabajo y pide el join mientras su track sigue en `ARMED`. Descartar
// el pedido ahí reintroduce exactamente el modo de falla que este cambio vino a cerrar — un
// pedido que reporta éxito y no hace nada — y solo pasaba desapercibido porque el controller
// scripteado re-emite el join en cada vuelta.
import fs from 'fs';
import path from 'path';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { reconcileTracks, defaultTrackRuntime, TrackRuntime, SupervisorObservation } from '../../../src/commands/watch/tracks';
import { consumePendingRequests } from '../../../src/commands/watch/apply';
import { emitTrackRequest } from '../../../src/commands/track/emit';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { eventsPath } from '../../../src/core/journal/paths';
import type { JournalState, TrackRef } from '../../../src/core/journal/types';
import type { TrackPhase } from '../../../src/core/tracks/types';

const BRANCH = 'main';

describe('awm track join -> JOIN_REQUESTED (R6.1)', () => {
    let planRoot: string;
    let baseSha: string;

    beforeEach(() => {
        planRoot = initRepo();
        commitFile(planRoot, '.gitignore', '.awm/\n');
        baseSha = commitFile(planRoot, 'seed.txt', 'seed');
        initJournal(planRoot, BRANCH);
    });
    afterEach(() => { fs.rmSync(planRoot, { recursive: true, force: true }); });

    function declareCohort(phaseA: TrackPhase, phaseB: TrackPhase = 'ACTIVE'): JournalState {
        const s = readJournal(planRoot, BRANCH).state!;
        s.cohortPhase = 'ACTIVE';
        s.cohortBaseSha = baseSha;
        // `assertProtocolInvariants` exige `frozenHeadSha` en todo track congelado o
        // posterior: la fixture lo provee en vez de bajarle el estándar al invariante.
        const frozen: TrackPhase[] = ['FROZEN', 'JOIN_INTENT', 'MERGED_UNVERIFIED', 'JOINED'];
        s.tracks = [
            {
                trackId: 'a', worktreePath: path.join(planRoot, '../nope-a'), branch: 'awm-track/a',
                ownership: [], sharedResources: [], dependsOn: [],
                fencingToken: 'fence-a'.padEnd(32, '0'), phase: phaseA, readinessNonce: 'ready-a'.padEnd(32, '0'),
                frozenHeadSha: frozen.includes(phaseA) ? baseSha : undefined,
            },
            {
                trackId: 'b', worktreePath: path.join(planRoot, '../nope-b'), branch: 'awm-track/b',
                ownership: [], sharedResources: [], dependsOn: [],
                fencingToken: 'fence-b'.padEnd(32, '0'), phase: phaseB, readinessNonce: 'ready-b'.padEnd(32, '0'),
            },
        ] satisfies TrackRef[];
        writeJournal(planRoot, BRANCH, s);
        return readJournal(planRoot, BRANCH).state!;
    }

    /** Runtime que explota ante cualquier efecto real: estos tests miden SOLO la producción
     *  de la observación de join, nunca un freeze/merge de verdad. */
    function inertRuntime(): TrackRuntime {
        const real = defaultTrackRuntime(planRoot, BRANCH);
        return {
            ...real,
            addWorktree: () => { throw new Error('no debería llamarse'); },
            initTrackJournal: () => { throw new Error('no debería llamarse'); },
            spawnSupervisor: () => { throw new Error('no debería llamarse'); },
            observeSupervisor: (): SupervisorObservation => ({ kind: 'absent' }),
        };
    }

    function events(): Array<Record<string, unknown>> {
        let raw = '';
        try { raw = fs.readFileSync(eventsPath(planRoot, BRANCH), 'utf8'); } catch { return []; }
        return raw.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    }

    function phaseOf(s: JournalState, trackId: string): TrackPhase | undefined {
        return s.tracks?.find((t) => t.trackId === trackId)?.phase;
    }

    function joinFlagOf(s: JournalState, trackId: string): boolean | undefined {
        return s.tracks?.find((t) => t.trackId === trackId)?.joinRequested;
    }

    it('el join de un track ACTIVE llega hasta la fase, pasando por la request real del CLI', async () => {
        declareCohort('ACTIVE');
        // La request se emite con el MISMO emisor que usa `awm track join`, no a mano: lo que
        // estaba roto era justamente el tramo entre ese emisor y el estado.
        emitTrackRequest(planRoot, BRANCH, 'g1', 'track-join-request', 'a');
        expect(consumePendingRequests(planRoot, BRANCH, 'g1').applied).toBe(1);

        const s1 = readJournal(planRoot, BRANCH).state!;
        expect(joinFlagOf(s1, 'a')).toBe(true);
        expect(phaseOf(s1, 'a')).toBe('ACTIVE');   // el consumo transaccional NO mueve fases

        const out = await reconcileTracks(planRoot, BRANCH, s1, inertRuntime(), 2);
        expect(phaseOf(out.state, 'a')).toBe('JOIN_REQUESTED');
        expect(joinFlagOf(out.state, 'a')).toBeUndefined();
        expect(events().some((e) => e.kind === 'track-join-observed' && e.trackId === 'a')).toBe(true);
    });

    it('un join que llega ANTES de la activación espera, y se aplica cuando el track activa', async () => {
        // Carrera real de la certificación: `maxParallel` 1 activa de a un track, así que el
        // controller pide el join de `a` mientras `a` sigue en ARMED.
        declareCohort('ARMED', 'ACTIVE');
        emitTrackRequest(planRoot, BRANCH, 'g1', 'track-join-request', 'a');
        consumePendingRequests(planRoot, BRANCH, 'g1');

        let s = readJournal(planRoot, BRANCH).state!;
        s = (await reconcileTracks(planRoot, BRANCH, s, inertRuntime(), 1)).state;
        // Sigue pendiente: no se descartó por haber llegado temprano.
        expect(joinFlagOf(s, 'a')).toBe(true);
        expect(phaseOf(s, 'a')).toBe('ARMED');

        // El track activa (lo hace el protocolo cuando hay cupo) y recién ahí el join aplica.
        const activated = readJournal(planRoot, BRANCH).state!;
        for (const t of activated.tracks ?? []) if (t.trackId === 'a') t.phase = 'ACTIVE';
        writeJournal(planRoot, BRANCH, activated);

        const out = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);
        expect(phaseOf(out.state, 'a')).toBe('JOIN_REQUESTED');
        expect(joinFlagOf(out.state, 'a')).toBeUndefined();
    });

    it('un join que ya no puede aplicarse nunca se limpia y no gira en cada tick', async () => {
        // `a` ya está mergeado: un join re-emitido por un controller relevado es moot.
        declareCohort('MERGED_UNVERIFIED', 'ACTIVE');
        emitTrackRequest(planRoot, BRANCH, 'g1', 'track-join-request', 'a');
        consumePendingRequests(planRoot, BRANCH, 'g1');

        const out = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);
        expect(joinFlagOf(out.state, 'a')).toBeUndefined();
        expect(phaseOf(out.state, 'a')).toBe('MERGED_UNVERIFIED');
        expect(events().filter((e) => e.kind === 'track-join-moot')).toHaveLength(1);

        // Un segundo pase no vuelve a emitir nada: la marca ya no está.
        await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);
        expect(events().filter((e) => e.kind === 'track-join-moot')).toHaveLength(1);
    });
});
