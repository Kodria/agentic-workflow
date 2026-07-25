import { resolveAgentTargets } from '../../src/core/agent-targets';

const prefs = {
    defaultAgent: 'claude-code',
    enabledAgents: ['claude-code', 'opencode', 'codex'],
    installMethod: 'symlink',
    defaultScope: 'local',
} as const;

describe('resolveAgentTargets', () => {
    it('targets every enabled agent when --agent is absent', () => {
        expect(resolveAgentTargets({ prefs, explicit: undefined }))
            .toEqual(['claude-code', 'opencode', 'codex']);
    });

    it('returns a copy without mutating the enabled list', () => {
        const enabledBefore = [...prefs.enabledAgents];
        const resolved = resolveAgentTargets({ prefs });

        expect(resolved).not.toBe(prefs.enabledAgents);
        expect(prefs.enabledAgents).toEqual(enabledBefore);
    });

    it('preserves an exact explicit enabled subset', () => {
        expect(resolveAgentTargets({ prefs, explicit: 'codex,claude-code' }))
            .toEqual(['codex', 'claude-code']);
    });

    it('trims and deduplicates explicit agents in first-seen order', () => {
        expect(resolveAgentTargets({
            prefs,
            explicit: ' codex, claude-code,codex,opencode ',
        })).toEqual(['codex', 'claude-code', 'opencode']);
    });

    it('rejects an explicit disabled provider', () => {
        expect(() => resolveAgentTargets({
            prefs: { ...prefs, enabledAgents: ['claude-code'] },
            explicit: 'codex',
        })).toThrow('codex is not enabled; run awm init --agent codex');
    });

    it.each(['', '  ', ' , , '])('rejects empty explicit input %j', (explicit) => {
        expect(() => resolveAgentTargets({ prefs, explicit }))
            .toThrow('--agent requires at least one provider');
    });

    it('rejects an invalid provider', () => {
        expect(() => resolveAgentTargets({ prefs, explicit: 'unknown' }))
            .toThrow('Invalid agent "unknown".');
    });
});
