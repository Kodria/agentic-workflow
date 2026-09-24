import fs from 'fs';
import path from 'path';
import { parseJsonNoDuplicate } from '../../core/plan/json';
import { fsyncDirSync } from '../../core/atomic-file';
import { activeRequestProblems, type JournalState } from '../../core/journal/types';
import { digestOf, isWellFormedEnvelope, type RequestEnvelope } from '../../core/journal/requests';
import { requestsDir } from '../../core/journal/paths';
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { refIsAlive } from '../../core/journal/process';
import { applyRequestToState } from './apply';
import { acquireLock, releaseLock } from './lock';

const REQUEST_ID = /^req-[0-9]+-[0-9]{10}-[a-f0-9]{8}$/;
const MAX_REQUEST_BYTES = 256 * 1024;

export interface RecoverRejectedTaskInput {
    rejectedRequestId: string;
    replacementRequestId: string;
    generationToken: string;
    reason: string;
    resume: boolean;
}

function validatedId(value: unknown, label: string): string {
    if (typeof value !== 'string' || !REQUEST_ID.test(value)) throw new Error(`${label} requiere un requestId valido`);
    return value;
}

/** Reads only one canonical, bounded request file. The inode check closes a
 * swap between lstat and open, including platforms without O_NOFOLLOW. */
function requestEnvelope(file: string, requestId: string): RequestEnvelope & { requestId: string } {
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > MAX_REQUEST_BYTES) {
        throw new Error('request de recovery no es un archivo regular acotado');
    }
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let body: string;
    try {
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
            throw new Error('request de recovery cambio de identidad');
        }
        body = fs.readFileSync(descriptor, { encoding: 'utf8' });
    } finally { fs.closeSync(descriptor); }
    const parsed: unknown = parseJsonNoDuplicate(body);
    if (!isWellFormedEnvelope(parsed) || parsed.requestId !== requestId) throw new Error('request de recovery tiene envelope invalido');
    return parsed;
}

function taskId(envelope: RequestEnvelope & { requestId: string }): string {
    if (envelope.kind !== 'register-entity' || envelope.payload.entity !== 'task'
        || typeof envelope.payload.taskId !== 'string' || envelope.payload.taskId.length === 0) {
        throw new Error('recovery solo admite register-entity task con taskId');
    }
    return envelope.payload.taskId;
}

function mayResume(state: JournalState): void {
    if (state.cycle.status !== 'BLOCKED' || state.cycle.blockedReason !== 'recovery no autorizado: hay conflictos durables de requests') {
        throw new Error('resume requiere custodia BLOCKED por requests');
    }
    if (activeRequestProblems(state).length > 0) throw new Error('resume requiere resolver todas las requests activas');
}

/** Offline recovery lane: no supervisor or controller may own this journal.
 * The correction and its audit link are published in one state transaction. */
export function recoverRejectedTask(repoRoot: string, branch: string, input: RecoverRejectedTaskInput): void {
    if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot) || typeof branch !== 'string' || branch.length === 0
        || !input || typeof input !== 'object' || typeof input.generationToken !== 'string' || input.generationToken.length === 0
        || typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > 1024 || typeof input.resume !== 'boolean') {
        throw new Error('parametros de recovery invalidos');
    }
    const rejectedId = validatedId(input.rejectedRequestId, '--rejected');
    const replacementId = validatedId(input.replacementRequestId, '--replacement');
    if (rejectedId === replacementId) throw new Error('la request correctiva debe ser distinta');
    const lock = acquireLock(repoRoot);
    try {
        const read = readJournal(repoRoot, branch);
        if (read.corrupt || !read.state || read.state.schema !== 2 || !read.state.planBinding) throw new Error('recovery requiere journal schema-2 vigente');
        const state = read.state;
        const latest = [...state.generations].sort((a, b) => b.n - a.n)[0];
        if (!latest || latest.token !== input.generationToken) throw new Error('generation de recovery no es la vigente');
        for (const generation of state.generations) {
            for (const ref of [generation.processRef, generation.wrapperRef]) {
                if (ref && refIsAlive(ref)) throw new Error('controller vivo: recovery requiere custodia exclusiva');
            }
        }
        const dir = requestsDir(repoRoot, branch);
        const originalFile = path.join(dir, `${rejectedId}.json`);
        const problem = state.requestProblems.find(item => item.kind === 'rejected' && item.file === originalFile);
        if (!problem) throw new Error('rechazo durable no encontrado');
        if (problem.resolution) {
            if (problem.resolution.replacementRequestId !== replacementId || problem.resolution.generationToken !== input.generationToken || problem.resolution.reason !== input.reason
                || activeRequestProblems(state).includes(problem)) throw new Error('recovery previo incompatible');
            if (input.resume && state.cycle.status === 'BLOCKED') {
                const candidate = structuredClone(state);
                mayResume(candidate);
                candidate.custodyDecisions ??= [];
                candidate.custodyDecisions.push({ at: new Date().toISOString(), decision: 'resume', reason: input.reason, generationToken: input.generationToken });
                candidate.cycle.status = 'IN_PROGRESS';
                candidate.cycle.blockedReason = undefined;
                for (const generation of candidate.generations) if (generation.state === 'active' || generation.state === 'controller-suspected-stall') generation.state = 'superseded';
                writeJournal(repoRoot, branch, candidate);
            }
            return;
        }
        const original = requestEnvelope(`${originalFile}.rejected`, rejectedId);
        const replacementFile = path.join(dir, `${replacementId}.json`);
        const replacement = requestEnvelope(replacementFile, replacementId);
        if (original.generationToken !== input.generationToken || replacement.generationToken !== input.generationToken || taskId(original) !== taskId(replacement)) {
            throw new Error('request correctiva no enlaza el mismo taskId o generation');
        }
        if (state.tasks.some(task => task.id === taskId(original))) throw new Error('task ya existente: recovery requiere un registro rechazado sin aplicar');
        if (state.appliedRequests[replacementId] !== undefined || Object.values(state.appliedRequests).some(item => item.idempotencyKey === replacement.idempotencyKey && item.payloadDigest !== digestOf(replacement.payload))) {
            throw new Error('request correctiva ya tiene outcome o idempotencyKey conflictiva');
        }
        const candidate = structuredClone(state);
        applyRequestToState(candidate, replacement, digestOf(replacement.payload), repoRoot);
        if (candidate.appliedRequests[replacementId]?.outcome !== 'applied' || !candidate.tasks.some(task => task.id === taskId(replacement))) {
            throw new Error('request correctiva no fue aplicada');
        }
        const target = candidate.requestProblems.find(item => item.kind === 'rejected' && item.file === originalFile)!;
        target.requestId = rejectedId;
        target.taskId = taskId(original);
        target.generationToken = original.generationToken;
        target.resolution = { replacementRequestId: replacementId, replacementPayloadDigest: digestOf(replacement.payload), reason: input.reason,
            generationToken: input.generationToken, at: new Date().toISOString() };
        if (input.resume) {
            mayResume(candidate);
            candidate.custodyDecisions ??= [];
            candidate.custodyDecisions.push({ at: new Date().toISOString(), decision: 'resume', reason: input.reason, generationToken: input.generationToken });
            candidate.cycle.status = 'IN_PROGRESS';
            candidate.cycle.blockedReason = undefined;
            for (const generation of candidate.generations) if (generation.state === 'active' || generation.state === 'controller-suspected-stall') generation.state = 'superseded';
        }
        writeJournal(repoRoot, branch, candidate);
        fs.rmSync(replacementFile);
        fsyncDirSync(dir);
        appendEvent(repoRoot, branch, { kind: 'request-recovered', rejectedRequestId: rejectedId, replacementRequestId: replacementId, generationToken: input.generationToken, resumed: input.resume });
    } finally { releaseLock(repoRoot, lock); }
}
