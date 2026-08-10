// Task 13 (R4.2/R4.3/R4.6/R4.10/C2/C9): extraído de `tracks.ts` (post-review
// de Task 13 — el archivo venía creciendo dos ciclos consecutivos de review
// hacia "actively harming reviewability") — mismo criterio que `join.ts` con
// `decideJoinReconciliation`/`acquireIntegrationLock`: la lógica de
// gathering + driver de UN concern vive en su propio módulo, `tracks.ts`
// sigue siendo el ÚNICO lugar con la orquestación (`reconcileTracks`,
// `executeRuntimeEffect`'s dispatch table) y el wiring de producción
// (`defaultTrackRuntime`). Esto es una extracción puramente MECÁNICA: cero
// cambio de comportamiento, `decideTeardown` sigue viviendo exclusivamente en
// `protocol.ts` (autoridad única, sin tocar).
import fs from 'fs';
import { supervisorLockPath } from '../../core/journal/paths';
import { refIsAlive } from '../../core/journal/process';
import { decideTeardown, observeProtocolEffect } from '../../core/tracks/protocol';
import { branchExists } from '../../core/tracks/git';
import { worktreeOwnershipProven } from '../../core/tracks/teardown';
import { appendEvent } from '../../core/journal/store';
import type { CohortProtocol, ProtocolEffect, TeardownObservation } from '../../core/tracks/types';
import type { JournalState, TrackRef } from '../../core/journal/types';
import type { TrackRuntime, EffectRunResult } from './tracks';
import { applyProtocolToState, persist, refOf, withRef } from './tracks';

/** Task 13 (R4.2/R4.3/R4.6/R4.10/C2/C9): gathering READ-ONLY del estado real
 *  de UN track en teardown — jamás cuenta como el side effect del tick
 *  (mismo criterio que `ownedWorktreeExists`/`foreignPathExists` en
 *  `runCreateWorktree`). Solo reúne los campos que la fase ACTUAL necesita
 *  (`decideTeardown` ignora el resto): `ownSupervisorAlive` en
 *  `TEARDOWN_INTENT`, `ownedWorktreeExists`/`foreignWorktree` en
 *  `SUPERVISOR_STOPPED`, `ownedBranchExists` en `WORKTREE_REMOVED`.
 *  `foreignSupervisor` deliberadamente nunca se produce acá: `refIsAlive`
 *  compara identidad completa (pid+startTime+pgid+argsDigest), así que un
 *  PID reciclado por otro proceso ya se reporta como "nuestro está muerto"
 *  (`ownSupervisorAlive: false`), nunca como "ajeno" — el campo existe en
 *  `TeardownObservation`/`decideTeardown` para la matriz pura y como defensa
 *  fail-closed, mismo criterio que `begin-fallback` en `decidePrepare`
 *  (nunca seleccionado por el driver real, pero cubierto por la autoridad
 *  única igual). */
function gatherTeardownObservation(planRoot: string, s: JournalState, ref: TrackRef): TeardownObservation {
    if (ref.phase === 'TEARDOWN_INTENT') {
        // Step 4 del plan: "supervisor propio muerto confirmado Y lock
        // ausente" — un proceso identity-verified muerto que dejó su lock
        // advisory sin liberar (crash a mitad de su propia salida, mismo
        // riesgo que `runFreezeTrack` ya trata con `supervisorAlive ||
        // lockExists`) todavía no prueba que sea seguro tocar el worktree.
        // `ownSupervisorAlive: true` acá simplemente reintenta
        // `stop-own-supervisor` en el próximo tick — inofensivo si el
        // proceso ya está muerto (`groupIsGone` ya es `true`, no-op real),
        // fail-closed si el lock sigue de verdad retenido.
        const processAlive = ref.supervisorProcessRef !== undefined && refIsAlive(ref.supervisorProcessRef);
        // `supervisorLockPath` exige un directorio real (`fs.realpathSync`)
        // — un track abandonado ANTES de que su worktree llegara a existir
        // (ej. `create-worktree` falló para el track siguiente, R4.5) nunca
        // tuvo dónde escribir un lock: ausencia de directorio = ausencia de
        // lock, nunca "indemostrable".
        const lockExists = fs.existsSync(ref.worktreePath) && fs.existsSync(supervisorLockPath(ref.worktreePath));
        return { ownSupervisorAlive: processAlive || lockExists };
    }
    if (ref.phase === 'SUPERVISOR_STOPPED') {
        if (!fs.existsSync(ref.worktreePath)) return { ownedWorktreeExists: false };
        if (worktreeOwnershipProven(planRoot, ref, s.journalId)) return { ownedWorktreeExists: true };
        // Existe, pero no se pudo probar que es nuestro (R4.6/R4.10): jamás
        // se adopta ni se borra a ciegas — bloquea en vez de saltear.
        return { foreignWorktree: true };
    }
    if (ref.phase === 'WORKTREE_REMOVED') {
        return { ownedBranchExists: branchExists(planRoot, ref.branch) };
    }
    return {};
}

/** Task 13 (R4.2/R4.3/R4.6/R4.10/C2/C9): reemplaza el `teardownOwned(ref,
 *  step)` TEMPORAL de Task 9 por el state machine completo de
 *  `decideTeardown` (`protocol.ts`, autoridad única) — a lo sumo UN efecto
 *  real por invocación, siempre persistido a través de `observeProtocolEffect`
 *  (nunca un `withRef` directo con una fase inventada acá, salvo para el
 *  snapshot no-decisional de `teardownIntent`), mismo criterio "gather ->
 *  decide -> tocar el mundo real como mucho una vez -> persistir -> stop"
 *  que `runCreateWorktree`/`runFreezeTrack`/`runMergeTrack`.
 *
 *  Cada llamada a `decideTeardown` ocurre sobre la observación YA reunida
 *  (`observed`, antes de cualquier efecto): las decisiones "ya resuelto"
 *  (`accept-supervisor-stopped`, `mark-removed`, `block-foreign`) no
 *  necesitan tocar `runtime` — la observación existente alcanza para
 *  persistir el avance. Las decisiones "falta trabajo real"
 *  (`stop-own-supervisor`, `remove-owned-worktree`, `remove-owned-branch`)
 *  ejecutan EXACTAMENTE un efecto y vuelven a observar el mundo real después,
 *  persistiendo esa observación fresca — es `reconcileProtocol` quien, sobre
 *  ESA observación, vuelve a llamar `decideTeardown` para fijar la fase
 *  resultante (mismo patrón exacto que `runMergeTrack` con
 *  `decideJoinReconciliation`, T11: nunca se confía en que el efecto en sí
 *  haya funcionado, la relectura es la única fuente de verdad). */
export async function runBeginTeardown(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: Extract<ProtocolEffect, { kind: 'begin-teardown' }>, runtime: TrackRuntime,
): Promise<EffectRunResult> {
    const trackId = effect.trackId;
    const ref = refOf(s, trackId);
    const observed = gatherTeardownObservation(planRoot, s, ref);
    const decision = decideTeardown(protocol.tracks[trackId], observed);

    if (decision === 'persist-intent') {
        // Único paso que además de la fase (`EFFECT_APPLIED_PHASE` ya mapea
        // `begin-teardown` -> `TEARDOWN_INTENT`) captura el snapshot durable
        // que Step 4 exige para probar ownership del worktree más adelante —
        // dato del journal, no del protocolo puro, así que se aplica con
        // `withRef` en la MISMA persistencia (una sola frontera, no dos).
        const applied = observeProtocolEffect(protocol, effect, { kind: 'effect-applied', effect });
        const withIntent = withRef(applyProtocolToState(s, applied), trackId, {
            teardownIntent: { worktreePath: ref.worktreePath, branch: ref.branch, supervisorNonce: ref.supervisorProcessRef?.spawnNonce },
        });
        const next = persist(planRoot, branch, withIntent);
        appendEvent(planRoot, branch, { kind: 'track-teardown-step', trackId, step: 'TEARDOWN_INTENT' });
        return { state: next, stop: true, executed: effect.kind };
    }

    if (decision === 'block-foreign') {
        const blocked = observeProtocolEffect(protocol, effect, { kind: 'teardown-observation', trackId, ...observed });
        const next = persist(planRoot, branch, applyProtocolToState(s, blocked));
        appendEvent(planRoot, branch, {
            kind: 'track-blocked', trackId,
            reason: observed.foreignSupervisor ? 'identidad de supervisor ajena' : 'worktree preexistente ajeno',
        });
        return { state: next, stop: true, executed: null };
    }

    if (decision === 'accept-supervisor-stopped' || decision === 'mark-removed') {
        // Ya resuelto por la observación reunida — ningún touch nuevo de
        // `runtime` este tick (mismo criterio que 'accept-worktree' en
        // `runCreateWorktree`).
        const applied = observeProtocolEffect(protocol, effect, { kind: 'teardown-observation', trackId, ...observed });
        const next = persist(planRoot, branch, applyProtocolToState(s, applied));
        appendEvent(planRoot, branch, { kind: 'track-teardown-step', trackId, step: refOf(next, trackId).phase });
        return { state: next, stop: true, executed: effect.kind };
    }

    if (decision === 'stop-own-supervisor') {
        // R4.8: identity-verified — jamás un `kill(pid)` crudo. `true` <=>
        // grupo confirmado ausente (recién ahora, o ya lo estaba).
        const confirmed = await runtime.stopOwnSupervisor(ref);
        const after: TeardownObservation = { ownSupervisorAlive: !confirmed };
        const applied = observeProtocolEffect(protocol, effect, { kind: 'teardown-observation', trackId, ...after });
        const next = persist(planRoot, branch, applyProtocolToState(s, applied));
        appendEvent(planRoot, branch, { kind: 'track-teardown-step', trackId, step: confirmed ? 'SUPERVISOR_STOPPED' : 'TEARDOWN_INTENT' });
        return { state: next, stop: true, executed: effect.kind };
    }

    if (decision === 'remove-owned-worktree') {
        // Ownership YA probado por `gatherTeardownObservation`
        // (`worktreeOwnershipProven`) para que `decideTeardown` llegara acá —
        // lo único que falta es el efecto real (`git.ts` aplica el guard de
        // limpieza, bloqueando si está sucio, y nunca usa `--force`).
        try {
            runtime.removeOwnedWorktree(planRoot, ref);
        } catch (error) {
            const failed = observeProtocolEffect(protocol, effect, { kind: 'effect-failed', trackId, effect: effect.kind, detail: (error as Error).message });
            const next = persist(planRoot, branch, applyProtocolToState(s, failed));
            appendEvent(planRoot, branch, { kind: 'track-effect-failed', trackId, effect: effect.kind, detail: (error as Error).message });
            return { state: next, stop: true, executed: effect.kind };
        }
        const applied = observeProtocolEffect(protocol, effect, { kind: 'teardown-observation', trackId, ownedWorktreeExists: false });
        const next = persist(planRoot, branch, applyProtocolToState(s, applied));
        appendEvent(planRoot, branch, { kind: 'track-teardown-step', trackId, step: 'WORKTREE_REMOVED' });
        return { state: next, stop: true, executed: effect.kind };
    }

    // decision === 'remove-owned-branch': dos fases de origen posibles
    // (mismo valor de decisión, mismo criterio de dualidad que el resto de
    // esta interfaz — ver el comentario de `decideTeardown`).
    if (ref.phase === 'SUPERVISOR_STOPPED') {
        // Sin worktree propio que remover (nunca existió, o ya se quitó en
        // un intento previo que crasheó antes de persistir esto): avance
        // puramente mecánico a `WORKTREE_REMOVED`, sin tocar `runtime` — el
        // próximo tick, ya en esa fase, decide la branch de nuevo con una
        // observación fresca.
        const applied = observeProtocolEffect(protocol, effect, { kind: 'teardown-observation', trackId, ownedWorktreeExists: false });
        const next = persist(planRoot, branch, applyProtocolToState(s, applied));
        appendEvent(planRoot, branch, { kind: 'track-teardown-step', trackId, step: 'WORKTREE_REMOVED' });
        return { state: next, stop: true, executed: effect.kind };
    }
    // ref.phase === 'WORKTREE_REMOVED': la branch existe de verdad, efecto real.
    try {
        runtime.removeOwnedBranch(planRoot, ref.branch);
    } catch (error) {
        const failed = observeProtocolEffect(protocol, effect, { kind: 'effect-failed', trackId, effect: effect.kind, detail: (error as Error).message });
        const next = persist(planRoot, branch, applyProtocolToState(s, failed));
        appendEvent(planRoot, branch, { kind: 'track-effect-failed', trackId, effect: effect.kind, detail: (error as Error).message });
        return { state: next, stop: true, executed: effect.kind };
    }
    const applied = observeProtocolEffect(protocol, effect, { kind: 'teardown-observation', trackId, ownedBranchExists: false });
    const next = persist(planRoot, branch, applyProtocolToState(s, applied));
    appendEvent(planRoot, branch, { kind: 'track-teardown-step', trackId, step: 'BRANCH_REMOVED' });
    return { state: next, stop: true, executed: effect.kind };
}
