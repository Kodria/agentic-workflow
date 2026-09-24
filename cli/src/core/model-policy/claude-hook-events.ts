import { createHash, createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { awmHome } from '../paths';
import { parseJsonNoDuplicate } from '../plan/json';
import { secureFs } from '../secure-fs/native-bridge';
import { readMachineKey } from './machine-key';
import { normalizeClaudeSubagentLifecycle, type ClaudeSubagentLifecycle } from './native-claude';

const DOMAIN = 'AWM Claude hook start/v1\0';
const MAX_BYTES = 8192;
type HookStart = { hook_event_name: 'SubagentStart'; session_id: string; agent_id: string; agent_type: string; recorded_at: string };

function id(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`${label} is invalid`);
    return value;
}
function event(value: unknown, kind: 'SubagentStart' | 'SubagentStop'): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).hook_event_name !== kind) throw new Error(`Claude ${kind} hook is invalid`);
    const row = value as Record<string, unknown>;
    id(row.session_id, 'Claude session id'); id(row.agent_id, 'Claude agent id');
    if (typeof row.agent_type !== 'string' || row.agent_type.length === 0 || row.agent_type.length > 128
        || /[\u0000-\u001f\u007f-\u009f]/.test(row.agent_type)) throw new Error('Claude agent type is invalid');
    return row;
}
function fileFor(sessionId: string, agentId: string): string {
    const digest = createHash('sha256').update(`${sessionId}\0${agentId}`).digest('hex');
    return path.join(awmHome(), 'claude-hook-starts', `${digest}.json`);
}
function mac(value: HookStart, key: Buffer): string { return createHmac('sha256', key).update(DOMAIN).update(JSON.stringify(value)).digest('hex'); }
function safeDirectory(dir: string, create: boolean): void {
    const chain: string[] = [];
    for (let current = dir; ; current = path.dirname(current)) { chain.unshift(current); if (current === path.dirname(current)) break; }
    for (const item of chain) {
        try { const stat = fs.lstatSync(item); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Claude hook event has unsafe ancestor'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error;
            fs.mkdirSync(item, { mode: 0o700 });
        }
    }
}

/** Persist bounded hook identity only; never a prompt, transcript or account ID. */
export function recordClaudeHookStart(value: unknown, now: Date): void {
    const row = event(value, 'SubagentStart');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Claude hook clock is invalid');
    const root = awmHome(); const key = readMachineKey(root);
    if (!key) throw new Error('Claude hook enrollment requires explicit machine setup');
    const start: HookStart = { hook_event_name: 'SubagentStart', session_id: row.session_id as string, agent_id: row.agent_id as string,
        agent_type: row.agent_type as string, recorded_at: now.toISOString() };
    const file = fileFor(start.session_id, start.agent_id);
    secureFs.withProjectLease(root, () => {
        safeDirectory(path.dirname(file), true);
        const content = Buffer.from(`${JSON.stringify({ start, mac: mac(start, key) })}\n`);
        let observed: ReturnType<typeof secureFs.readRegularFile> | null = null;
        try {
            const stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Claude hook start is unsafe');
            observed = secureFs.readRegularFile(file, MAX_BYTES);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        secureFs.writeProjectTransaction(root, path.relative(root, file).split(path.sep).join('/'), content,
            observed ? { mode: 'replace', createParents: false, expected: observed.bytes, expectedIdentity: observed.identity } : { mode: 'create', createParents: false });
    });
}

/** Link Stop to a sealed Start event on this machine. Pending events expire
 * after one day; this is not the capability receipt lifetime. */
export function readClaudeHookPair(stopValue: unknown, now: Date): { lifecycle: ClaudeSubagentLifecycle; transcriptPath: string } {
    const stop = event(stopValue, 'SubagentStop');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Claude hook clock is invalid');
    const key = readMachineKey(awmHome());
    if (!key) throw new Error('Claude hook machine key is missing');
    const file = fileFor(stop.session_id as string, stop.agent_id as string);
    safeDirectory(path.dirname(file), false);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Claude hook start is unsafe');
    const parsed = parseJsonNoDuplicate(new TextDecoder('utf-8', { fatal: true }).decode(secureFs.readRegularFile(file, MAX_BYTES).bytes)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Claude hook start envelope is invalid');
    const envelope = parsed as Record<string, unknown>;
    if (Object.keys(envelope).length !== 2 || typeof envelope.mac !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.mac)
        || !envelope.start || typeof envelope.start !== 'object' || Array.isArray(envelope.start)) throw new Error('Claude hook start seal is invalid');
    const start = envelope.start as HookStart;
    if (Object.keys(start).length !== 5 || start.hook_event_name !== 'SubagentStart' || typeof start.recorded_at !== 'string'
        || !Number.isFinite(Date.parse(start.recorded_at)) || start.session_id !== stop.session_id || start.agent_id !== stop.agent_id)
        throw new Error('Claude hook start identity is invalid');
    if (!timingSafeEqual(Buffer.from(envelope.mac, 'hex'), Buffer.from(mac(start, key), 'hex'))) throw new Error('Claude hook start seal does not match');
    const ageMs = now.getTime() - Date.parse(start.recorded_at);
    if (ageMs < 0 || ageMs > 24 * 60 * 60 * 1000) throw new Error('Claude hook start is stale');
    const lifecycle = normalizeClaudeSubagentLifecycle(start, stop);
    return { lifecycle, transcriptPath: stop.agent_transcript_path as string };
}
