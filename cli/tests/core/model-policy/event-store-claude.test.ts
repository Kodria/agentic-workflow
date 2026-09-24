import fs from 'fs';
import os from 'os';
import path from 'path';
import { claudeAgentIdDigest, publishClaudeObservation, readStoredEventReceipt } from '../../../src/core/model-policy/event-store';
import { ensureMachineKey } from '../../../src/core/model-policy/machine-key';
import { normalizeClaudeSubagentLifecycle } from '../../../src/core/model-policy/native-claude';
import { readClaudeSubagentTranscript } from '../../../src/core/model-policy/native-claude-transcript';
import { readClaudeAgentDeclaredModel } from '../../../src/core/model-policy/native-claude-agent-definition';

describe('Claude native event enrollment', () => {
    it('binds a matching hook pair and transcript; keeps an unchanged claim beyond 24 hours', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-claude-event-'));
        const previous = process.env.AWM_HOME; process.env.AWM_HOME = root;
        try {
            ensureMachineKey(root);
            const configDir = path.join(root, 'claude');
            const file = path.join(configDir, 'projects', 'p', 's', 'subagents', 'agent-agent-1.jsonl');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', timestamp: '2026-09-23T22:00:00.000Z', message: { model: 'claude-sonnet-4-6', content: [] } })}\n`);
            fs.mkdirSync(path.join(configDir, 'agents'));
            fs.writeFileSync(path.join(configDir, 'agents', 'worker.md'), '---\nname: awm-worker\ndescription: Test worker\nmodel: claude-sonnet-4-6\n---\n');
            const start = { hook_event_name: 'SubagentStart', session_id: 'session-1', agent_id: 'agent-1', agent_type: 'awm-worker' };
            const stop = { hook_event_name: 'SubagentStop', session_id: 'session-1', agent_id: 'agent-1', agent_type: 'awm-worker', agent_transcript_path: file, stop_hook_active: false };
            const lifecycle = normalizeClaudeSubagentLifecycle(start, stop);
            const transcript = readClaudeSubagentTranscript({ configDir, file, agentId: 'agent-1' });
            const scope = { runtime: { target: 'claude-code' as const, kind: 'native', version: '2.1.0', accountScopeDigest: 'a'.repeat(64) }, binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64) };
            const expectedSelection = { selector: { kind: 'model' as const, id: 'claude-sonnet-4-6' }, effort: { kind: 'runtime-default' as const } };
            const input = { scope, lifecycle, transcript, expectedSelection, mappingDigest: 'd'.repeat(64), now: new Date('2026-09-23T22:01:00.000Z') };
            expect(() => publishClaudeObservation(input)).toThrow(/declared agent/i);
            const declaredAgent = readClaudeAgentDeclaredModel({ cwd: root, configDir, agentType: 'awm-worker' });
            const enrolled = { ...input, declaredAgent };
            const first = publishClaudeObservation(enrolled);
            expect(first.claims[0]).toMatchObject({ actualModel: { id: 'claude-sonnet-4-6' }, tokenUsage: 'unknown' });
            expect(publishClaudeObservation({ ...enrolled, now: new Date('2026-09-25T00:00:00.000Z') })).toEqual(first);
            expect(readStoredEventReceipt(scope.runtime)).toEqual({ state: 'present', receipt: first });
            expect(() => publishClaudeObservation({ ...enrolled, expectedSelection: { ...expectedSelection, selector: { kind: 'model', id: 'claude-opus-4-7' } } })).toThrow(/selection/i);
            expect(() => publishClaudeObservation({ ...enrolled, expectedSelection: { ...expectedSelection, effort: { kind: 'explicit', value: 'high' } as any } })).toThrow(/selection|effort/i);
            expect(() => publishClaudeObservation({ ...enrolled, lifecycle: { ...lifecycle } })).toThrow(/provenance/i);
            expect(() => publishClaudeObservation({ ...enrolled, declaredAgent: { ...declaredAgent } })).toThrow(/declared agent/i);
            const secondFile = path.join(configDir, 'projects', 'p', 's', 'subagents', 'agent-agent-2.jsonl');
            fs.writeFileSync(secondFile, `${JSON.stringify({ type: 'assistant', timestamp: '2026-09-23T22:02:00.000Z', message: { model: 'claude-sonnet-4-6', content: [] } })}\n`);
            const secondLifecycle = normalizeClaudeSubagentLifecycle(
                { ...start, agent_id: 'agent-2' }, { ...stop, agent_id: 'agent-2', agent_transcript_path: secondFile });
            const secondTranscript = readClaudeSubagentTranscript({ configDir, file: secondFile, agentId: 'agent-2' });
            const second = publishClaudeObservation({ ...enrolled, lifecycle: secondLifecycle, transcript: secondTranscript,
                now: new Date('2026-09-23T22:03:00.000Z') });
            expect(second.claims[0].nativeEvents).toEqual(expect.arrayContaining([
                expect.objectContaining({ nativeAgentIdDigest: claudeAgentIdDigest('agent-1', ensureMachineKey(root)) }),
                expect.objectContaining({ nativeAgentIdDigest: claudeAgentIdDigest('agent-2', ensureMachineKey(root)) }),
            ]));
        } finally { if (previous === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); }
    });
});
