import crypto from 'crypto';
import { JOIN_STRATEGY_NO_FF } from './types';
import type {
    CohortProtocol, JoinDecision, JoinIntent, JoinObservation,
    PrepareDecision, PrepareObservation, ProtocolEffect, ProtocolObservation,
    TeardownDecision, TeardownObservation,
    TrackPhase, TrackProtocolState,
} from './types';

/** Fases en las que un track de una cohorte activa puede estar. */
const WORKING: readonly TrackPhase[] = [
    'ARMED', 'ACTIVE', 'FREEZE_REQUESTED', 'FROZEN',
    'JOIN_REQUESTED', 'JOIN_INTENT', 'MERGED_UNVERIFIED', 'JOINED',
];
/** Fases que ya fijaron un SHA congelado y no pueden volver a mutar el worktree. */
const FROZEN_OR_LATER: readonly TrackPhase[] = ['FROZEN', 'JOIN_INTENT', 'MERGED_UNVERIFIED', 'JOINED'];
/** Efecto aplicado exitosamente → fase resultante del track, para las transiciones puramente mecánicas. */
const EFFECT_APPLIED_PHASE: Partial<Record<ProtocolEffect['kind'], TrackPhase>> = {
    'persist-prepare-intent': 'PREPARE_INTENT', 'create-worktree': 'WORKTREE_CREATED',
    'create-track-journal': 'JOURNAL_CREATED', 'spawn-track-supervisor': 'SUPERVISOR_STARTING',
    'activate-track': 'ACTIVE',
    'freeze-track': 'FREEZE_REQUESTED', 'persist-join-intent': 'JOIN_INTENT',
    'begin-teardown': 'TEARDOWN_INTENT',
};

const token = (journalId: string, trackId: string, purpose: string): string =>
    crypto.createHash('sha256').update(`${journalId}\0${trackId}\0${purpose}`).digest('hex').slice(0, 32);

const required = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) throw new Error(`invariante rota: falta ${name}`);
    return value;
};

/** C2: un fallo demostrable no bloquea, entra al teardown probatorio de C9 —
 *  salvo que ya sea terminal o BLOCKED. T13 (R4.3/C9): marca TODOS los tracks
 *  vivos de la cohorte (no solo el que falló) — `decideTeardown` exige la
 *  fase `TEARDOWN_REQUESTED` literal como único punto de entrada al state
 *  machine de teardown (Step 3 del plan), así que cualquier track que
 *  `nextProtocolEffect` vaya a elegir para `begin-teardown` (uno a la vez,
 *  ver el branch `FALLBACK_PENDING`) debe encontrarse YA en esa fase, sin
 *  importar en qué punto de su propio trabajo estaba cuando la cohorte
 *  entera cayó a fallback. */
const markTeardownRequested = (tracks: CohortProtocol['tracks']): void => {
    for (const t of Object.values(tracks)) {
        if (!['DECLARED', 'REMOVED', 'BLOCKED'].includes(t.phase)) t.phase = 'TEARDOWN_REQUESTED';
    }
};

/** Autoridad única de reconciliación de join; T11 agrega su matriz de tests sobre esta función. */
export function decideJoinReconciliation(intent: JoinIntent, o: JoinObservation): JoinDecision {
    if (o.mergeHead === null && o.planHead === intent.expectedPlanHeadSha && !o.trackIsAncestor) return { action: 'retry-merge' };
    if (o.mergeHead === intent.expectedTrackHeadSha && o.planHead === intent.expectedPlanHeadSha) return { action: 'abort-own-merge' };
    if (o.mergeHead === null && o.trackIsAncestor === true) return { action: 'accept-merge', joinedCommitSha: o.planHead };
    if (o.mergeHead !== null && o.mergeHead !== intent.expectedTrackHeadSha) return { action: 'block', reason: 'MERGE_HEAD ajeno' };
    return { action: 'block', reason: 'estado de join indemostrable' };
}

/**
 * Autoridad única de recuperación de crash de P1 (Task 9, R4.2/R4.6/C11):
 * dado el estado protocolar de UN track en curso durante `PREPARING` y lo
 * que el driver pudo observar del mundo real (fs/git/wrapper, siempre
 * read-only — la gathering nunca cuenta como el side effect del tick, mismo
 * criterio que `foreignPathExists` en `runCreateWorktree`), decide si la
 * próxima llamada mutante a `TrackRuntime` debe intentarse de nuevo, si el
 * resultado de un intento previo ya está ahí (crash entre el efecto real y
 * su persistencia), si hay que bloquear por ajeno, o si la fase es
 * indemostrable y hay que abortar a fallback.
 *
 * NO se llama desde `nextProtocolEffect`: esa función solo decide QUÉ efecto
 * sigue mirando la fase (eso no cambia con Task 9 — `create-worktree` /
 * `create-track-journal` / `spawn-track-supervisor` son inambiguos por
 * fase). `decidePrepare` decide, para ESE MISMO efecto ya elegido, si
 * `tracks.ts` debe tocar `TrackRuntime` de verdad o si una observación ya
 * resuelve el resultado — enhebrarla en `nextProtocolEffect` (devolviendo
 * `null` para 'accept-worktree'/'block-foreign'/'begin-fallback') obligaría
 * a `tracks.ts` a volver a invocar esta misma función para saber QUÉ hacer
 * con ese `null`, sin ganar nada: el punto de entrada más simple, y el único
 * que no sobrecarga el significado de "sin más trabajo" de `null`, es que el
 * driver la llame directamente con la observación ya recolectada — exactamente
 * el mismo patrón que ya usa con `observeProtocolEffect`/`reconcileProtocol`
 * para las observaciones POST-efecto. Sigue siendo la única autoridad de
 * decisión: `tracks.ts` únicamente traduce su resultado.
 */
export function decidePrepare(t: TrackProtocolState, observed: PrepareObservation): PrepareDecision {
    if (t.phase === 'PREPARE_INTENT') {
        if (observed.worktreeOwned === true) return 'accept-worktree';
        if (observed.worktreeForeignNonEmpty === true) return 'block-foreign';
        return 'retry-worktree';
    }
    if (t.phase === 'WORKTREE_CREATED') return 'write-descriptor';
    if (t.phase === 'SUPERVISOR_STARTING') {
        if (observed.supervisorArtifact === undefined || observed.supervisorArtifact === 'absent') {
            return 'retry-supervisor-same-intent';
        }
        if (observed.supervisorArtifact === 'foreign') return 'block-foreign';
        // 'claimed'/'ready': ya hay evidencia real en disco de un intento
        // previo (el mismo `supervisorIntent`, posiblemente de una instancia
        // que crasheó DESPUÉS de spawnear pero ANTES de persistir
        // `supervisorProcessRef`) — jamás re-spawnear (C11); delegar al
        // mismo camino de observación que ya usa el post-spawn normal (C8
        // decide el nonce ahí, no acá).
        return 'accept-readiness';
    }
    // Fase inesperada para un efecto de PREPARING (fail-closed, R4.6): nunca
    // alcanzable desde `reconcileTracks` (que solo llama `decidePrepare` para
    // las tres fases de arriba), pero si algún día lo fuera, abortar a
    // fallback es la única opción segura.
    return 'begin-fallback';
}

/**
 * Autoridad única de teardown (Task 13, R4.2/R4.3/R4.6/R4.10/C2/C9): dado el
 * estado protocolar de UN track y lo que el driver (`tracks.ts`/`teardown.ts`)
 * pudo probar del mundo real (fs/git/proceso, siempre READ-ONLY — gathering
 * nunca cuenta como el side effect del tick, mismo criterio que
 * `decidePrepare`), decide el próximo paso durable. Ajeno gana SIEMPRE
 * primero, sin importar la fase: nunca se avanza un teardown sobre una
 * identidad de supervisor o un worktree cuyo ownership es indemostrable
 * (R4.6/R4.10) — ni siquiera si esa fase normalmente ya habría progresado.
 *
 * `teardown.ts` reexporta esta función (mismo patrón que `join.ts` con
 * `decideJoinReconciliation`) y solo aporta los efectos reales; `tracks.ts`
 * (`runBeginTeardown`) la llama dos veces por transición real, igual que
 * `runMergeTrack` llama `decideJoinReconciliation`: una vez ANTES de tocar
 * `runtime` (para decidir CUÁL efecto —o ausencia de efecto— corresponde), y
 * la fase final siempre se persiste a través de `reconcileProtocol`
 * (`teardown-observation`), que vuelve a llamar a esta misma función sobre la
 * observación fresca — nunca confía en el resultado de la llamada a
 * `runtime` por sí solo.
 *
 * `BLOCKED` cae deliberadamente en el `throw` final: ninguna fase de entrada
 * a esta función es alcanzable en `BLOCKED` (`nextProtocolEffect` ya filtra
 * cualquier cohorte con un track `BLOCKED` ANTES de emitir `begin-teardown`
 * para nadie, ver el branch `FALLBACK_PENDING`) — un track bloqueado nunca
 * entra a teardown automático. La propiedad que lo bloqueó es indemostrable
 * justamente ahí, y "arreglarlo" solo/a ciegas sería el error que C9 existe
 * para evitar. Sale de `BLOCKED` únicamente con evidencia del operador, que
 * lo devuelve a `TEARDOWN_REQUESTED` explícitamente — jamás automático.
 */
export function decideTeardown(ref: TrackProtocolState, o: TeardownObservation): TeardownDecision {
    if (o.foreignSupervisor || o.foreignWorktree) return 'block-foreign';
    if (ref.phase === 'TEARDOWN_REQUESTED') return 'persist-intent';
    if (ref.phase === 'TEARDOWN_INTENT') return o.ownSupervisorAlive ? 'stop-own-supervisor' : 'accept-supervisor-stopped';
    if (ref.phase === 'SUPERVISOR_STOPPED') return o.ownedWorktreeExists ? 'remove-owned-worktree' : 'remove-owned-branch';
    if (ref.phase === 'WORKTREE_REMOVED') return o.ownedBranchExists ? 'remove-owned-branch' : 'mark-removed';
    if (ref.phase === 'BRANCH_REMOVED') return 'mark-removed';
    throw new Error(`teardown no válido desde ${ref.phase}`);
}

export function initialCohort(planJournalId: string, trackIds: string[], maxParallel = trackIds.length): CohortProtocol {
    if (planJournalId.length === 0 || trackIds.length < 2 || new Set(trackIds).size !== trackIds.length
        || !Number.isInteger(maxParallel) || maxParallel < 1) {
        throw new Error('initialCohort requiere journalId y al menos dos trackIds únicos');
    }
    return {
        planJournalId, cohortPhase: 'PREPARING', maxParallel,
        tracks: Object.fromEntries(trackIds.map((trackId) => [trackId, {
            trackId, phase: 'DECLARED',
            fencingToken: token(planJournalId, trackId, 'fence'),
            readinessNonce: token(planJournalId, trackId, 'readiness'),
        }])),
    };
}

export function assertProtocolInvariants(s: CohortProtocol): void {
    const tracks = Object.values(s.tracks);
    if (tracks.length < 2) throw new Error('cohorte paralela requiere al menos dos tracks');
    if ((s.cohortPhase === 'ACTIVE' || s.cohortPhase === 'JOINING') && tracks.some((t) => !WORKING.includes(t.phase))) {
        throw new Error('ACTIVE prohíbe tracks sin armar');
    }
    if (tracks.filter((t) => t.phase === 'ACTIVE').length > s.maxParallel) throw new Error('tracks ACTIVE exceden maxParallel');
    if (tracks.filter((t) => t.phase === 'JOIN_INTENT').length > 1) {
        throw new Error('un solo JOIN_INTENT vivo por cohorte'); // C7: los merges son serie estricta
    }
    if (tracks.some((t) => FROZEN_OR_LATER.includes(t.phase) && t.frozenHeadSha === undefined)) {
        throw new Error('un track congelado exige frozenHeadSha');
    }
    // C2: SERIAL solo con la cohorte demostrablemente desmantelada. BLOCKED nunca cuenta como limpio.
    if (s.cohortPhase === 'SERIAL' && tracks.some((t) => !['REMOVED', 'DECLARED'].includes(t.phase))) {
        throw new Error('SERIAL prohíbe recursos paralelos activos');
    }
    if (s.finalIntegrationJobId !== undefined && tracks.some((t) => !['MERGED_UNVERIFIED', 'JOINED'].includes(t.phase))) {
        throw new Error('integración final exige todos los tracks mergeados');
    }
    if (s.cohortPhase === 'COMPLETE' && tracks.some((t) => t.phase !== 'JOINED')) {
        throw new Error('COMPLETE exige todos los tracks JOINED');
    }
}

export function nextProtocolEffect(s: CohortProtocol): ProtocolEffect | null {
    assertProtocolInvariants(s);
    const tracks = Object.values(s.tracks).sort((a, b) => a.trackId.localeCompare(b.trackId));
    if (s.cohortPhase === 'BLOCKED' || s.cohortPhase === 'SERIAL' || s.cohortPhase === 'COMPLETE') return null;
    if (s.cohortPhase === 'FALLBACK_PENDING') {
        // C2: propiedad indemostrable detiene la cohorte; nunca se serializa con recursos posiblemente vivos.
        if (tracks.some((t) => t.phase === 'BLOCKED')) return null;
        const owned = tracks.find((t) => !['DECLARED', 'REMOVED'].includes(t.phase));
        return owned !== undefined
            ? { kind: 'begin-teardown', trackId: owned.trackId }
            : { kind: 'enter-serial', reason: s.fallbackReason ?? 'prepare-failed' };
    }
    if (s.cohortPhase === 'PREPARING') {
        const t = tracks.find((x) => x.phase !== 'ARMED' && x.phase !== 'BLOCKED');
        if (t === undefined) return tracks.every((x) => x.phase === 'ARMED') ? { kind: 'activate-cohort' } : null;
        if (t.phase === 'DECLARED') return { kind: 'persist-prepare-intent', trackId: t.trackId };
        if (t.phase === 'PREPARE_INTENT') return { kind: 'create-worktree', trackId: t.trackId };
        if (t.phase === 'WORKTREE_CREATED') return { kind: 'create-track-journal', trackId: t.trackId };
        if (t.phase === 'JOURNAL_CREATED' || t.phase === 'SUPERVISOR_STARTING') {
            return { kind: 'spawn-track-supervisor', trackId: t.trackId, readinessNonce: t.readinessNonce };
        }
    }
    if (s.cohortPhase === 'ACTIVE' || s.cohortPhase === 'JOINING') {
        if (s.cohortPhase === 'ACTIVE') {
            const active = tracks.filter((t) => t.phase === 'ACTIVE').length;
            const waiting = tracks.find((t) => t.phase === 'ARMED');
            if (waiting !== undefined && active < s.maxParallel) return { kind: 'activate-track', trackId: waiting.trackId };
        }
        const requested = tracks.find((t) => t.phase === 'JOIN_REQUESTED');
        if (requested !== undefined) return { kind: 'freeze-track', trackId: requested.trackId };
        // C3: ningún merge empieza hasta que la cohorte entera esté congelada.
        if (tracks.every((t) => FROZEN_OR_LATER.includes(t.phase))) {
            const open = tracks.find((t) => t.phase === 'JOIN_INTENT');
            if (open !== undefined) {
                return {
                    kind: 'merge-track', trackId: open.trackId,
                    expectedPlanHeadSha: required(open.expectedPlanHeadSha, 'expectedPlanHeadSha'),
                    expectedTrackHeadSha: required(open.expectedTrackHeadSha, 'expectedTrackHeadSha'),
                };
            }
            const next = tracks.find((t) => t.phase === 'FROZEN');
            if (next !== undefined) {
                return {
                    kind: 'persist-join-intent', trackId: next.trackId,
                    expectedPlanHeadSha: required(s.planHeadSha, 'planHeadSha'),
                    expectedTrackHeadSha: required(next.frozenHeadSha, 'frozenHeadSha'),
                };
            }
        }
    }
    if (tracks.every((t) => t.phase === 'MERGED_UNVERIFIED') && s.globalQaHeadSha === undefined) return { kind: 'request-global-qa' };
    if (s.globalQaHeadSha !== undefined && s.finalIntegrationJobId === undefined) return { kind: 'request-final-integration' };
    if (s.finalIntegrationJobId !== undefined && s.cohortPhase === 'FINAL_INTERLOCK') return { kind: 'run-final-interlock' };
    return null;
}

export function reconcileProtocol(s: CohortProtocol, observation: ProtocolObservation): CohortProtocol {
    const out = structuredClone(s);
    if (observation.kind === 'teardown-requested') {
        const requested = out.tracks[observation.trackId];
        if (requested === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        if (out.cohortPhase !== 'BLOCKED' && out.cohortPhase !== 'SERIAL' && out.cohortPhase !== 'COMPLETE'
            && out.cohortPhase !== 'FALLBACK_PENDING') {
            out.cohortPhase = 'FALLBACK_PENDING';
            out.fallbackReason = `controller-requested:${observation.trackId}`;
            // La evidencia de QA/integración describe la ruta de finalización
            // que acabamos de abandonar. Debe desaparecer ANTES de mover los
            // tracks a teardown: de otro modo el invariante de integración
            // final ve evidence viva junto a tracks no mergeados y rechaza la
            // transición segura hacia fallback.
            out.globalQaHeadSha = undefined;
            out.finalIntegrationJobId = undefined;
            markTeardownRequested(out.tracks);
        }
    } else if (observation.kind === 'prepare-failed') {
        out.cohortPhase = 'FALLBACK_PENDING';
        out.fallbackReason = `prepare-failed:${observation.trackId}`;
        markTeardownRequested(out.tracks);
    } else if (observation.kind === 'effect-failed') {
        if (out.cohortPhase === 'PREPARING') {
            out.cohortPhase = 'FALLBACK_PENDING';
            // Nombra el TRACK además del efecto: "cuál falló" es la primera pregunta
            // frente a una cohorte degradada, y sin el trackId el motivo obliga a
            // correlacionar hacia atrás con el evento `track-effect-failed`. El sufijo se
            // omite (no se rellena con un placeholder) cuando la observación genuinamente
            // no tiene track — un `undefined` impreso sería peor que no decir nada.
            out.fallbackReason = observation.trackId === undefined
                ? `effect-failed:${observation.effect}`
                : `effect-failed:${observation.effect}:${observation.trackId}`;
            markTeardownRequested(out.tracks);
        } else if (observation.effect === 'begin-teardown' && observation.trackId !== undefined) {
            // T13 (C9): un paso de teardown que no pudo probarse seguro
            // (worktree sucio, branch todavía checked-out, ownership
            // indemostrable) bloquea ESE track — nunca se fuerza `--force`/
            // `-D` para "resolver" el fallo (R4.10). Mismo dead-end que
            // `decideTeardown` documenta para BLOCKED: solo el operador lo
            // saca de acá.
            const t = out.tracks[observation.trackId];
            if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
            t.phase = 'BLOCKED';
            t.blockedReason = observation.detail;
            out.cohortPhase = 'BLOCKED';
        }
        // effect-failed fuera de PREPARING/begin-teardown: sin transición definida todavía (no ejercitado por T1).
    } else if (observation.kind === 'worktree-observed') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        // R4.6: un worktree que no es demostrablemente nuestro nunca se adopta ni se borra.
        if (observation.owned) t.phase = 'WORKTREE_CREATED';
        else {
            t.phase = 'BLOCKED';
            t.blockedReason = 'worktree preexistente ajeno';
        }
    } else if (observation.kind === 'supervisor-observed') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        if (observation.identity === 'other') {
            t.phase = 'BLOCKED';
            t.blockedReason = 'identidad de supervisor ajena';
        } else if (observation.identity === 'expected') {
            // C8: el readiness solo se acredita con el nonce que emitió el supervisor del plan.
            if (observation.readinessNonce === t.readinessNonce) t.phase = 'ARMED';
            else {
                t.phase = 'BLOCKED';
                t.blockedReason = 'readinessNonce no coincide';
            }
        }
        // 'absent' no mueve fase: el mismo supervisorIntent se reintenta (C11).
    } else if (observation.kind === 'join-requested') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        if (t.phase === 'ACTIVE') t.phase = 'JOIN_REQUESTED';
    } else if (observation.kind === 'teardown-observation') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        // Autoridad única: la misma función que T13 prueba con su matriz
        // pura completa (mismo criterio que `join-observation` arriba con
        // `decideJoinReconciliation`) — nunca se reimplementa el mapeo acá.
        const decision = decideTeardown(t, observation);
        if (decision === 'block-foreign') {
            t.phase = 'BLOCKED';
            t.blockedReason = observation.foreignSupervisor ? 'identidad de supervisor ajena' : 'worktree preexistente ajeno';
            out.cohortPhase = 'BLOCKED';
        } else if (decision === 'accept-supervisor-stopped') {
            t.phase = 'SUPERVISOR_STOPPED';
        } else if (decision === 'remove-owned-branch' && t.phase === 'SUPERVISOR_STOPPED') {
            // Sin worktree propio que remover (nunca existió, o ya se quitó
            // en un intento previo que crasheó antes de persistir esto):
            // mecánicamente ya se alcanzó WORKTREE_REMOVED, nada más que probar.
            t.phase = 'WORKTREE_REMOVED';
        } else if (decision === 'mark-removed' && t.phase === 'WORKTREE_REMOVED') {
            // Sin branch propia que remover: mecánicamente ya se alcanzó BRANCH_REMOVED.
            t.phase = 'BRANCH_REMOVED';
        } else if (decision === 'mark-removed' && t.phase === 'BRANCH_REMOVED') {
            t.phase = 'REMOVED';
        }
        // 'persist-intent' / 'stop-own-supervisor' / 'remove-owned-worktree'
        // / 'remove-owned-branch' (todavía desde WORKTREE_REMOVED, con la
        // branch real por remover): el driver TODAVÍA no completó el efecto
        // real — nada que avanzar en ESTA observación; el próximo
        // re-observe (tras el efecto) sí lo hace.
    } else if (observation.kind === 'freeze-observation') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        t.frozenHeadSha = observation.frozenHeadSha;
        t.phase = 'FROZEN';
        out.cohortPhase = 'JOINING';
    } else if (observation.kind === 'join-observation') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        // Autoridad única: la misma función que T11 prueba con su matriz completa.
        const decision = decideJoinReconciliation({
            expectedPlanHeadSha: required(t.expectedPlanHeadSha, 'expectedPlanHeadSha'),
            expectedTrackHeadSha: required(t.expectedTrackHeadSha, 'expectedTrackHeadSha'),
            strategy: JOIN_STRATEGY_NO_FF,
        }, observation);
        if (decision.action === 'accept-merge') {
            t.phase = 'MERGED_UNVERIFIED';
            t.joinedCommitSha = decision.joinedCommitSha;
            out.planHeadSha = decision.joinedCommitSha;
        } else if (decision.action === 'block') {
            t.phase = 'BLOCKED';
            t.blockedReason = decision.reason;
            out.cohortPhase = 'BLOCKED';
        }
        // 'retry-merge' y 'abort-own-merge' no mueven fase: el próximo tick reintenta el mismo intent.
    } else if (observation.kind === 'global-qa-pass') {
        if (!observation.clean) throw new Error('QA global no puede cerrar con worktree sucio');
        out.globalQaHeadSha = observation.headSha;
        out.cohortPhase = 'FINAL_INTEGRATION';
    } else if (observation.kind === 'integration-pass') {
        if (out.globalQaHeadSha !== observation.headSha) throw new Error('integración no corresponde al HEAD de QA');
        out.finalIntegrationJobId = observation.jobId;
        out.cohortPhase = 'FINAL_INTERLOCK';
    } else if (observation.kind === 'interlock-pass') {
        if (out.globalQaHeadSha !== observation.headSha) throw new Error('interlock stale');
        for (const t of Object.values(out.tracks)) t.phase = 'JOINED';
        out.cohortPhase = 'COMPLETE';
    } else if (observation.kind !== 'effect-applied') {
        const unhandled: never = observation; // el compilador exige una rama por variante
        throw new Error(`observación no manejada: ${JSON.stringify(unhandled)}`);
    }
    assertProtocolInvariants(out);
    return out;
}

export function observeProtocolEffect(s: CohortProtocol, effect: ProtocolEffect, observation: ProtocolObservation): CohortProtocol {
    if (observation.kind === 'effect-failed' || observation.kind === 'prepare-failed' || observation.kind === 'join-observation'
        || observation.kind === 'freeze-observation' || observation.kind === 'join-requested' || observation.kind === 'teardown-requested'
        || observation.kind === 'supervisor-observed' || observation.kind === 'worktree-observed'
        || observation.kind === 'teardown-observation'
        || observation.kind === 'global-qa-pass'
        || observation.kind === 'integration-pass' || observation.kind === 'interlock-pass') {
        // reconcileProtocol clona internamente: pasar `s` sin clonar acá evita un structuredClone redundante.
        return reconcileProtocol(s, observation);
    }
    const out = structuredClone(s);
    if (observation.kind !== 'effect-applied') return out;
    const e = effect;
    if ('trackId' in e) {
        const t = out.tracks[e.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${e.trackId}`);
        const phase = EFFECT_APPLIED_PHASE[e.kind];
        if (phase !== undefined) t.phase = phase;
        if (e.kind === 'persist-join-intent') {
            t.expectedPlanHeadSha = e.expectedPlanHeadSha;
            t.expectedTrackHeadSha = e.expectedTrackHeadSha;
        }
    }
    if (e.kind === 'activate-cohort') {
        out.cohortPhase = 'ACTIVE';
    }
    if (e.kind === 'enter-serial') out.cohortPhase = 'SERIAL';
    assertProtocolInvariants(out);
    return out;
}
