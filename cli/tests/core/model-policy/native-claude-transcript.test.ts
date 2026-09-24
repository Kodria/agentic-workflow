import fs from 'fs';
import os from 'os';
import path from 'path';
import { readClaudeSubagentTranscript } from '../../../src/core/model-policy/native-claude-transcript';

describe('Claude Code native subagent transcript', () => {
    it('extracts one actual model and timestamp without returning transcript content or inventing usage', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-claude-transcript-'));
        const file = path.join(root, 'projects', 'project-1', 'session-1', 'subagents', 'agent-agent-1.jsonl');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, [
            { type: 'assistant', timestamp: '2026-09-23T22:00:00.000Z', message: { model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'private prompt content' }], usage: { input_tokens: 10, output_tokens: 20 } } },
            { type: 'assistant', timestamp: '2026-09-23T22:00:01.000Z', message: { model: 'claude-sonnet-4-6', content: [] } },
        ].map(item => JSON.stringify(item)).join('\n'));
        try {
            const observed = readClaudeSubagentTranscript({ configDir: root, file, agentId: 'agent-1' });
            expect(observed).toMatchObject({ provenance: 'claude-subagent-transcript', actualModel: 'claude-sonnet-4-6', observedAt: '2026-09-23T22:00:01.000Z', tokenUsage: 'unknown' });
            expect(JSON.stringify(observed)).not.toContain('private prompt content');
            fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', timestamp: '2026-09-23T22:00:00.000Z', message: { model: 'claude-opus-4-7' } })}\n${JSON.stringify({ type: 'assistant', timestamp: '2026-09-23T22:00:01.000Z', message: { model: 'claude-sonnet-4-6' } })}`);
            expect(() => readClaudeSubagentTranscript({ configDir: root, file, agentId: 'agent-1' })).toThrow(/mixed|multiple/i);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('rejects symlinks and transcript files outside the native subagents tree', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-claude-transcript-'));
        const outside = path.join(root, 'outside.jsonl');
        const linked = path.join(root, 'projects', 'p', 's', 'subagents', 'agent-agent-1.jsonl');
        fs.mkdirSync(path.dirname(linked), { recursive: true });
        fs.writeFileSync(outside, '{}'); fs.symlinkSync(outside, linked);
        try {
            expect(() => readClaudeSubagentTranscript({ configDir: root, file: linked, agentId: 'agent-1' })).toThrow(/symlink|unsafe/i);
            expect(() => readClaudeSubagentTranscript({ configDir: root, file: outside, agentId: 'agent-1' })).toThrow(/outside|subagents/i);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});
