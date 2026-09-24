import fs from 'fs';
import os from 'os';
import path from 'path';
import { normalizeCodexChildThreadObservation, normalizeCodexModelCatalog, normalizeCodexRolloutSelection, queryCodexChildThreadObservation, queryCodexModelCatalog } from '../../../src/core/model-policy/native-codex';

describe('Codex native model discovery', () => {
    const response = () => ({
        data: [
            { id: 'gpt-6-sol', model: 'gpt-6-sol', hidden: false, isDefault: true,
                defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
                    { reasoningEffort: 'medium', description: 'balanced' },
                    { reasoningEffort: 'high', description: 'deep' },
                ] },
        ], nextCursor: null,
    });

    it('normalizes catalog selections without certifying dispatch or actual model identity', () => {
        expect(normalizeCodexModelCatalog(response())).toEqual({
            provenance: 'native-catalog',
            selections: [
                { selector: { kind: 'model', id: 'gpt-6-sol' }, effort: { kind: 'explicit', value: 'medium' } },
                { selector: { kind: 'model', id: 'gpt-6-sol' }, effort: { kind: 'explicit', value: 'high' } },
            ],
            nativeDispatchVerified: false,
            actualModelVerified: false,
        });
    });

    it('rejects malformed and duplicate native catalog data instead of inventing selections', () => {
        expect(() => normalizeCodexModelCatalog({ data: [{ ...response().data[0], model: '' }] })).toThrow(/model/i);
        expect(() => normalizeCodexModelCatalog({ data: [response().data[0], response().data[0]] })).toThrow(/duplicate/i);
        expect(() => normalizeCodexModelCatalog({ data: [
            { ...response().data[0], supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
        ] })).toThrow(/effort/i);
    });

    it('reads the native model/list protocol without starting a model turn', async () => {
        const server = `
const readline = require('readline');
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: { userAgent: 'fake' } }) + '\\n');
  if (request.method === 'model/list') process.stdout.write(JSON.stringify({ id: request.id, result: ${JSON.stringify(response())} }) + '\\n');
});`;
        const result = await queryCodexModelCatalog({ command: process.execPath, args: ['-e', server], timeoutMs: 5000 });
        expect(result.selections).toHaveLength(2);
        expect(result.nativeDispatchVerified).toBe(false);
    });

    it('fails closed on an invalid native response', async () => {
        const server = `process.stdin.on('data', () => process.stdout.write('not-json\\n'));`;
        await expect(queryCodexModelCatalog({ command: process.execPath, args: ['-e', server], timeoutMs: 5000 })).rejects.toThrow(/protocol|JSON/i);
    });

    it('separates real child dispatch from configured selection and backend identity', () => {
        const child = { thread: { id: 'child-1', parentThreadId: 'parent-1', model: 'gpt-6-sol', reasoningEffort: 'low', turns: [{ id: 'turn-1', status: 'completed', items: [] }] } };
        expect(normalizeCodexChildThreadObservation(child, 'parent-1')).toEqual({
            provenance: 'codex-app-server-thread-read', parentThreadId: 'parent-1', childThreadId: 'child-1', turnId: 'turn-1',
            nativeDispatchVerified: true, configuredSelection: { selector: { kind: 'model', id: 'gpt-6-sol' }, effort: { kind: 'explicit', value: 'low' } },
            acceptedSelectionVerified: false, actualModelVerified: false, tokenUsage: 'unknown',
        });
    });

    it('rejects a parent mismatch and refuses to promote a child with no turn', () => {
        const child = { thread: { id: 'child-1', parentThreadId: 'parent-1', model: 'gpt-6-sol', reasoningEffort: 'low', turns: [{ id: 'turn-1', status: 'completed', items: [] }] } };
        expect(() => normalizeCodexChildThreadObservation(child, 'parent-2')).toThrow(/parent/i);
        expect(() => normalizeCodexChildThreadObservation({ thread: { ...child.thread, turns: [] } }, 'parent-1')).toThrow(/turn/i);
        expect(() => normalizeCodexChildThreadObservation({ thread: { ...child.thread, model: null } }, 'parent-1')).toThrow(/model/i);
    });

    it('reads an actual child thread through native thread/read without sending a turn', async () => {
        const observed = { thread: { id: 'child-1', parentThreadId: 'parent-1', model: 'gpt-6-sol', reasoningEffort: 'low', turns: [{ id: 'turn-1', status: 'completed', items: [] }] } };
        const server = `
const readline = require('readline');
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: { userAgent: 'fake' } }) + '\\n');
  if (request.method === 'thread/read') {
    if (request.params.threadId !== 'child-1' || request.params.includeTurns !== true) process.exit(13);
    process.stdout.write(JSON.stringify({ id: request.id, result: ${JSON.stringify(observed)} }) + '\\n');
  }
  if (request.method === 'turn/start' || request.method === 'thread/start') process.exit(14);
});`;
        const result = await queryCodexChildThreadObservation({ command: process.execPath, args: ['-e', server], timeoutMs: 5000, parentThreadId: 'parent-1', childThreadId: 'child-1' });
        expect(result).toMatchObject({ nativeDispatchVerified: true, acceptedSelectionVerified: false, actualModelVerified: false, configuredSelection: { selector: { id: 'gpt-6-sol' } } });
    });

    it('binds an immutable turn context to the observed child, parent and turn', () => {
        const events = [
            { type: 'session_meta', payload: { id: 'child-1', source: { subagent: { thread_spawn: { parent_thread_id: 'parent-1' } } }, cli_version: '0.156.1' } },
            { timestamp: '2026-09-23T20:00:00.000Z', type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-6-luna', effort: 'high' } },
        ];
        expect(normalizeCodexRolloutSelection(events, { parentThreadId: 'parent-1', childThreadId: 'child-1', turnId: 'turn-1' })).toEqual({
            provenance: 'codex-rollout-turn-context', cliVersion: '0.156.1', observedAt: '2026-09-23T20:00:00.000Z',
            configuredSelection: { selector: { kind: 'model', id: 'gpt-6-luna' }, effort: { kind: 'explicit', value: 'high' } },
            actualModelVerified: false,
        });
    });

    it('rejects unrelated parent, child and turn contexts', () => {
        const events = [
            { type: 'session_meta', payload: { id: 'child-1', source: { subagent: { thread_spawn: { parent_thread_id: 'parent-1' } } }, cli_version: '0.156.1' } },
            { timestamp: '2026-09-23T20:00:00.000Z', type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-6-luna', effort: 'high' } },
        ];
        expect(() => normalizeCodexRolloutSelection(events, { parentThreadId: 'other', childThreadId: 'child-1', turnId: 'turn-1' })).toThrow(/parent/i);
        expect(() => normalizeCodexRolloutSelection(events, { parentThreadId: 'parent-1', childThreadId: 'other', turnId: 'turn-1' })).toThrow(/child/i);
        expect(() => normalizeCodexRolloutSelection(events, { parentThreadId: 'parent-1', childThreadId: 'child-1', turnId: 'other' })).toThrow(/turn/i);
        expect(() => normalizeCodexRolloutSelection([...events, events[1]], { parentThreadId: 'parent-1', childThreadId: 'child-1', turnId: 'turn-1' })).toThrow(/duplicate/i);
        expect(() => normalizeCodexRolloutSelection([{ ...events[0] }, { ...events[1], timestamp: undefined }], { parentThreadId: 'parent-1', childThreadId: 'child-1', turnId: 'turn-1' })).toThrow(/timestamp/i);
    });

    it('attests the configured selection at the completed native turn only with matching rollout provenance', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-observe-'));
        const file = path.join(home, 'sessions', 'rollout.jsonl');
        fs.mkdirSync(path.dirname(file));
        fs.writeFileSync(file, [
            { type: 'session_meta', payload: { id: 'child-1', source: { subagent: { thread_spawn: { parent_thread_id: 'parent-1' } } }, cli_version: '0.156.1' } },
            { timestamp: '2026-09-23T20:00:00.000Z', type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-6-luna', effort: 'high' } },
        ].map(value => JSON.stringify(value)).join('\n'));
        const observed = { thread: { id: 'child-1', parentThreadId: 'parent-1', model: 'gpt-6-luna', reasoningEffort: 'high', path: file, turns: [{ id: 'turn-1', status: 'completed', items: [] }] } };
        const server = `
const readline = require('readline');
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');
  if (request.method === 'thread/read') process.stdout.write(JSON.stringify({ id: request.id, result: ${JSON.stringify(observed)} }) + '\\n');
});`;
        try {
            const result = await queryCodexChildThreadObservation({ command: process.execPath, args: ['-e', server], timeoutMs: 5000, parentThreadId: 'parent-1', childThreadId: 'child-1', codexHome: home });
            expect(result).toMatchObject({ acceptedSelectionVerified: true, childRuntimeVersion: '0.156.1', configuredSelection: { selector: { id: 'gpt-6-luna' }, effort: { value: 'high' } }, actualModelVerified: false });
        } finally { fs.rmSync(home, { recursive: true, force: true }); }
    });
});
