// Consumo transaccional de requests (bloqueador 4): mutar estado ->
// writeJournal -> RECIEN AHI borrar archivos. El replay es seguro por
// requestId + idempotencyKey + digest.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { listPendingRequests, applyOutcome, digestOf, RequestEnvelope } from '../../core/journal/requests';
import { requestsDir } from '../../core/journal/paths';
import { fsyncDirSync } from '../../core/atomic-file';
import { redactText } from '../../core/journal/redact';
import { gitCheckTrackId, headSha } from '../../core/tracks/git';
import type { Job, JournalState, ReviewObligation, TrackRef, VerificationItem } from '../../core/journal/types';

export interface ApplySummary { applied: number; rejectedStale: number; rejectedDigest: number; rejectedInvalid: number; corrupt: number; }

function now(): string { return new Date().toISOString(); }

const VERIFICATION_KINDS = ['test', 'lint', 'sensors', 'review', 'qa', 'interlock', 'track-integration'] as const;

function verificationItems(value: unknown, field: string): VerificationItem[] {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'object' && item !== null
        && typeof (item as { id?: unknown }).id === 'string'
        && VERIFICATION_KINDS.includes((item as { kind?: typeof VERIFICATION_KINDS[number] }).kind as typeof VERIFICATION_KINDS[number])
        && ((item as { satisfiedBy?: unknown }).satisfiedBy === undefined || typeof (item as { satisfiedBy?: unknown }).satisfiedBy === 'string'))) {
        throw new Error(`${field} requiere items de verificacion validos`);
    }
    return value as VerificationItem[];
}

function reviewObligations(value: unknown, taskId: string): ReviewObligation[] {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'object' && item !== null
        && typeof (item as { id?: unknown }).id === 'string'
        && ((item as { kind?: unknown }).kind === 'spec' || (item as { kind?: unknown }).kind === 'quality'))) {
        throw new Error('reviewObligations requiere obligaciones spec|quality validas');
    }
    return (value as Array<{ id: string; kind: 'spec' | 'quality' }>).map((item) => ({ ...item, taskId }));
}

function stringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`${field} requiere array de strings`);
    return value;
}

/** R7 Task 12: `job-request.satisfies` migró de string a array (un mismo job
 *  puede satisfacer VARIOS items del ciclo a la vez — ej. el job canónico de
 *  integración final satisface todos los `track-integration:*` juntos).
 *  Acepta AMBAS formas en el payload (string legacy o array) — el emisor
 *  actual (`requestJob`) siempre manda array, pero una request en vuelo
 *  emitida por un binario anterior al deploy de este cambio no debe
 *  rechazarse por forma. */
function satisfiesArray(value: unknown, field: string): string[] {
    if (value === undefined) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
    throw new Error(`${field} requiere string o array de strings`);
}

function linkSatisfies(s: JournalState, itemId: string, jobId: string): void {
    const items: VerificationItem[] = [...s.tasks.flatMap((t) => t.verificationPlan), ...s.cycleVerificationPlan];
    const item = items.find((i) => i.id === itemId);
    if (item === undefined) throw new Error(`VerificationItem desconocido: ${itemId}`);
    item.satisfiedBy = jobId;
}

/** R7.2 (Task 12): append transaccional — agrega items NUEVOS por id sin
 *  jamás pisar un item ya existente (preserva `satisfiedBy` ya enlazado). Una
 *  colisión de `kind` para el mismo id rechaza el request COMPLETO (se llama
 *  siempre sobre el clone transaccional de `consumePendingRequests`, así que
 *  un throw acá descarta la mutación entera vía el catch de ese loop). */
export function applyCyclePlanAppend(state: JournalState, incoming: VerificationItem[]): void {
    const byId = new Map(state.cycleVerificationPlan.map((item) => [item.id, item]));
    for (const item of incoming) {
        const prior = byId.get(item.id);
        if (prior !== undefined && prior.kind !== item.kind) throw new Error(`verification item ${item.id} cambia kind`);
        if (prior === undefined) byId.set(item.id, { ...item });
    }
    state.cycleVerificationPlan = [...byId.values()];
}

/** R7.3 (Task 12): declarar un track dentro de la cohorte agrega DE INMEDIATO
 *  su `track-integration:<trackId>` al CycleVerificationPlan, sin
 *  `satisfiedBy` — el gate global queda rojo desde el momento en que la
 *  cohorte se conoce, nunca solo al final. Idempotente por construcción
 *  (`applyCyclePlanAppend`): llamarla de nuevo con el mismo conjunto de
 *  tracks es un no-op para los ids ya presentes. */
export function registerTrackIntegrationItems(state: JournalState): void {
    const items: VerificationItem[] = [...new Set((state.tracks ?? []).map((t) => t.trackId))].sort()
        .map((trackId) => ({ id: `track-integration:${trackId}`, kind: 'track-integration' as const }));
    applyCyclePlanAppend(state, items);
}

/** Convención determinista, sibling del repo del plan — nunca DENTRO de su
 *  working tree (git worktree add lo exige, y evita que el track pise el
 *  árbol que el propio plan está observando). El trackId ya pasó
 *  `gitCheckTrackId` antes de llegar acá, así que es seguro como segmento
 *  de path. NOTA (ver `concerns` del reporte de Task 8): esta función NO
 *  deriva ownership/dependsOn/sharedResources del plan — `reconcileTracks`
 *  (P1) no los necesita; quedan en `[]` hasta que un mecanismo futuro (fuera
 *  de alcance de R5-T8) los declare explícitamente. */
function trackWorktreePath(repoRoot: string, trackId: string): string {
    return path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}.track-${trackId}`);
}

function applyRequestToState(s: JournalState, env: RequestEnvelope & { requestId: string }, digest: string, repoRoot: string): void {
    const base = { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest };
    if (env.kind === 'controller-heartbeat') {
        s.controllerHeartbeatAt = now();
        applyOutcome(s, { ...base, outcome: 'applied' });
        return;
    }
    if (env.kind === 'job-request') {
        // get-or-create por idempotencyKey (RNF-T.7); duplicado => applyOutcome
        // registra el ALIAS con el mismo resultRef (Task 8).
        const prior = Object.values(s.appliedRequests).find((a) => a.idempotencyKey === env.idempotencyKey && a.outcome === 'applied');
        if (prior !== undefined) {
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        const p = env.payload;
        if (!Array.isArray(p.argv) || !p.argv.every((arg) => typeof arg === 'string') || p.argv.length === 0) throw new Error('job-request requiere argv no vacio');
        if (typeof p.fingerprint !== 'string' || typeof p.commandDigest !== 'string') throw new Error('job-request requiere fingerprint y commandDigest');
        // Un mismo resultado mecanico puede satisfacer mas de un item. La
        // request sigue teniendo identidad propia, pero no duplica ejecucion.
        const equivalent = Object.values(s.jobs).find((j) => j.fingerprint === p.fingerprint && j.commandDigest === p.commandDigest
            && (['received', 'spawn-intent', 'claimed', 'running'].includes(j.executionState)
                || (j.executionState === 'exited' && j.verdict === 'pass')));
        if (equivalent !== undefined) {
            for (const itemId of satisfiesArray(p.satisfies, 'job-request satisfies')) linkSatisfies(s, itemId, equivalent.id);
            applyOutcome(s, { ...base, outcome: 'applied', resultRef: equivalent.id });
            return;
        }
        const jobId = `job-${Object.keys(s.jobs).length + 1}-${crypto.randomBytes(3).toString('hex')}`;
        const satisfiesIds = satisfiesArray(p.satisfies, 'job-request satisfies');
        const job: Job = {
            id: jobId,
            fingerprint: String(p.fingerprint), commandDigest: String(p.commandDigest),
            argv: p.argv as string[],
            cwd: typeof p.cwd === 'string' ? p.cwd : '.',
            paths: p.paths === undefined ? [] : stringArray(p.paths, 'job-request paths'),
            expandedPaths: p.expandedPaths === undefined ? [] : stringArray(p.expandedPaths, 'job-request expandedPaths'),
            executionState: 'received', observationState: 'progressing',
            phaseTimestamps: { received: now() },
            ...(satisfiesIds.length > 0 ? { satisfies: satisfiesIds } : {}),
        };
        s.jobs[jobId] = job;
        for (const itemId of satisfiesIds) linkSatisfies(s, itemId, jobId);
        applyOutcome(s, { ...base, outcome: 'applied', resultRef: jobId });
        return;
    }
    if (env.kind === 'track-prepare-request') {
        // R4.1/R6.1: el ÚNICO efecto de esta request es declarar el TrackRef
        // (fase DECLARED) — todo lo que sigue (worktree, journal, supervisor,
        // ARMED, ACTIVE) es propiedad exclusiva de `reconcileTracks`
        // (watch/tracks.ts), nunca de este consumo transaccional.
        //
        // ============================================================
        // GAP CONOCIDO Y DELIBERADAMENTE DIFERIDO (post-review Task 8,
        // item 3 — decisión: opción (b), NO implementar acá):
        //
        // `TrackContext.taskIds`/`planDigest` (asignados en
        // `tracks.ts::runCreateTrackJournal`) y `TrackRef.ownership`/
        // `dependsOn`/`sharedResources` (asignados acá abajo) quedan
        // `[]`/`''` — NINGÚN task de 1 a 8 provee un mecanismo para que el
        // supervisor localice y parsee "el" archivo de plan .md de la rama
        // en ejecución. `parseTrackPlan` HOY solo se invoca desde
        // `track verify-independence --plan <file>`, con el path pasado a
        // mano; no existe convención de descubrimiento automático
        // (ni glob de `docs/plans/*.md`, ni mapeo rama->archivo).
        //
        // Esto NO bloquea a Task 8 (el protocolo P1 de `nextProtocolEffect`
        // jamás lee estos campos), pero SÍ va a romper en silencio:
        //   - Task 5's `assertTrackTask`/`computeTrackGate` (gating por
        //     `taskIds`/`planDigest` reales) una vez que algo intente usarlos
        //     de verdad contra un track creado por esta vía.
        //   - El supuesto de Task 14 (`docs/plans/2026-08-02-r5-parallel-
        //     tracks-plan.md:2587-2591`) de que `trackContext.taskIds` ya es
        //     confiable para ese momento.
        //
        // Requiere una decisión humana sobre qué task es dueño de: (a)
        // definir la convención de descubrimiento del archivo de plan, y
        // (b) extender `track add`/`emitTrackRequest` para llevarlo — o una
        // enmienda al plan de 17 tasks. No se improvisa acá.
        // ============================================================
        const p = env.payload;
        if (typeof p.trackId !== 'string' || p.trackId.length === 0) throw new Error('track-prepare-request requiere trackId');
        const trackId = p.trackId;
        if (!gitCheckTrackId(trackId)) throw new Error(`track-prepare-request: trackId inválido: ${trackId}`);
        if (!s.tracks?.some((t) => t.trackId === trackId)) {
            const ref: TrackRef = {
                trackId,
                worktreePath: trackWorktreePath(repoRoot, trackId),
                branch: `awm-track/${trackId}`,
                ownership: [], sharedResources: [], dependsOn: [],   // ver GAP arriba
                // R4.10: tokens criptográficamente aleatorios — los hashes
                // deterministas de protocol.ts son solo valores opacos del
                // modelo puro, jamás la fuente real de un token de producción.
                fencingToken: crypto.randomBytes(32).toString('hex'),
                phase: 'DECLARED',
                readinessNonce: crypto.randomBytes(32).toString('hex'),
            };
            s.tracks = [...(s.tracks ?? []), ref];
            // R7.3 (Task 12): el gate global queda rojo desde el momento en
            // que un track se conoce — no espera a que la cohorte termine de
            // declararse ni a JOINING/FINAL_QA.
            registerTrackIntegrationItems(s);
            // C1: la barrera ARMED solo tiene sentido con el conjunto COMPLETO
            // de la cohorte conocido — recién con >= 2 tracks declarados
            // existe algo que `reconcileTracks` pueda reconciliar (Task 1
            // exige al menos dos tracks en cualquier CohortProtocol válido).
            if (s.tracks.length >= 2 && s.cohortPhase === undefined) {
                s.cohortPhase = 'PREPARING';
                s.cohortBaseSha = headSha(repoRoot);
            }
        }
        applyOutcome(s, { ...base, outcome: 'applied', resultRef: trackId });
        return;
    }
    if (env.kind === 'track-join-request') {
        // R6.1: el ÚNICO efecto es marcar la intención. Quien decide si eso mueve la fase es
        // el reducer puro (`reconcileProtocol`, rama `join-requested`: solo un track en
        // `ACTIVE` pasa a `JOIN_REQUESTED`), y quien congela/mergea es `reconcileTracks` —
        // jamás este consumo transaccional. Mismo criterio declarativo que
        // `track-freeze-request` arriba.
        //
        // Este handler NO EXISTÍA: `awm track join` emitía la request, `applyRequestToState`
        // se caía por el final sin reconocer el kind, y `consumePendingRequests` la contaba
        // como `applied` y borraba el archivo. El comando salía 0 imprimiendo un requestId,
        // el supervisor sumaba una request "aplicada", y el track se quedaba en `ACTIVE`
        // para siempre: la cohorte no podía congelarse (C3), así que jamás llegaba a
        // `MERGED_UNVERIFIED` ni a `COMPLETE`. `join-requested` era la única observación del
        // protocolo con CERO productores en todo `src/`.
        const p = env.payload;
        if (typeof p.trackId !== 'string' || p.trackId.length === 0) throw new Error('track-join-request requiere trackId');
        const trackId = p.trackId;
        const ref = s.tracks?.find((t) => t.trackId === trackId);
        // Fail-closed: un join sobre un track que no existe es un error del emisor, no algo
        // que se absorba en silencio (que es exactamente lo que hacía la ausencia de handler).
        if (ref === undefined) throw new Error(`track-join-request: track desconocido: ${trackId}`);
        ref.joinRequested = true;
        applyOutcome(s, { ...base, outcome: 'applied', resultRef: trackId });
        return;
    }
    if (env.kind === 'track-teardown-request') {
        const p = env.payload;
        if (typeof p.trackId !== 'string' || p.trackId.length === 0) throw new Error('track-teardown-request requiere trackId');
        const trackId = p.trackId;
        const ref = s.tracks?.find((t) => t.trackId === trackId);
        if (ref === undefined) throw new Error(`track-teardown-request: track desconocido: ${trackId}`);
        if (s.tracks === undefined || s.tracks.length < 2 || s.cohortPhase === undefined) {
            throw new Error('track-teardown-request requiere una cohorte válida de al menos dos tracks');
        }
        ref.teardownRequested = true;
        applyOutcome(s, { ...base, outcome: 'applied', resultRef: trackId });
        return;
    }
    if (env.kind === 'track-freeze-request') {
        // R5.2/R6.3 (Task 10): request administrativa CROSS-JOURNAL — el
        // supervisor del PLAN la emite directamente al `requestsDir` de ESTE
        // journal (el journal de UN track), vía el mismo primitivo durable
        // (`emitRequest`) que cualquier otra request. El propio supervisor
        // del track (SU `Supervisor.tick()`, corriendo en este mismo
        // worktree) la consume acá como cualquier otra — el efecto es
        // puramente declarativo (marcar la intención); las 6 observaciones
        // reales (drenar jobs, recomputar gate, exigir árbol limpio,
        // terminar la generación propia) las hace `Supervisor.tick()` en su
        // propio loop, nunca este consumo transaccional (que no puede
        // esperar terminaciones de proceso reales). Idempotente sin
        // importar cuántas veces se re-emita, y jamás pisa un `frozen` ya
        // persistido (R6.4: un track congelado no vuelve a mutar).
        if (s.frozen === undefined) s.freezeRequested = true;
        applyOutcome(s, { ...base, outcome: 'applied' });
        return;
    }
    if (env.kind === 'track-finalize-request') {
        // R7.2 (Task 12): a diferencia de `track-freeze-request` (cross-
        // journal, un track por cada uno), esta request es PLAN-scoped — el
        // propio controller del PLAN (corriendo `post-implementation-qa`
        // sobre el HEAD ya mergeado de todos los tracks) la emite a SU PROPIO
        // journal para reportar "ya corregí hallazgos y comiteé, este es mi
        // HEAD limpio". El efecto acá es puramente declarativo (autoreporte);
        // `reconcileTracks`/`runRequestGlobalQa` (watch/tracks.ts) es quien
        // hace las dos observaciones reales independientes (HEAD real
        // coincide, árbol/índice limpios) antes de aceptarlo como evidencia
        // de `global-qa-pass` — jamás se confía ciegamente en el autoreporte
        // (mismo criterio fail-closed que el freeze de un track, Task 10).
        const p = env.payload;
        if (typeof p.qaHeadSha !== 'string' || p.qaHeadSha.length === 0) throw new Error('track-finalize-request requiere qaHeadSha');
        s.qaFinalizeRequested = { headSha: p.qaHeadSha, at: now() };
        applyOutcome(s, { ...base, outcome: 'applied' });
        return;
    }
    if (env.kind === 'register-entity') {
        const p = env.payload;
        if (p.entity === 'task') {
            if (typeof p.taskId !== 'string' || p.taskId.length === 0) throw new Error('register --entity task requiere taskId (string no vacio)');
            const taskId = p.taskId;
            if (!s.tasks.some((t) => t.id === taskId)) {
                const plan = p.verificationPlan === undefined ? [] : verificationItems(p.verificationPlan, 'verificationPlan');
                // R1.4b/R3.6: rechazo EN REGISTRO (no solo en gate) si el plan no
                // cubre los verificadores mecanicamente requeridos por el repo.
                const missingKinds = s.requiredVerifiers.filter((k) => !plan.some((item) => item.kind === k));
                if (missingKinds.length > 0) {
                    throw new Error(`register --entity task: verificationPlan no cubre los verificadores requeridos: ${missingKinds.join(', ')}`);
                }
                const obligations = p.reviewObligations === undefined ? [] : reviewObligations(p.reviewObligations, taskId);
                s.tasks.push({
                    id: taskId, title: String(p.title ?? taskId), status: 'pending', attempts: 0,
                    verificationPlan: plan, reviewObligations: obligations, createdAt: now(),
                });
            }
            applyOutcome(s, { ...base, outcome: 'applied', resultRef: taskId });
            return;
        }
        if (p.entity === 'cycle-plan') {
            const items = verificationItems(p.items, 'register --entity cycle-plan items');
            // R7.2 (Task 12): append transaccional por id — reemplaza el guard
            // "solo si vacío" (Fix4/R1.4b original). Un re-registro defensivo
            // (ej. tras crash sin memoria de si ya se registro) NUNCA pisa un
            // item ya existente ni pierde su `satisfiedBy`, pero SÍ agrega los
            // ids nuevos (ej. `track-integration:*` que `registerTrackIntegrationItems`
            // fue agregando en paralelo) — el plan de ciclo crece por unión,
            // nunca se reemplaza entero.
            applyCyclePlanAppend(s, items);
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        if (p.entity === 'track-integration') {
            // R7/C3/C4 (Task 12): el contrato canónico ÚNICO del job de
            // integración final de la cohorte — creación-única (como
            // cycle-plan antes de R7.2): jamás se pisa un contrato ya
            // registrado, porque dos contratos distintos en el tiempo
            // producirían dos idempotencyKeys distintas para "la" integración
            // final (violaría C4 — un solo job canónico).
            const argv = stringArray(p.argv, 'register --entity track-integration argv');
            if (argv.length === 0) throw new Error('register --entity track-integration requiere argv no vacio');
            const paths = p.paths === undefined ? [] : stringArray(p.paths, 'register --entity track-integration paths');
            if (typeof p.planDigest !== 'string') throw new Error('register --entity track-integration requiere planDigest (string)');
            if (s.trackIntegration === undefined) {
                s.trackIntegration = { argv, paths, planDigest: p.planDigest };
            }
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        if (p.entity === 'dispatch') {
            if (typeof p.dispatchId !== 'string' || p.dispatchId.length === 0) throw new Error('register --entity dispatch requiere dispatchId (string no vacio)');
            if (typeof p.taskId !== 'string' || p.taskId.length === 0) throw new Error('register --entity dispatch requiere taskId (string no vacio)');
            const dispatchId = p.dispatchId;
            const taskId = p.taskId;
            if (!s.tasks.some((task) => task.id === taskId)) throw new Error('register --entity dispatch: taskId desconocido');
            if (!s.dispatches.some((d) => d.id === dispatchId)) {
                s.dispatches.push({ id: dispatchId, taskId, at: now() });
                const task = s.tasks.find((t) => t.id === taskId);
                if (task !== undefined) task.attempts += 1;
            }
            applyOutcome(s, { ...base, outcome: 'applied', resultRef: dispatchId });
            return;
        }
        if (p.entity === 'task-status') {
            if (typeof p.taskId !== 'string' || p.taskId.length === 0) throw new Error('register --entity task-status requiere taskId (string no vacio)');
            if (p.status !== 'pending' && p.status !== 'in-progress' && p.status !== 'done') throw new Error('register --entity task-status requiere status pending|in-progress|done');
            const taskId = p.taskId;
            const status = p.status;
            const task = s.tasks.find((t) => t.id === taskId);
            // Fake-success eliminado: una referencia a un taskId inexistente NO
            // es un no-op silencioso con outcome 'applied' — se rechaza (Fix 1
            // Parte C lo captura sin tumbar el supervisor).
            if (task === undefined) throw new Error('register --entity task-status: taskId desconocido');
            task.status = status;
            if (status === 'done') task.completedAt = now();
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        if (p.entity === 'next-action') {
            if (typeof p.actionId !== 'string' || typeof p.type !== 'string' || typeof p.target !== 'string') {
                throw new Error('register --entity next-action requiere actionId, type, target (strings)');
            }
            s.cycle.nextAction = {
                actionId: p.actionId,
                type: p.type,
                target: p.target,
                preconditions: p.preconditions === undefined ? [] : stringArray(p.preconditions, 'next-action preconditions'),
                attempt: typeof p.attempt === 'number' ? p.attempt : 0,
                state: p.state === 'in-progress' ? 'in-progress' : 'pending',
            };
            applyOutcome(s, { ...base, outcome: 'applied', resultRef: p.actionId });
            return;
        }
        if (p.entity === 'custody-decision') {
            if (p.decision !== 'resume' || typeof p.reason !== 'string' || p.reason.trim().length === 0) {
                throw new Error('register --entity custody-decision requiere decision=resume y reason no vacio');
            }
            if (s.cycle.status !== 'BLOCKED') throw new Error('custody-decision solo aplica a un ciclo BLOCKED');
            s.custodyDecisions ??= [];
            s.custodyDecisions.push({ at: now(), decision: 'resume', reason: p.reason, generationToken: env.generationToken });
            for (const generation of s.generations) {
                if (generation.state === 'active' || generation.state === 'controller-suspected-stall') generation.state = 'superseded';
            }
            s.cycle.status = 'IN_PROGRESS';
            s.cycle.blockedReason = undefined;
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        throw new Error(`register-entity desconocida: ${String(p.entity)}`);
    }
    if (env.kind === 'verdict') {
        const p = env.payload;
        if (typeof p.verdictId !== 'string' || p.verdictId.length === 0) throw new Error('verdict requiere verdictId');
        if (typeof p.obligationId !== 'string' || p.obligationId.length === 0) throw new Error('verdict requiere obligationId');
        if (typeof p.fingerprint !== 'string' || typeof p.cwd !== 'string') {
            throw new Error('verdict requiere evidencia de fingerprint reproducible');
        }
        const verdictArgv = stringArray(p.argv, 'verdict argv');
        const verdictPaths = stringArray(p.paths, 'verdict paths');
        if (p.result !== 'pass' && p.result !== 'fail' && p.result !== 'inconclusive') throw new Error('verdict requiere result pass|fail|inconclusive');
        const verdictId = String(p.verdictId);
        const obligationId = String(p.obligationId);
        if (!s.tasks.some((task) => task.reviewObligations.some((obligation) => obligation.id === obligationId))) {
            throw new Error(`verdict refiere obligationId desconocido: ${obligationId}`);
        }
        if (!s.verdicts.some((v) => v.id === verdictId)) {
            const result = p.result;
            // R2.3: redaccion tambien en el `detail` de texto libre humano, no
            // solo en argv — antes de cualquier escritura durable.
            s.verdicts.push({
                id: verdictId, obligationId, result, detail: redactText(String(p.detail ?? '')), receivedAt: now(),
                fingerprint: p.fingerprint, argv: verdictArgv, paths: verdictPaths, cwd: p.cwd,
            });
            for (const t of s.tasks) {
                const o = t.reviewObligations.find((x) => x.id === obligationId);
                if (o !== undefined) o.verdictId = verdictId;
                for (const item of t.verificationPlan) {
                    if (item.kind === 'review' && item.id === obligationId) item.satisfiedBy = verdictId;
                }
            }
            // Veredicto adverso => FixObligation ATOMICA: misma mutacion, misma
            // escritura de estado (R1.4c, bloqueador 5).
            if (result !== 'pass') {
                s.fixes.push({ id: `fix-${verdictId}`, verdictId, closed: false });
            } else {
                // pass sobre la MISMA obligacion cierra cualquier fix abierto de
                // un veredicto adverso anterior — un ciclo real fail->fix->pass
                // debe poder llegar a COMPLETE (bloqueador de este dispatch).
                const priorAdverseIds = s.verdicts
                    .filter((v) => v.obligationId === obligationId && v.id !== verdictId && v.result !== 'pass')
                    .map((v) => v.id);
                for (const fix of s.fixes) {
                    if (priorAdverseIds.includes(fix.verdictId)) fix.closed = true;
                }
            }
        }
        applyOutcome(s, { ...base, outcome: 'applied', resultRef: verdictId });
        return;
    }
    // FALLA CERRADO ante un kind sin handler. Antes esta función simplemente se caía por el
    // final: `consumePendingRequests` no veía excepción, hacía `applied++` y BORRABA el
    // archivo. Una request emitida por un comando real quedaba contada como aplicada, sin
    // evento, sin cambio de estado y sin error — el modo de falla más caro que existe, porque
    // todo el sistema reporta éxito. Así vivió `track-join-request` (ver su handler arriba):
    // el comando salía 0, el journal sumaba una request "aplicada", y la cohorte no avanzaba.
    //
    // Con este throw, un kind sin handler se convierte en `request-rejected-invalid`: queda en
    // `requestProblems`, deja evento durable, y el archivo se renombra a `.rejected` en vez de
    // desaparecer. Agregar un `RequestKind` sin su handler pasa a ser ruidoso — que es la
    // única forma de que no se repita.
    throw new Error(`request kind sin handler en el supervisor: ${env.kind} — emitida pero nunca aplicada`);
}

/** Consume TODAS las requests pendientes en orden. ORDEN CRITICO (R1.3,
 *  bloqueador 4): (1) mutar estado, (2) writeJournal, (3) borrar archivos,
 *  (4) fsync del directorio. Solo el supervisor llama esto (single-writer). */
export function consumePendingRequests(repoRoot: string, branch: string, activeToken: string | null): ApplySummary {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    let s = r.state;
    const pending = listPendingRequests(repoRoot, branch);
    const processedFiles: string[] = [];
    const deferredRenames: Array<{ from: string; to: string }> = [];
    let applied = 0, rejectedStale = 0, rejectedDigest = 0, rejectedInvalid = 0, corrupt = 0;
    let dirChanged = false;   // corrupt-rename O borrado normal: cualquiera muta el directorio
    let stateTouched = false;
    for (const p of pending) {
        if (p.corrupt) {
            corrupt++;
            deferredRenames.push({ from: p.file, to: `${p.file}.corrupt` });
            if (!s.requestProblems.some((problem) => problem.file === p.file && problem.kind === 'corrupt')) {
                s.requestProblems.push({ file: p.file, kind: 'corrupt', detail: 'request JSON/shape invalido', at: now() });
            }
            appendEvent(repoRoot, branch, { kind: 'request-corrupt', file: p.file });
            dirChanged = true;
            stateTouched = true;
            continue;
        }
        const env = p.envelope;
        const digest = digestOf(env.payload);
        if (s.appliedRequests[env.requestId] !== undefined) {
            // replay tras crash post-journal/pre-borrado: ya aplicada, solo borrar
            processedFiles.push(p.file);
            dirChanged = true;
            continue;
        }
        // Fix 1: idempotencyKey reutilizada con payload DISTINTO se detecta
        // PROACTIVAMENTE aca, antes de mutar nada — jamas dejamos que
        // applyOutcome('applied') tire (eso encallaria al supervisor para
        // siempre, con el archivo ofensor nunca borrado). Se rechaza visible
        // via el outcome ya existente 'rejected-digest-mismatch'.
        const priorSameKey = Object.values(s.appliedRequests).find((a) => a.idempotencyKey === env.idempotencyKey);
        if (priorSameKey !== undefined && priorSameKey.payloadDigest !== digest) {
            applyOutcome(s, { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest, outcome: 'rejected-digest-mismatch' });
            appendEvent(repoRoot, branch, { kind: 'request-rejected-digest-mismatch', requestId: env.requestId });
            rejectedDigest++;
        } else if (activeToken !== null && env.generationToken !== activeToken) {
            applyOutcome(s, { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest, outcome: 'rejected-stale-generation' });
            appendEvent(repoRoot, branch, { kind: 'request-rejected-stale', requestId: env.requestId });
            rejectedStale++;
        } else {
            // Defensa en profundidad (Fix 1 Parte C): CUALQUIER error de
            // validacion inesperado (Fix 6/7 u otro futuro) jamas debe tumbar
            // al supervisor. Se trata como el .corrupt existente — visible,
            // jamas descartado en silencio — pero con sufijo distinto porque
            // esto es rechazo de CONTENIDO, no de forma (R1.6).
            try {
                // Toda request se valida/muta sobre una copia. Un fallo profundo
                // nunca deja un estado parcialmente contaminado que luego no se
                // pueda serializar o reintentar.
                const candidate = structuredClone(s);
                applyRequestToState(candidate, env, digest, repoRoot);
                s = candidate;
                applied++;
                stateTouched = true;
            } catch (e) {
                rejectedInvalid++;
                deferredRenames.push({ from: p.file, to: `${p.file}.rejected` });
                if (!s.requestProblems.some((problem) => problem.file === p.file && problem.kind === 'rejected')) {
                    s.requestProblems.push({ file: p.file, kind: 'rejected', detail: redactText((e as Error).message), at: now() });
                }
                appendEvent(repoRoot, branch, { kind: 'request-rejected-invalid', requestId: env.requestId, detail: (e as Error).message });
                dirChanged = true;
                stateTouched = true;
                continue;
            }
        }
        processedFiles.push(p.file);
        dirChanged = true;
    }
    if (processedFiles.length > 0 || stateTouched) {
        writeJournal(repoRoot, branch, s);                 // (2) journal ANTES del borrado
    }
    for (const rename of deferredRenames) {
        if (fs.existsSync(rename.from)) fs.renameSync(rename.from, rename.to);
    }
    for (const f of processedFiles) fs.rmSync(f, { force: true });   // (3)
    if (dirChanged) fsyncDirSync(requestsDir(repoRoot, branch));     // (4) — incluye batches solo-corrupt
    return { applied, rejectedStale, rejectedDigest, rejectedInvalid, corrupt };
}
