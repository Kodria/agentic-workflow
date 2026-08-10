// R5.2/R5.8/R5.9/R6.3/R6.4/R6.5/C7 (Task 10): quiescencia del plan y
// precondiciones de join. Dos familias de funciones acá:
//   - `validateJoinReadiness`/`planJoinOrder`: PURAS, sin I/O — misma
//     autoridad única que `protocol.ts`, pero para el momento previo al
//     primer merge (Task 11 las consume; acá solo se construyen y prueban).
//   - `acquireIntegrationLock`/`releaseIntegrationLock`/
//     `stopControllerGenerationConfirmed`: efectos reales, modelados 1:1
//     sobre `watch/lock.ts` (`acquireLock`/`releaseLock`/`LockBlockedError`)
//     y sobre el patrón de terminación con identidad confirmada que
//     `supervisor.ts` ya usa en su camino COMPLETE — nunca un kill crudo.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readJournal, writeJournal, appendEvent } from '../journal/store';
import { integrationLockPath } from '../journal/paths';
import { captureSelfRef, refIsAlive, groupIsGone, terminateGroupConfirmed } from '../journal/process';
import { fsyncDirSync } from '../atomic-file';
import { isWellFormedProcessRef } from '../journal/types';
import type { ProcessRef, Generation } from '../journal/types';

// R6.8/R6.9/C7 (Task 11): `decideJoinReconciliation` YA vive en `protocol.ts`
// desde Task 1 (`reconcileProtocol` la llama para su handler de
// `join-observation`) — regla de autoridad única: esta task NO crea una
// segunda copia acá. `join-reconcile.test.ts` prueba la matriz completa
// IMPORTANDO este re-export, así que cualquier fix que la matriz descubra
// tiene que vivir en `protocol.ts` (y volver a correr la exploración de
// Task 1 en el mismo commit) para que el test del gate siga significando algo.
export { decideJoinReconciliation } from './protocol';

// --- Precondiciones puras de join (R6.4/R6.5) -------------------------------

export interface JoinReadiness {
    frozenHeadSha: string;
    actualHeadSha: string;
    dirtyPaths: string[];
    gatePass: boolean;
    liveJobs: number;
    supervisorAlive: boolean;
    lockExists: boolean;
}

export type JoinReadinessResult = { ok: true } | { ok: false; reasons: string[] };

/** Autoridad única de precondiciones de join: TODO hecho indemostrable o
 *  adverso bloquea — nunca se descarta un dirty path del mensaje (R6.5), y
 *  el HEAD congelado se compara byte a byte contra el HEAD real observado
 *  (protege contra el track mutando su propio worktree después de FROZEN). */
export function validateJoinReadiness(x: JoinReadiness): JoinReadinessResult {
    const reasons: string[] = [];
    if (x.actualHeadSha !== x.frozenHeadSha) reasons.push(`HEAD cambió: esperado ${x.frozenHeadSha}, actual ${x.actualHeadSha}`);
    if (x.dirtyPaths.length > 0) reasons.push(`worktree sucio: ${[...x.dirtyPaths].sort().join(', ')}`);
    if (!x.gatePass) reasons.push('gate local rojo');
    if (x.liveJobs > 0) reasons.push(`${x.liveJobs} jobs vivos`);
    if (x.supervisorAlive) reasons.push('supervisor de track vivo');
    if (x.lockExists) reasons.push('lock de track retenido');
    return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// --- Orden de joins vs. paralelismo real observado (R5.7/R5.8/R5.9/C5) -----

export interface OwnershipAssessment { outsideOwnership: string[]; globalClasses: string[]; }

export interface JoinPlan {
    mode: 'parallel-joins' | 'serial-joins';
    order: string[];
    violations: Record<string, string[]>;
    parallelInvalidatedBy: string[];
}

/** Ownership REAL (post-hoc, desde commits ya congelados — ver
 *  `assessActualOwnership` en `ownership.ts`), no la declaración de T4: un
 *  solo track con `outsideOwnership` no vacío serializa el ORDEN de los
 *  joins restantes (R5.8/R5.9) — nunca revierte merges ya hechos. Un
 *  `globalClasses` no vacío además invalida el paralelismo de la cohorte
 *  entera (C5): `parallelInvalidatedBy` nombra `<trackId>:<clase>` para cada
 *  hallazgo, para que el consumidor (T10 Step 6 en `tracks.ts`) lo persista
 *  como `cohortParallelInvalidatedBy` y ningún `awm watch` futuro lo pierda. */
export function planJoinOrder(trackIds: string[], assessments: Record<string, OwnershipAssessment>): JoinPlan {
    const violations: Record<string, string[]> = {};
    const parallelInvalidatedBy: string[] = [];
    let serial = false;
    for (const trackId of trackIds) {
        const a = assessments[trackId];
        if (a === undefined) continue;
        if (a.outsideOwnership.length > 0) {
            violations[trackId] = [...a.outsideOwnership];
            serial = true;
        }
        if (a.globalClasses.length > 0) {
            serial = true;
            for (const cls of a.globalClasses) parallelInvalidatedBy.push(`${trackId}:${cls}`);
        }
    }
    return { mode: serial ? 'serial-joins' : 'parallel-joins', order: [...trackIds], violations, parallelInvalidatedBy };
}

// --- Lock de integración (R5.8/R5.9/C7) -------------------------------------

/** Identidad indemostrable en el lock: BLOQUEAR con error distinto — mismo
 *  criterio que `LockBlockedError` de `watch/lock.ts`, nunca se reclama lo
 *  que no se puede probar muerto. */
export class IntegrationLockBlockedError extends Error {
    constructor(message: string) { super(message); this.name = 'IntegrationLockBlockedError'; }
}

export interface IntegrationLockHandle { ref: ProcessRef; path: string; }
export interface IntegrationLockContext { planJournalId: string; expectedPlanHeadSha: string; }

interface IntegrationLockBody extends ProcessRef, IntegrationLockContext {}

function isWellFormedIntegrationLockBody(x: unknown): x is IntegrationLockBody {
    return isWellFormedProcessRef(x)
        && typeof (x as { planJournalId?: unknown }).planJournalId === 'string'
        && typeof (x as { expectedPlanHeadSha?: unknown }).expectedPlanHeadSha === 'string';
}

/** Modelado 1:1 sobre `acquireLock` (`watch/lock.ts`): creación EXCLUSIVA
 *  real (`wx`), 0600, fsync de archivo + directorio, identidad completa
 *  (`ProcessRef`) más el contexto de integración (`planJournalId` +
 *  `expectedPlanHeadSha`) para que cualquier lector externo pueda auditar
 *  QUÉ mutación se autorizó, no solo QUIÉN la retiene. */
export function acquireIntegrationLock(planRoot: string, ctx: IntegrationLockContext): IntegrationLockHandle {
    const lp = integrationLockPath(planRoot);
    fs.mkdirSync(path.dirname(lp), { recursive: true, mode: 0o700 });
    const self = captureSelfRef(crypto.randomBytes(8).toString('hex'));
    const body: IntegrationLockBody = { ...self, ...ctx };
    const serialized = JSON.stringify(body, null, 2) + '\n';
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(lp, 'wx', 0o600);
            try {
                fs.writeFileSync(fd, serialized);
                fs.fsyncSync(fd);
            } finally { fs.closeSync(fd); }
            fsyncDirSync(path.dirname(lp));
            return { ref: self, path: lp };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        let prior: unknown;
        try {
            prior = JSON.parse(fs.readFileSync(lp, 'utf8'));
        } catch {
            throw new IntegrationLockBlockedError(`integration.lock ilegible en ${lp}: identidad indemostrable — BLOQUEADO (no se reclama)`);
        }
        if (!isWellFormedIntegrationLockBody(prior)) {
            throw new IntegrationLockBlockedError(`integration.lock con shape inválido en ${lp}: identidad indemostrable — BLOQUEADO (no se reclama)`);
        }
        if (refIsAlive(prior)) {
            throw new Error(`integración activa (pid ${prior.pid}) sobre este plan`);
        }
        process.stderr.write('awm watch: integration.lock previo con identidad muerta probada — reclamando\n');
        fs.rmSync(lp, { force: true });
    }
    throw new Error('no se pudo adquirir integration.lock tras reintento único (carrera persistente)');
}

export function releaseIntegrationLock(handle: IntegrationLockHandle): void {
    try {
        const onDisk = JSON.parse(fs.readFileSync(handle.path, 'utf8')) as ProcessRef;
        if (onDisk.spawnNonce === handle.ref.spawnNonce) fs.rmSync(handle.path);
    } catch { /* ya ausente o ilegible: no tocar lo que no es nuestro */ }
}

// --- Pausa de la generación del plan (R5.8/C7) ------------------------------

/** "Ningún controller administrado sigue corriendo durante el lease" (Step 5
 *  del plan R5-T10): a diferencia de `resolveGeneration` (generations.ts,
 *  gobierna reemplazo POR STALL, con backoff/adapter), esto es una pausa
 *  ADMINISTRATIVA incondicional antes de integrar — termina, con identidad
 *  confirmada, cualquier generación del PLAN todavía activa. Sin generación
 *  activa, es un no-op (ya está pausado). Cualquier fallo en confirmar la
 *  terminación lanza — jamás se adquiere el lock de integración con un
 *  controller potencialmente vivo. */
export async function stopControllerGenerationConfirmed(
    planRoot: string, branch: string, grace: { termGraceMs: number; killGraceMs: number },
): Promise<void> {
    const r = readJournal(planRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: no se puede pausar la generación del plan (R1.6)');
    const s = r.state;
    // Misma definición que `activeGeneration` (`watch/generations.ts`),
    // reimplementada inline: `core/tracks` no depende de `commands/watch`
    // (dirección de capas), y esto es una sola línea sin lógica propia que
    // proteger de una duplicación real.
    const gen: Generation | undefined = s.generations.find((g) => g.state === 'active' || g.state === 'controller-suspected-stall');
    if (gen === undefined) return;
    for (const ref of [gen.processRef, gen.wrapperRef]) {
        if (ref === undefined || groupIsGone(ref.processGroup)) continue;
        const confirmed = await terminateGroupConfirmed(ref, grace);
        if (!confirmed) throw new Error(`no se pudo confirmar la terminación de la generación ${gen.n} del plan antes de integrar (C7)`);
    }
    gen.state = 'terminated';
    writeJournal(planRoot, branch, s);
    appendEvent(planRoot, branch, { kind: 'plan-generation-stopped', n: gen.n });
}
