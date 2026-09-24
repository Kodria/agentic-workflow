import fs from 'fs';
import os from 'os';
import path from 'path';
import { recordClaudeHookStart, readClaudeHookPair } from '../../../src/core/model-policy/claude-hook-events';
import { ensureMachineKey } from '../../../src/core/model-policy/machine-key';

describe('sealed Claude hook pair', () => {
    const start = { hook_event_name: 'SubagentStart', session_id: 'session-1', agent_id: 'agent-1', agent_type: 'plugin:reviewer' };
    const stop = { hook_event_name: 'SubagentStop', session_id: 'session-1', agent_id: 'agent-1', agent_type: 'plugin:reviewer',
        agent_transcript_path: '/tmp/agent-1.jsonl', stop_hook_active: false };
    it('links start/stop without storing prompt text, rejects tampering and stale pending events', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-claude-hook-'));
        const previous = process.env.AWM_HOME; process.env.AWM_HOME = root;
        try {
            ensureMachineKey(root);
            recordClaudeHookStart({ ...start, prompt: 'private prompt' }, new Date('2026-09-23T22:00:00.000Z'));
            const file = path.join(root, 'claude-hook-starts', fs.readdirSync(path.join(root, 'claude-hook-starts'))[0]);
            expect(fs.readFileSync(file, 'utf8')).not.toContain('private prompt');
            const pair = readClaudeHookPair(stop, new Date('2026-09-23T22:01:00.000Z'));
            expect(pair.lifecycle).toMatchObject({ sessionId: 'session-1', agentId: 'agent-1' });
            expect(() => readClaudeHookPair(stop, new Date('2026-09-25T22:01:00.000Z'))).toThrow(/stale/i);
            const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
            envelope.start.agent_type = 'other'; fs.writeFileSync(file, JSON.stringify(envelope));
            expect(() => readClaudeHookPair(stop, new Date('2026-09-23T22:01:00.000Z'))).toThrow(/seal/i);
        } finally { if (previous === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); }
    });
});
