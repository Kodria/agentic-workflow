import fs from 'fs';
import path from 'path';
import { secureFs } from '../secure-fs/native-bridge';
import type { Selection } from './types';

export type CodexRolloutSelection = {
    provenance: 'codex-rollout-turn-context';
    cliVersion: string;
    observedAt: string;
    configuredSelection: Selection;
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

/** Normalize only the two metadata records from a locally verified Codex
 * rollout. The private format is version-sensitive; unknown shapes remain
 * UNTESTED rather than being promoted from thread configuration. */
export function normalizeCodexRolloutSelection(events: unknown, expected: { parentThreadId: string; childThreadId: string; turnId: string }): CodexRolloutSelection {
    if (!expected || typeof expected !== 'object') throw new Error('Codex rollout identity is required');
    const parentThreadId = boundedText(expected.parentThreadId, 'Codex parent thread id');
    const childThreadId = boundedText(expected.childThreadId, 'Codex child thread id');
    const turnId = boundedText(expected.turnId, 'Codex turn id');
    if (!Array.isArray(events) || events.length === 0 || events.length > 10000) throw new Error('Codex rollout events are invalid');
    let cliVersion: string | undefined;
    let selection: Selection | undefined;
    let observedAt: string | undefined;
    for (const raw of events) {
        const event = record(raw, 'Codex rollout event');
        if (event.type === 'session_meta') {
            if (cliVersion !== undefined) throw new Error('Codex rollout has duplicate session metadata');
            const payload = record(event.payload, 'Codex session metadata');
            if (boundedText(payload.id, 'Codex metadata child id') !== childThreadId) throw new Error('Codex rollout child id mismatch');
            const source = record(payload.source, 'Codex session source');
            const subagent = record(source.subagent, 'Codex subagent source');
            const spawn = record(subagent.thread_spawn, 'Codex thread spawn source');
            if (boundedText(spawn.parent_thread_id, 'Codex metadata parent id') !== parentThreadId) throw new Error('Codex rollout parent id mismatch');
            cliVersion = boundedText(payload.cli_version, 'Codex rollout CLI version');
            if (!/^\d+\.\d+\.\d+$/.test(cliVersion)) throw new Error('Codex rollout CLI version is invalid');
        }
        if (event.type === 'turn_context') {
            const payload = record(event.payload, 'Codex turn context');
            if (boundedText(payload.turn_id, 'Codex turn context id') !== turnId) continue;
            if (selection !== undefined) throw new Error('Codex rollout has duplicate turn context');
            if (typeof event.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(event.timestamp)
                || !Number.isFinite(Date.parse(event.timestamp))) throw new Error('Codex turn timestamp is invalid');
            observedAt = new Date(event.timestamp).toISOString();
            selection = { selector: { kind: 'model', id: boundedText(payload.model, 'Codex turn model') },
                effort: { kind: 'explicit', value: boundedText(payload.effort, 'Codex turn effort') } };
        }
    }
    if (cliVersion === undefined) throw new Error('Codex rollout session metadata is missing');
    if (selection === undefined || observedAt === undefined) throw new Error('Codex rollout turn context is missing');
    return { provenance: 'codex-rollout-turn-context', cliVersion, observedAt, configuredSelection: selection, actualModelVerified: false };
}

const MAX_ROLLOUT_BYTES = 16 * 1024 * 1024;
const METADATA_LINE = /"type"\s*:\s*"(?:session_meta|turn_context)"/;

export type CodexRolloutRead = {
    codexHome: string;
    file: string;
    expected: { parentThreadId: string; childThreadId: string; turnId: string };
};

/** Read only the validated local Codex sessions tree; return no transcript or
 * account data. A private-format change fails closed as UNTESTED to callers. */
export function readCodexRolloutSelection(input: CodexRolloutRead): CodexRolloutSelection {
    if (!input || typeof input !== 'object' || typeof input.codexHome !== 'string' || typeof input.file !== 'string'
        || !path.isAbsolute(input.codexHome) || !path.isAbsolute(input.file)
        || path.normalize(input.codexHome) !== input.codexHome || path.normalize(input.file) !== input.file
        || input.codexHome.includes('\0') || input.file.includes('\0')) throw new Error('Codex rollout paths are invalid');
    const sessions = path.join(input.codexHome, 'sessions');
    const relative = path.relative(sessions, input.file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Codex rollout is outside sessions');
    for (let candidate = path.dirname(input.file); ; candidate = path.dirname(candidate)) {
        const stat = fs.lstatSync(candidate);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Codex rollout has an unsafe or symlinked ancestor');
        if (candidate === input.codexHome) break;
        if (candidate === path.dirname(candidate)) throw new Error('Codex rollout root is invalid');
    }
    const stat = fs.lstatSync(input.file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Codex rollout is unsafe or symlinked');
    const bytes = secureFs.readRegularFile(input.file, MAX_ROLLOUT_BYTES).bytes;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const events: unknown[] = [];
    for (const line of text.split('\n')) {
        if (!METADATA_LINE.test(line)) continue;
        if (line.length > 256 * 1024) throw new Error('Codex rollout metadata line exceeds 256 KiB');
        events.push(JSON.parse(line) as unknown);
        if (events.length > 10000) throw new Error('Codex rollout has too many metadata events');
    }
    return normalizeCodexRolloutSelection(events, input.expected);
}
