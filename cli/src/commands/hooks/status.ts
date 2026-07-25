import { AgentTarget, getHookConfig } from '../../providers';
import { computeClaudeHookStatus } from './claude';
import { computeCodexHookStatus } from './codex';
import type { CheckResult, HookStatus } from './shared';

export type { CheckResult, HookStatus };

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
