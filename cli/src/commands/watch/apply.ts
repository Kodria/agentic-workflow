// Consumo transaccional de requests (bloqueador 4): mutar estado ->
// writeJournal -> RECIEN AHI borrar archivos. El replay es seguro por
// requestId + idempotencyKey + digest.
import fs from 'fs';
import crypto from 'crypto';
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { listPendingRequests, applyOutcome, digestOf, RequestEnvelope } from '../../core/journal/requests';
import { requestsDir } from '../../core/journal/paths';
import { fsyncDirSync } from '../../core/atomic-file';
import { redactText } from '../../core/journal/redact';
import type { Job, JournalState, ReviewObligation, VerificationItem } from '../../core/journal/types';

export interface ApplySummary { applied: number; rejectedStale: number; rejectedDigest: number; rejectedInvalid: number; corrupt: number; }

function now(): string { return new Date().toISOString(); }

function linkSatisfies(s: JournalState, itemId: string, jobId: string): void {
    const items: VerificationItem[] = [...s.tasks.flatMap((t) => t.verificationPlan), ...s.cycleVerificationPlan];
    const item = items.find((i) => i.id === itemId);
    if (item !== undefined) item.satisfiedBy = jobId;
}

function applyRequestToState(s: JournalState, env: RequestEnvelope & { requestId: string }, digest: string): void {
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
        const jobId = `job-${Object.keys(s.jobs).length + 1}-${crypto.randomBytes(3).toString('hex')}`;
        const job: Job = {
            id: jobId,
            fingerprint: String(p.fingerprint), commandDigest: String(p.commandDigest),
            argv: p.argv as string[],
            cwd: typeof p.cwd === 'string' ? p.cwd : '.',
            paths: Array.isArray(p.paths) ? p.paths as string[] : [],
            expandedPaths: Array.isArray(p.expandedPaths) ? p.expandedPaths as string[] : [],
            executionState: 'received', observationState: 'progressing',
            phaseTimestamps: { received: now() },
            ...(typeof p.satisfies === 'string' ? { satisfies: p.satisfies } : {}),
        };
        s.jobs[jobId] = job;
        if (typeof p.satisfies === 'string') linkSatisfies(s, p.satisfies, jobId);
        applyOutcome(s, { ...base, outcome: 'applied', resultRef: jobId });
        return;
    }
    if (env.kind === 'register-entity') {
        const p = env.payload;
        if (p.entity === 'task') {
            if (typeof p.taskId !== 'string' || p.taskId.length === 0) throw new Error('register --entity task requiere taskId (string no vacio)');
            const taskId = p.taskId;
            if (!s.tasks.some((t) => t.id === taskId)) {
                const plan = Array.isArray(p.verificationPlan) ? p.verificationPlan as VerificationItem[] : [];
                // R1.4b/R3.6: rechazo EN REGISTRO (no solo en gate) si el plan no
                // cubre los verificadores mecanicamente requeridos por el repo.
                const missingKinds = s.requiredVerifiers.filter((k) => !plan.some((item) => item.kind === k));
                if (missingKinds.length > 0) {
                    throw new Error(`register --entity task: verificationPlan no cubre los verificadores requeridos: ${missingKinds.join(', ')}`);
                }
                const obligations = (Array.isArray(p.reviewObligations) ? p.reviewObligations as Array<{ id: string; kind: 'spec' | 'quality' }> : [])
                    .map((o): ReviewObligation => ({ id: o.id, taskId, kind: o.kind }));
                s.tasks.push({
                    id: taskId, title: String(p.title ?? taskId), status: 'pending', attempts: 0,
                    verificationPlan: plan, reviewObligations: obligations, createdAt: now(),
                });
            }
            applyOutcome(s, { ...base, outcome: 'applied', resultRef: taskId });
            return;
        }
        if (p.entity === 'cycle-plan') {
            if (!Array.isArray(p.items)) throw new Error('register --entity cycle-plan requiere items (array)');
            // Idempotente por creacion-unica (Task 4): un re-registro defensivo
            // (ej. tras crash sin memoria de si ya se registro) NUNCA debe pisar
            // un plan ya existente y perder los `satisfiedBy` ya enlazados.
            if (s.cycleVerificationPlan.length === 0) {
                s.cycleVerificationPlan = p.items as VerificationItem[];
            }
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        if (p.entity === 'dispatch') {
            if (typeof p.dispatchId !== 'string' || p.dispatchId.length === 0) throw new Error('register --entity dispatch requiere dispatchId (string no vacio)');
            if (typeof p.taskId !== 'string' || p.taskId.length === 0) throw new Error('register --entity dispatch requiere taskId (string no vacio)');
            const dispatchId = p.dispatchId;
            const taskId = p.taskId;
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
            if (task === undefined) throw new Error(`register --entity task-status: taskId desconocido: ${taskId}`);
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
                preconditions: Array.isArray(p.preconditions) ? p.preconditions as string[] : [],
                attempt: typeof p.attempt === 'number' ? p.attempt : 0,
                state: p.state === 'in-progress' ? 'in-progress' : 'pending',
            };
            applyOutcome(s, { ...base, outcome: 'applied', resultRef: p.actionId });
            return;
        }
        applyOutcome(s, { ...base, outcome: 'applied' });
        return;
    }
    if (env.kind === 'verdict') {
        const p = env.payload;
        const verdictId = String(p.verdictId);
        const obligationId = String(p.obligationId);
        if (!s.verdicts.some((v) => v.id === verdictId)) {
            const result = p.result === 'pass' || p.result === 'fail' || p.result === 'inconclusive' ? p.result : 'inconclusive';
            // R2.3: redaccion tambien en el `detail` de texto libre humano, no
            // solo en argv — antes de cualquier escritura durable.
            s.verdicts.push({ id: verdictId, obligationId, result, detail: redactText(String(p.detail ?? '')), receivedAt: now() });
            for (const t of s.tasks) {
                const o = t.reviewObligations.find((x) => x.id === obligationId);
                if (o !== undefined) o.verdictId = verdictId;
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
}

/** Consume TODAS las requests pendientes en orden. ORDEN CRITICO (R1.3,
 *  bloqueador 4): (1) mutar estado, (2) writeJournal, (3) borrar archivos,
 *  (4) fsync del directorio. Solo el supervisor llama esto (single-writer). */
export function consumePendingRequests(repoRoot: string, branch: string, activeToken: string | null): ApplySummary {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    const pending = listPendingRequests(repoRoot, branch);
    const processedFiles: string[] = [];
    let applied = 0, rejectedStale = 0, rejectedDigest = 0, rejectedInvalid = 0, corrupt = 0;
    let dirChanged = false;   // corrupt-rename O borrado normal: cualquiera muta el directorio
    for (const p of pending) {
        if (p.corrupt) {
            corrupt++;
            fs.renameSync(p.file, `${p.file}.corrupt`);   // visible, jamas descartado (R1.6)
            appendEvent(repoRoot, branch, { kind: 'request-corrupt', file: p.file });
            dirChanged = true;
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
                applyRequestToState(s, env, digest);
                applied++;
            } catch (e) {
                rejectedInvalid++;
                fs.renameSync(p.file, `${p.file}.rejected`);
                appendEvent(repoRoot, branch, { kind: 'request-rejected-invalid', requestId: env.requestId, detail: (e as Error).message });
                dirChanged = true;
                continue;   // ya removido del directorio por el rename: NO pushear a processedFiles
            }
        }
        processedFiles.push(p.file);
        dirChanged = true;
    }
    if (processedFiles.length > 0) {
        writeJournal(repoRoot, branch, s);                 // (2) journal ANTES del borrado
    }
    for (const f of processedFiles) fs.rmSync(f, { force: true });   // (3)
    if (dirChanged) fsyncDirSync(requestsDir(repoRoot, branch));     // (4) — incluye batches solo-corrupt
    return { applied, rejectedStale, rejectedDigest, rejectedInvalid, corrupt };
}
