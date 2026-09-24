import fs from 'fs';
import os from 'os';
import path from 'path';
import { publishCodexObservation, readStoredEventReceipt } from '../../../src/core/model-policy/event-store';
import { queryCodexChildThreadObservation, type CodexChildThreadObservation } from '../../../src/core/model-policy/native-codex';
import { ensureMachineKey } from '../../../src/core/model-policy/machine-key';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const c = 'c'.repeat(64);
const runtime = { target: 'codex' as const, kind: 'native', version: '0.156.1', accountScopeDigest: a };
const scope = { runtime, binaryDigest: b, configDigest: c };
const observation = (id: string) => ({ provenance: 'codex-app-server-thread-read' as const, parentThreadId: 'parent-1', childThreadId: `child-${id}`, turnId: `turn-${id}`, nativeDispatchVerified: true as const,
    configuredSelection: { selector: { kind: 'model' as const, id }, effort: { kind: 'explicit' as const, value: 'high' } }, acceptedSelectionVerified: true, childRuntimeVersion: '0.156.1', actualModelVerified: false as const, tokenUsage: 'unknown' as const });
const enrollment = (id: string, now: Date, native: CodexChildThreadObservation = observation(id)) => ({ scope, observation: native, expectedSelection: observation(id).configuredSelection, mappingDigest: a, now });

async function nativeObservation(id: string): Promise<CodexChildThreadObservation> {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-native-event-'));
    const file = path.join(home, 'sessions', 'rollout.jsonl');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, [
        { type: 'session_meta', payload: { id: `child-${id}`, source: { subagent: { thread_spawn: { parent_thread_id: 'parent-1' } } }, cli_version: '0.156.1' } },
        { timestamp: '2026-09-23T00:59:00.000Z', type: 'turn_context', payload: { turn_id: `turn-${id}`, model: id, effort: 'high' } },
    ].map(value => JSON.stringify(value)).join('\n'));
    const response = { thread: { id: `child-${id}`, parentThreadId: 'parent-1', model: id, reasoningEffort: 'high', path: file,
        turns: [{ id: `turn-${id}`, status: 'completed', items: [] }] } };
    const server = `
const readline = require('readline');
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');
  if (request.method === 'thread/read') process.stdout.write(JSON.stringify({ id: request.id, result: ${JSON.stringify(response)} }) + '\\n');
});`;
    try { return await queryCodexChildThreadObservation({ command: process.execPath, args: ['-e', server], timeoutMs: 5000, parentThreadId: 'parent-1', childThreadId: `child-${id}`, codexHome: home }); }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
}

describe('event-scoped capability store', () => {
    it('publishes native claims once and preserves a second selection without renewal', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-event-store-'));
        const previous = process.env.AWM_HOME; process.env.AWM_HOME = root;
        try {
            expect(readStoredEventReceipt(runtime)).toEqual({ state: 'absent' });
            ensureMachineKey(root);
            const luna = await nativeObservation('gpt-6-luna');
            const first = publishCodexObservation(enrollment('gpt-6-luna', new Date('2026-09-23T01:00:00.000Z'), luna));
            expect(first.claims).toHaveLength(1);
            const file = path.join(root, 'routing-capabilities-v2', 'codex', 'native.json');
            const before = fs.readFileSync(file);
            publishCodexObservation(enrollment('gpt-6-luna', new Date('2026-09-24T03:00:00.000Z'), luna));
            expect(fs.readFileSync(file)).toEqual(before);
            const second = publishCodexObservation(enrollment('gpt-6-sol', new Date('2026-09-23T01:00:00.000Z'), await nativeObservation('gpt-6-sol')));
            expect(second.claims).toHaveLength(2);
            const read = readStoredEventReceipt(runtime);
            expect(read.state).toBe('present');
            if (read.state !== 'present') throw new Error('expected a present receipt');
            expect(read.receipt.claims.map(item => item.selection.selector.id)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
        } finally { if (previous === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('fails closed on a symlinked destination', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-event-store-'));
        const previous = process.env.AWM_HOME; process.env.AWM_HOME = root;
        const file = path.join(root, 'routing-capabilities-v2', 'codex', 'native.json');
        ensureMachineKey(root);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const outside = path.join(root, 'outside.json'); fs.writeFileSync(outside, 'untouched'); fs.symlinkSync(outside, file);
        try {
            const native = await nativeObservation('gpt-6-luna');
            expect(() => publishCodexObservation(enrollment('gpt-6-luna', new Date('2026-09-23T01:00:00.000Z'), native))).toThrow(/symlink|unsafe/i);
            expect(fs.readFileSync(outside, 'utf8')).toBe('untouched');
        } finally { if (previous === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('refuses an unverified selection or a child from another runtime version', async () => {
        const native = await nativeObservation('gpt-6-luna');
        native.acceptedSelectionVerified = false;
        expect(() => publishCodexObservation(enrollment('gpt-6-luna', new Date('2026-09-23T01:00:00.000Z'), native))).toThrow(/native provenance/i);
        native.acceptedSelectionVerified = true;
        native.childRuntimeVersion = '0.156.0';
        expect(() => publishCodexObservation(enrollment('gpt-6-luna', new Date('2026-09-23T01:00:00.000Z'), native))).toThrow(/native provenance/i);
    });
    it('rejects a caller-authored accepted-looking observation without native provenance', () => {
        expect(() => publishCodexObservation(enrollment('gpt-6-luna', new Date('2026-09-23T01:00:00.000Z')))).toThrow(/native provenance/i);
    });
    it('rejects an old native turn for a new enrollment but retains an already stored claim after 25 hours', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-event-store-'));
        const previous = process.env.AWM_HOME; process.env.AWM_HOME = root;
        try {
            ensureMachineKey(root);
            const native = await nativeObservation('gpt-6-luna');
            expect(() => publishCodexObservation(enrollment('gpt-6-luna', new Date('2026-09-24T03:00:00.000Z'), native))).toThrow(/fresh/i);
            const first = publishCodexObservation(enrollment('gpt-6-luna', new Date('2026-09-23T01:00:00.000Z'), native));
            const later = publishCodexObservation(enrollment('gpt-6-luna', new Date('2026-09-24T03:00:00.000Z'), native));
            expect(later).toEqual(first);
        } finally { if (previous === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('rejects a forged on-disk claim even if its JSON shape and digests look valid', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-event-store-'));
        const previous = process.env.AWM_HOME; process.env.AWM_HOME = root;
        try {
            ensureMachineKey(root);
            publishCodexObservation(enrollment('gpt-6-luna', new Date('2026-09-23T01:00:00.000Z'), await nativeObservation('gpt-6-luna')));
            const file = path.join(root, 'routing-capabilities-v2', 'codex', 'native.json');
            const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
            envelope.receipt.claims[0].selection.selector.id = 'gpt-6-astra';
            fs.writeFileSync(file, JSON.stringify(envelope));
            expect(readStoredEventReceipt(runtime)).toMatchObject({ state: 'invalid' });
        } finally { if (previous === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); }
    });
});
