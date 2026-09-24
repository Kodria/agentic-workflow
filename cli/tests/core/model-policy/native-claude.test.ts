import { normalizeClaudeSubagentLifecycle } from '../../../src/core/model-policy/native-claude';

describe('Claude native subagent lifecycle', () => {
    const start = { hook_event_name: 'SubagentStart', session_id: 'session-1', agent_id: 'agent-1', agent_type: 'Explore' };
    const stop = { hook_event_name: 'SubagentStop', session_id: 'session-1', agent_id: 'agent-1', agent_type: 'Explore', agent_transcript_path: '/tmp/agent-1.jsonl', stop_hook_active: false, last_assistant_message: 'done' };

    it('links native hook identities without claiming a model or paid usage', () => {
        expect(normalizeClaudeSubagentLifecycle(start, stop)).toEqual({
            provenance: 'claude-code-subagent-hooks', sessionId: 'session-1', agentId: 'agent-1', agentType: 'Explore',
            nativeDispatchVerified: true, acceptedSelectionVerified: false, actualModelVerified: false, tokenUsage: 'unknown',
        });
    });

    it('rejects mismatched agent and session identities', () => {
        expect(() => normalizeClaudeSubagentLifecycle(start, { ...stop, agent_id: 'agent-2' })).toThrow(/identity/i);
        expect(() => normalizeClaudeSubagentLifecycle(start, { ...stop, session_id: 'session-2' })).toThrow(/identity/i);
    });

    it('rejects forged event kinds and missing transcript paths', () => {
        expect(() => normalizeClaudeSubagentLifecycle({ ...start, hook_event_name: 'Notification' }, stop)).toThrow(/hook/i);
        expect(() => normalizeClaudeSubagentLifecycle(start, { ...stop, agent_transcript_path: '' })).toThrow(/transcript/i);
    });
});
