import type { Selection } from './types';
import { spawn } from 'child_process';
import { readCodexRolloutSelection } from './native-codex-rollout';
export { normalizeCodexRolloutSelection } from './native-codex-rollout';

export type CodexCatalogDiscovery = {
    provenance: 'native-catalog';
    selections: Selection[];
    nativeDispatchVerified: false;
    actualModelVerified: false;
};

export type CodexChildThreadObservation = {
    provenance: 'codex-app-server-thread-read';
    parentThreadId: string;
    childThreadId: string;
    turnId: string;
    nativeDispatchVerified: true;
    configuredSelection: Selection;
    acceptedSelectionVerified: boolean;
    childRuntimeVersion?: string;
    observedAt?: string;
    actualModelVerified: false;
    tokenUsage: 'unknown';
};

const nativeChildObservations = new WeakMap<object, string>();
export function isNativeCodexChildObservation(value: unknown): value is CodexChildThreadObservation {
    return !!value && typeof value === 'object' && nativeChildObservations.get(value) === JSON.stringify(value);
}

function record(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
    return value as Record<string, unknown>;
}

function boundedText(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error(`${name} is invalid`);
    return value;
}

/** Only call on a result obtained from native `thread/read` with includeTurns.
 * A child with a completed turn proves native child execution and exposes its
 * persisted configuration, but not the accepted per-turn or backend model. */
export function normalizeCodexChildThreadObservation(value: unknown, expectedParentThreadId: string): CodexChildThreadObservation {
    const parent = boundedText(expectedParentThreadId, 'expected parent thread id');
    const response = record(value, 'Codex thread/read response');
    const thread = record(response.thread, 'Codex child thread');
    const childThreadId = boundedText(thread.id, 'Codex child thread id');
    const parentThreadId = boundedText(thread.parentThreadId, 'Codex parent thread id');
    if (parentThreadId !== parent || childThreadId === parent) throw new Error('Codex child parent thread mismatch');
    const model = boundedText(thread.model, 'Codex child configured model');
    const effort = boundedText(thread.reasoningEffort, 'Codex child configured effort');
    if (!Array.isArray(thread.turns) || thread.turns.length === 0 || thread.turns.length > 256) throw new Error('Codex child turns are invalid');
    const completed = thread.turns.find((raw: unknown) => {
        const turn = record(raw, 'Codex child turn');
        boundedText(turn.id, 'Codex child turn id');
        if (!Array.isArray(turn.items) || turn.items.length > 4096) throw new Error('Codex child turn items are invalid');
        if (typeof turn.status !== 'string') throw new Error('Codex child turn status is invalid');
        return turn.status === 'completed';
    });
    if (!completed) throw new Error('Codex child has no completed turn');
    return { provenance: 'codex-app-server-thread-read', parentThreadId, childThreadId, turnId: completed.id,
        nativeDispatchVerified: true, configuredSelection: { selector: { kind: 'model', id: model }, effort: { kind: 'explicit', value: effort } },
        acceptedSelectionVerified: false, actualModelVerified: false, tokenUsage: 'unknown' };
}

/** Normalize only the provider's catalog. This cannot attest dispatch or actual backend identity. */
export function normalizeCodexModelCatalog(value: unknown): CodexCatalogDiscovery {
    const response = record(value, 'Codex model/list response');
    if (!Array.isArray(response.data) || response.data.length > 256) throw new Error('Codex model catalog is invalid');
    const selections: Selection[] = [];
    const modelIds = new Set<string>();
    const selectionKeys = new Set<string>();
    for (const [index, raw] of response.data.entries()) {
        const model = record(raw, `Codex model[${index}]`);
        const catalogId = boundedText(model.id, `Codex model[${index}].id`);
        const slug = boundedText(model.model, `Codex model[${index}].model`);
        if (modelIds.has(catalogId)) throw new Error(`Codex catalog contains duplicate model id ${catalogId}`);
        modelIds.add(catalogId);
        if (typeof model.hidden !== 'boolean') throw new Error(`Codex model[${index}].hidden is invalid`);
        if (!Array.isArray(model.supportedReasoningEfforts) || model.supportedReasoningEfforts.length > 20) throw new Error(`Codex model[${index}] supported efforts are invalid`);
        if (model.hidden) continue;
        for (const [effortIndex, rawEffort] of model.supportedReasoningEfforts.entries()) {
            const option = record(rawEffort, `Codex model[${index}] effort[${effortIndex}]`);
            const effort = boundedText(option.reasoningEffort, `Codex model[${index}] effort[${effortIndex}]`);
            boundedText(option.description, `Codex model[${index}] effort description`);
            const key = `${slug}\0${effort}`;
            if (selectionKeys.has(key)) throw new Error(`Codex catalog contains duplicate selection ${slug}/${effort}`);
            selectionKeys.add(key);
            selections.push({ selector: { kind: 'model', id: slug }, effort: { kind: 'explicit', value: effort } });
        }
    }
    return { provenance: 'native-catalog', selections, nativeDispatchVerified: false, actualModelVerified: false };
}

export type CodexCatalogQuery = { command: string; args: string[]; timeoutMs: number };

export type CodexChildThreadQuery = CodexCatalogQuery & { parentThreadId: string; childThreadId: string; codexHome?: string };

/** Explicit, read-only native observation of an existing child. It never starts
 * a thread or turn, and only returns the bounded normalized fields. */
export function queryCodexChildThreadObservation(input: CodexChildThreadQuery): Promise<CodexChildThreadObservation> {
    if (!input || typeof input !== 'object' || typeof input.command !== 'string' || input.command.length === 0 || input.command.length > 4096
        || !Array.isArray(input.args) || input.args.length > 16 || input.args.some(arg => typeof arg !== 'string' || arg.length > 65536)
        || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30000) throw new Error('Codex child thread query is invalid');
    const parentThreadId = boundedText(input.parentThreadId, 'parent thread id');
    const childThreadId = boundedText(input.childThreadId, 'child thread id');
    if (parentThreadId === childThreadId) throw new Error('Codex child and parent thread ids must differ');
    return new Promise((resolve, reject) => {
        const child = spawn(input.command, input.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        let settled = false;
        let buffer = '';
        let expectedId = 1;
        const finish = (error?: Error, observed?: CodexChildThreadObservation): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            if (error) reject(error);
            else { nativeChildObservations.set(observed!, JSON.stringify(observed!)); resolve(observed!); }
        };
        const send = (request: unknown): void => { if (!settled) child.stdin.write(`${JSON.stringify(request)}\n`); };
        const timer = setTimeout(() => finish(new Error('Codex child thread query timed out')), input.timeoutMs);
        child.on('error', () => finish(new Error('Codex app-server could not be started')));
        child.stdin.on('error', () => finish(new Error('Codex app-server input failed')));
        child.on('exit', () => finish(new Error('Codex app-server exited before thread/read response')));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            if (settled) return;
            buffer += chunk;
            if (buffer.length > 2 * 1024 * 1024) return finish(new Error('Codex thread/read response exceeds 2 MiB'));
            for (;;) {
                const end = buffer.indexOf('\n');
                if (end < 0 || settled) break;
                const line = buffer.slice(0, end).trim();
                buffer = buffer.slice(end + 1);
                if (!line) continue;
                let message: Record<string, unknown>;
                try { message = record(JSON.parse(line), 'Codex protocol response'); }
                catch { return finish(new Error('Codex protocol returned invalid JSON')); }
                if (message.id === undefined) continue;
                if (message.id !== expectedId) return finish(new Error('Codex protocol response id mismatch'));
                if (message.error !== undefined) return finish(new Error('Codex app-server rejected thread/read request'));
                if (expectedId === 1) {
                    try { record(message.result, 'Codex initialize result'); }
                    catch { return finish(new Error('Codex protocol initialize response is invalid')); }
                    send({ method: 'initialized' });
                    expectedId = 2;
                    send({ id: expectedId, method: 'thread/read', params: { threadId: childThreadId, includeTurns: true } });
                    continue;
                }
                try {
                    const result = normalizeCodexChildThreadObservation(message.result, parentThreadId);
                    if (result.childThreadId !== childThreadId) throw new Error('Codex child thread id mismatch');
                    if (input.codexHome === undefined) { finish(undefined, result); continue; }
                    const response = record(message.result, 'Codex thread/read result');
                    const thread = record(response.thread, 'Codex child thread');
                    if (typeof thread.path !== 'string') throw new Error('Codex child rollout path is unavailable');
                    const turn = readCodexRolloutSelection({ codexHome: input.codexHome, file: thread.path,
                        expected: { parentThreadId, childThreadId, turnId: result.turnId } });
                    if (turn.configuredSelection.selector.id !== result.configuredSelection.selector.id
                        || turn.configuredSelection.effort.kind !== result.configuredSelection.effort.kind
                        || (turn.configuredSelection.effort.kind === 'explicit' && result.configuredSelection.effort.kind === 'explicit'
                            && turn.configuredSelection.effort.value !== result.configuredSelection.effort.value)) throw new Error('Codex child selection changed after the observed turn');
                    finish(undefined, { ...result, configuredSelection: turn.configuredSelection, acceptedSelectionVerified: true, childRuntimeVersion: turn.cliVersion, observedAt: turn.observedAt });
                } catch (error) { finish(error as Error); }
            }
        });
        send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'awm', title: 'AWM native observation', version: '1.0.0' } } });
    });
}

/** Explicit no-inference App Server discovery. Never invoked by doctor/preflight. */
export function queryCodexModelCatalog(input: CodexCatalogQuery): Promise<CodexCatalogDiscovery> {
    if (!input || typeof input !== 'object'
        || typeof input.command !== 'string' || input.command.length === 0 || input.command.length > 4096
        || !Array.isArray(input.args) || input.args.length > 16
        || input.args.some(arg => typeof arg !== 'string' || arg.length > 65536)
        || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30000) {
        throw new Error('Codex catalog query is invalid');
    }
    return new Promise((resolve, reject) => {
        const child = spawn(input.command, input.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        let settled = false;
        let buffer = '';
        let nextRequestId = 2;
        let pendingRequestId = 1;
        let pages = 0;
        const models: unknown[] = [];
        const finish = (error?: Error, result?: CodexCatalogDiscovery): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            if (error) reject(error);
            else resolve(result!);
        };
        const send = (message: unknown): void => {
            if (settled) return;
            child.stdin.write(`${JSON.stringify(message)}\n`);
        };
        const timer = setTimeout(() => finish(new Error('Codex catalog query timed out')), input.timeoutMs);
        child.on('error', () => finish(new Error('Codex app-server could not be started')));
        child.stdin.on('error', () => finish(new Error('Codex app-server input failed')));
        child.on('exit', () => finish(new Error('Codex app-server exited before catalog response')));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            if (settled) return;
            buffer += chunk;
            if (buffer.length > 2 * 1024 * 1024) return finish(new Error('Codex protocol response exceeds 2 MiB'));
            for (;;) {
                const end = buffer.indexOf('\n');
                if (end < 0 || settled) break;
                const line = buffer.slice(0, end).trim();
                buffer = buffer.slice(end + 1);
                if (!line) continue;
                let message: Record<string, unknown>;
                try { message = record(JSON.parse(line), 'Codex protocol response'); }
                catch { return finish(new Error('Codex protocol returned invalid JSON')); }
                if (message.id === undefined) continue; // asynchronous notification
                if (message.id !== pendingRequestId) return finish(new Error('Codex protocol response id mismatch'));
                if (message.error !== undefined) return finish(new Error('Codex app-server rejected catalog request'));
                if (pendingRequestId === 1) {
                    try { record(message.result, 'Codex initialize result'); }
                    catch { return finish(new Error('Codex protocol initialize response is invalid')); }
                    send({ method: 'initialized' });
                    pendingRequestId = nextRequestId++;
                    send({ id: pendingRequestId, method: 'model/list', params: { includeHidden: false, limit: 100 } });
                    continue;
                }
                let page: Record<string, unknown>;
                try { page = record(message.result, 'Codex model/list result'); }
                catch { return finish(new Error('Codex protocol model/list response is invalid')); }
                if (!Array.isArray(page.data)) return finish(new Error('Codex protocol model/list data is invalid'));
                models.push(...page.data);
                pages += 1;
                if (models.length > 256 || pages > 8) return finish(new Error('Codex model catalog exceeds discovery limit'));
                if (page.nextCursor === null || page.nextCursor === undefined) {
                    try { finish(undefined, normalizeCodexModelCatalog({ data: models })); }
                    catch (error) { finish(error as Error); }
                    continue;
                }
                if (typeof page.nextCursor !== 'string' || page.nextCursor.length === 0 || page.nextCursor.length > 1024) return finish(new Error('Codex protocol cursor is invalid'));
                pendingRequestId = nextRequestId++;
                send({ id: pendingRequestId, method: 'model/list', params: { includeHidden: false, limit: 100, cursor: page.nextCursor } });
            }
        });
        send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'awm', title: 'AWM discovery', version: '1.0.0' } } });
    });
}
