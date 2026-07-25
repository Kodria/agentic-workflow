import { AgentTarget, getHookConfig } from '../../providers';
import { computeClaudeHookStatus } from './claude';
import { computeCodexHookStatus } from './codex';
import type { CheckResult } from './shared';

export type { CheckResult };

export type HookStatus = {
    overall: 'HEALTHY' | 'DEGRADED' | 'NOT_INSTALLED';
    // Codex-only: whether a runtime heartbeat confirms the installed script
    // matches what actually ran last session. Absent for agents (Claude)
    // that don't have a heartbeat mechanism.
    trust?: 'pending-trust' | 'healthy' | 'stale';
    checks: {
        // Claude-only checks (the using-awm.md bootstrap skill symlink and the
        // run-hook.cmd wrapper script). Absent for agents without them.
        bootstrapSkill?: CheckResult;
        sessionStartScript: CheckResult;
        runHookWrapper?: CheckResult;
        settingsEntry: CheckResult;
    };
};

export function computeHookStatus(agent: AgentTarget): HookStatus {
    const config = getHookConfig(agent);
    if (!config) {
        throw new Error(`hooks not supported for agent target: ${agent}`);
    }

    switch (config.type) {
        case 'cc-settings-merge':
            return computeClaudeHookStatus(agent as 'claude-code');
        case 'codex-hooks-json':
            return computeCodexHookStatus(agent as 'codex');
        /* istanbul ignore next -- HookConfig['type'] is exhaustively handled above */
        default: {
            const exhaustive: never = config.type;
            throw new Error(`Unknown hook config type: ${String(exhaustive)}`);
        }
    }
}
