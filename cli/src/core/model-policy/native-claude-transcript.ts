import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { secureFs } from '../secure-fs/native-bridge';

const MAX_BYTES = 16 * 1024 * 1024;
const ASSISTANT_LINE = /"type"\s*:\s*"assistant"/;
export type ClaudeTranscriptObservation = { provenance: 'claude-subagent-transcript'; agentId: string; actualModel: string; observedAt: string; evidenceDigest: string; tokenUsage: 'unknown' };
const observedTranscripts = new WeakMap<object, string>();
export function isNativeClaudeTranscriptObservation(value: unknown): value is ClaudeTranscriptObservation {
    return !!value && typeof value === 'object' && observedTranscripts.get(value) === JSON.stringify(value);
}

/** Private JSONL format: any format change or mixed-model trace fails closed.
 * Usage is deliberately unknown because repeated assistant chunks can duplicate
 * the provider usage object. No prompt or transcript text is returned. */
export function readClaudeSubagentTranscript(input: { configDir: string; file: string; agentId: string }): ClaudeTranscriptObservation {
    if (!input || typeof input !== 'object' || typeof input.configDir !== 'string' || typeof input.file !== 'string'
        || !path.isAbsolute(input.configDir) || !path.isAbsolute(input.file) || path.normalize(input.configDir) !== input.configDir
        || path.normalize(input.file) !== input.file || input.configDir.includes('\0') || input.file.includes('\0')
        || typeof input.agentId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.agentId)) throw new Error('Claude transcript identity or paths are invalid');
    const relative = path.relative(input.configDir, input.file);
    const segments = relative.split(path.sep);
    if (segments.length < 5 || segments[0] !== 'projects' || segments[segments.length - 2] !== 'subagents'
        || segments[segments.length - 1] !== `agent-${input.agentId}.jsonl`
        || segments.some(segment => segment === '..' || segment === '')) throw new Error('Claude transcript is outside the native subagents tree');
    for (let dir = path.dirname(input.file); ; dir = path.dirname(dir)) {
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Claude transcript has an unsafe or symlinked ancestor');
        if (dir === input.configDir) break;
        if (dir === path.dirname(dir)) throw new Error('Claude config root is invalid');
    }
    const stat = fs.lstatSync(input.file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Claude transcript is unsafe or symlinked');
    const bytes = secureFs.readRegularFile(input.file, MAX_BYTES).bytes;
    const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\n');
    let actualModel: string | undefined;
    let observedAt: string | undefined;
    let count = 0;
    for (const line of lines) {
        if (!ASSISTANT_LINE.test(line)) continue;
        if (line.length > 256 * 1024 || ++count > 10000) throw new Error('Claude transcript assistant metadata exceeds limit');
        const event = JSON.parse(line) as unknown;
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Claude transcript assistant event is invalid');
        const item = event as Record<string, unknown>;
        if (item.type !== 'assistant' || !item.message || typeof item.message !== 'object' || Array.isArray(item.message)) throw new Error('Claude transcript assistant event is invalid');
        const model = (item.message as Record<string, unknown>).model;
        if (typeof model !== 'string' || model.length === 0 || model.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(model)) throw new Error('Claude transcript model is invalid');
        if (actualModel !== undefined && actualModel !== model) throw new Error('Claude transcript contains mixed or multiple models');
        if (typeof item.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(item.timestamp)
            || !Number.isFinite(Date.parse(item.timestamp))) throw new Error('Claude transcript timestamp is invalid');
        actualModel = model;
        const time = new Date(item.timestamp).toISOString();
        if (!observedAt || time > observedAt) observedAt = time;
    }
    if (!actualModel || !observedAt) throw new Error('Claude transcript has no assistant model evidence');
    const result: ClaudeTranscriptObservation = { provenance: 'claude-subagent-transcript', agentId: input.agentId, actualModel, observedAt,
        evidenceDigest: createHash('sha256').update(bytes).digest('hex'), tokenUsage: 'unknown' };
    observedTranscripts.set(result, JSON.stringify(result));
    return result;
}
