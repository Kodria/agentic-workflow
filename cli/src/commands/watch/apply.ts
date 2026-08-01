// Consumo transaccional de requests (bloqueador 4): mutar estado ->
// writeJournal -> RECIEN AHI borrar archivos. El replay es seguro por
// requestId + idempotencyKey + digest.
import fs from 'fs';
import crypto from 'crypto';
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { listPendingRequests, applyOutcome, digestOf, RequestEnvelope } from '../../core/journal/requests';
import { requestsDir } from '../../core/journal/paths';
import { fsyncDirSync } from '../../core/atomic-file';
import type { Job, JournalState, ReviewObligation, VerificationItem } from '../../core/journal/types';

export interface ApplySummary { applied: number; rejectedStale: number; corrupt: number; }

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
            const taskId = String(p.taskId);
            if (!s.tasks.some((t) => t.id === taskId)) {
                const plan = Array.isArray(p.verificationPlan) ? p.verificationPlan as VerificationItem[] : [];
                const obligations = (Array.isArray(p.reviewObligations) ? p.reviewObligations as Array<{ id: string; kind: 'spec' | 'quality' }> : [])
                    .map((o): ReviewObligation => ({ id: o.id, taskId, kind: o.kind }));
                s.tasks.push({
                    id: taskId, title: String(p.title ?? taskId), status: 'pending', attempts: 0,
                    verificationPlan: plan, reviewObligations: obligations, createdAt: now(),
                });
            }
            applyOutcome(s, { ...base, outcome: 'applied', resultRef: String(p.taskId) });
            return;
        }
        if (p.entity === 'cycle-plan') {
            s.cycleVerificationPlan = Array.isArray(p.items) ? p.items as VerificationItem[] : [];
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        if (p.entity === 'dispatch') {
            const dispatchId = String(p.dispatchId);
            const taskId = String(p.taskId);
            if (!s.dispatches.some((d) => d.id === dispatchId)) {
                s.dispatches.push({ id: dispatchId, taskId, at: now() });
                const task = s.tasks.find((t) => t.id === taskId);
                if (task !== undefined) task.attempts += 1;
            }
            applyOutcome(s, { ...base, outcome: 'applied', resultRef: dispatchId });
            return;
        }
        if (p.entity === 'task-status') {
            const task = s.tasks.find((t) => t.id === String(p.taskId));
            if (task !== undefined) {
                const status = String(p.status);
                if (status === 'pending' || status === 'in-progress' || status === 'done') {
                    task.status = status;
                    if (status === 'done') task.completedAt = now();
                }
            }
            applyOutcome(s, { ...base, outcome: 'applied' });
            return;
        }
        applyOutcome(s, { ...base, outcome: 'applied' });
        return;
    }
    if (env.kind === 'verdict') {
        const p = env.payload;
        const verdictId = String(p.verdictId);
        if (!s.verdicts.some((v) => v.id === verdictId)) {
            const result = p.result === 'pass' || p.result === 'fail' || p.result === 'inconclusive' ? p.result : 'inconclusive';
            s.verdicts.push({ id: verdictId, obligationId: String(p.obligationId), result, detail: String(p.detail ?? ''), receivedAt: now() });
            for (const t of s.tasks) {
                const o = t.reviewObligations.find((x) => x.id === String(p.obligationId));
                if (o !== undefined) o.verdictId = verdictId;
            }
            // Veredicto adverso => FixObligation ATOMICA: misma mutacion, misma
            // escritura de estado (R1.4c, bloqueador 5).
            if (result !== 'pass') {
                s.fixes.push({ id: `fix-${verdictId}`, verdictId, closed: false });
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
    let applied = 0, rejectedStale = 0, corrupt = 0;
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
        if (activeToken !== null && env.generationToken !== activeToken) {
            applyOutcome(s, { requestId: env.requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digest, outcome: 'rejected-stale-generation' });
            appendEvent(repoRoot, branch, { kind: 'request-rejected-stale', requestId: env.requestId });
            rejectedStale++;
        } else {
            applyRequestToState(s, env, digest);
            applied++;
        }
        processedFiles.push(p.file);
        dirChanged = true;
    }
    if (applied + rejectedStale > 0 || processedFiles.length > 0) {
        writeJournal(repoRoot, branch, s);                 // (2) journal ANTES del borrado
    }
    for (const f of processedFiles) fs.rmSync(f, { force: true });   // (3)
    if (dirChanged) fsyncDirSync(requestsDir(repoRoot, branch));     // (4) — incluye batches solo-corrupt
    return { applied, rejectedStale, corrupt };
}
