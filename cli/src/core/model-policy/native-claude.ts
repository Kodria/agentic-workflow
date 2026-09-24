export type ClaudeSubagentLifecycle = {
    provenance: 'claude-code-subagent-hooks';
    sessionId: string;
    agentId: string;
    agentType: string;
    nativeDispatchVerified: true;
    acceptedSelectionVerified: false;
    actualModelVerified: false;
    tokenUsage: 'unknown';
};
const observedLifecycles = new WeakMap<object, string>();
export function isNativeClaudeSubagentLifecycle(value: unknown): value is ClaudeSubagentLifecycle {
    return !!value && typeof value === 'object' && observedLifecycles.get(value) === JSON.stringify(value);
}

function record(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
    return value as Record<string, unknown>;
}

function boundedText(value: unknown, name: string, max = 128): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error(`${name} is invalid`);
    return value;
}

/** A matching native hook pair proves lifecycle, not the effective model.
 * Call only on payloads captured by the installed Claude Code hooks. */
export function normalizeClaudeSubagentLifecycle(startValue: unknown, stopValue: unknown): ClaudeSubagentLifecycle {
    const start = record(startValue, 'Claude SubagentStart hook');
    const stop = record(stopValue, 'Claude SubagentStop hook');
    if (start.hook_event_name !== 'SubagentStart' || stop.hook_event_name !== 'SubagentStop') throw new Error('Claude subagent hook event kind is invalid');
    const sessionId = boundedText(start.session_id, 'Claude session id');
    const agentId = boundedText(start.agent_id, 'Claude agent id');
    const agentType = boundedText(start.agent_type, 'Claude agent type');
    const stopSessionId = boundedText(stop.session_id, 'Claude stop session id');
    const stopAgentId = boundedText(stop.agent_id, 'Claude stop agent id');
    const stopAgentType = boundedText(stop.agent_type, 'Claude stop agent type');
    boundedText(stop.agent_transcript_path, 'Claude agent transcript path', 4096);
    if (typeof stop.stop_hook_active !== 'boolean') throw new Error('Claude stop hook active flag is invalid');
    if (sessionId !== stopSessionId || agentId !== stopAgentId || agentType !== stopAgentType) throw new Error('Claude subagent lifecycle identity mismatch');
    const lifecycle: ClaudeSubagentLifecycle = { provenance: 'claude-code-subagent-hooks', sessionId, agentId, agentType,
        nativeDispatchVerified: true, acceptedSelectionVerified: false, actualModelVerified: false, tokenUsage: 'unknown' };
    observedLifecycles.set(lifecycle, JSON.stringify(lifecycle));
    return lifecycle;
}
