import type { Selection } from './types';
import { spawn } from 'child_process';

export type CodexCatalogDiscovery = {
    provenance: 'native-catalog';
    selections: Selection[];
    nativeDispatchVerified: false;
    actualModelVerified: false;
};

function record(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
    return value as Record<string, unknown>;
}

function boundedText(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error(`${name} is invalid`);
    return value;
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
