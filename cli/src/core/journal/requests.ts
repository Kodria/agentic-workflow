import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requestsDir } from './paths';
import { findLiteralSecretFlag, redactArgv } from './redact';
import { fsyncDirSync } from '../atomic-file';
import type { AppliedRequest, JournalState } from './types';

let requestSeq = 0;

export interface RequestEnvelope {
    kind: 'job-request' | 'register-entity' | 'controller-heartbeat' | 'verdict';
    generationToken: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
}
export interface EmittedRequest { requestId: string; idempotencyKey: string; payloadDigest: string; file: string; }

export function digestOf(payload: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Publicacion atomica Y durable (R1.3, bloqueador 4): tmp + fsync + close +
 *  rename + fsync del DIRECTORIO. Redaccion EN EL EMISOR; secreto literal en
 *  flag sensible => rechazo sin persistir (R2.3). */
export function emitRequest(repoRoot: string, branch: string, env: RequestEnvelope): EmittedRequest {
    const payload = { ...env.payload };
    if (Array.isArray(payload.argv)) {
        const secretFlag = findLiteralSecretFlag(payload.argv as string[]);
        if (secretFlag !== null) throw new Error(`secreto literal en ${secretFlag}: pasalo por referencia (-env), no por valor`);
        payload.argv = redactArgv(payload.argv as string[]);
    }
    const seq = (requestSeq++).toString().padStart(10, '0');
    const requestId = `req-${Date.now()}-${seq}-${crypto.randomBytes(4).toString('hex')}`;
    const body = JSON.stringify({ requestId, ...env, payload }, null, 2) + '\n';
    const dir = requestsDir(repoRoot, branch);
    const tmp = path.join(dir, `.${requestId}.tmp`);
    const final = path.join(dir, `${requestId}.json`);
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, body);
        fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, final);
    fsyncDirSync(dir);   // la ENTRADA renombrada tambien debe sobrevivir un crash (R1.3)
    return { requestId, idempotencyKey: env.idempotencyKey, payloadDigest: digestOf(payload), file: final };
}

export interface PendingRequest { requestId: string; envelope: RequestEnvelope & { requestId: string }; file: string; corrupt: boolean; }

export function listPendingRequests(repoRoot: string, branch: string): PendingRequest[] {
    const dir = requestsDir(repoRoot, branch);
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
        const file = path.join(dir, f);
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (typeof parsed !== 'object' || parsed === null || typeof parsed.requestId !== 'string') {
                return { requestId: f, envelope: null as never, file, corrupt: true };
            }
            return { requestId: parsed.requestId, envelope: parsed, file, corrupt: false };
        } catch {
            return { requestId: f, envelope: null as never, file, corrupt: true };
        }
    });
}

/** Registro del resultado en el state (el ack es derivable — R1.3).
 *  - mismo requestId ya registrado => no-op (replay seguro);
 *  - misma idempotencyKey con digest DISTINTO => error explicito;
 *  - misma idempotencyKey con mismo digest => ALIAS: el requestId nuevo
 *    registra SU PROPIA entrada con el mismo outcome/resultRef, para poder
 *    regenerar su ack (bloqueador 4 de la review).
 *  Devuelve el state mutado (el caller es el supervisor, que luego hace
 *  writeJournal — orden estado -> journal -> borrado de archivos). */
export function applyOutcome(state: JournalState, applied: AppliedRequest): JournalState {
    if (state.appliedRequests[applied.requestId] !== undefined) return state;
    const prior = Object.values(state.appliedRequests).find((a) => a.idempotencyKey === applied.idempotencyKey);
    if (prior !== undefined && prior.payloadDigest !== applied.payloadDigest) {
        throw new Error(`idempotencyKey ${applied.idempotencyKey} reutilizada con payload digest distinto`);
    }
    if (prior !== undefined) {
        state.appliedRequests[applied.requestId] = { ...applied, outcome: prior.outcome, resultRef: prior.resultRef };
        return state;
    }
    state.appliedRequests[applied.requestId] = applied;
    return state;
}

export function ackFor(state: JournalState, requestId: string): AppliedRequest | null {
    return state.appliedRequests[requestId] ?? null;
}
